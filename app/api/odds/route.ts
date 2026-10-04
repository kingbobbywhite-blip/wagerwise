import { NextResponse } from "next/server"
import { crossSiteRejection } from "@/lib/odds-feed/same-origin"
import {
  marketsForLeague,
  estimateCredits,
  eventOddsUrl,
  eventsUrl,
  normalizeMany,
} from "@/lib/odds-feed/theoddsapi"
import { normalizeProplineMany, pullPropline, resolveProplineKey } from "@/lib/odds-feed/propline"
import type { FeedEvent, FeedEventOdds } from "@/lib/odds-feed/types"
import { DEFAULT_LEAGUE, LEAGUE_IDS, isLeagueId, leagueFor } from "@/lib/leagues"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Server-side proxy for The Odds API.
 *
 * Two reasons this is not called from the browser directly: the feed does not
 * promise CORS headers, and an API key in page JavaScript is a key you have
 * given away. The key is read from ODDS_API_KEY when set, otherwise taken from
 * the request body, which is how the settings screen supplies it on a local
 * install. It is never logged and never returned.
 *
 * With PropLine as the provider the same request goes to PropLine instead
 * (PROPLINE_API_KEY, or the key from Settings), and its pick'em rows are
 * dropped here: this route only attaches prices.
 */

interface RequestBody {
  apiKey?: string
  /** "theoddsapi" (default) or "propline". */
  provider?: string
  proplineKey?: string
  markets?: string[]
  regions?: string
  bookmakers?: string[]
  /** Limit to these event ids. */
  eventIds?: string[]
  /** Return the event list only, without pulling any odds. */
  eventsOnly?: boolean
  /** Which league's feed to query. Defaults to the NBA. */
  league?: string
  /** ISO instant: only games starting at or after this. Defaults to now. */
  from?: string
  /** ISO instant: only games starting at or before this. Defaults to 30 hours after `from`. */
  to?: string
  /** Hard cap on games priced in one call, to protect the feed quota. */
  maxGames?: number
}

function resolveKey(body: RequestBody): string | null {
  const fromEnv = process.env.ODDS_API_KEY
  if (fromEnv && fromEnv.trim()) return fromEnv.trim()
  if (body.apiKey && body.apiKey.trim()) return body.apiKey.trim()
  return null
}

async function fetchJson<T>(url: string): Promise<{ data: T; remaining: number | null; used: number | null }> {
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Feed returned ${res.status}. ${text.slice(0, 300)}`)
  }
  const remaining = Number(res.headers.get("x-requests-remaining"))
  const used = Number(res.headers.get("x-requests-used"))
  return {
    data: (await res.json()) as T,
    remaining: Number.isFinite(remaining) ? remaining : null,
    used: Number.isFinite(used) ? used : null,
  }
}

export async function POST(request: Request) {
  // Before any key is read: another site's page must not spend this server's quota.
  const refused = crossSiteRejection(request)
  if (refused) return refused

  let body: RequestBody
  try {
    body = (await request.json()) as RequestBody
  } catch {
    return NextResponse.json({ error: "Request body was not valid JSON." }, { status: 400 })
  }

  if (body.league != null && !isLeagueId(body.league)) {
    return NextResponse.json(
      { error: `Unsupported league "${body.league}". Supported: ${LEAGUE_IDS.join(", ")}.` },
      { status: 400 },
    )
  }

  const usePropline = body.provider === "propline"
  const proplineKey = usePropline ? resolveProplineKey(body.proplineKey) : null
  const apiKey = usePropline ? null : resolveKey(body)
  if (usePropline && !proplineKey) {
    return NextResponse.json(
      { error: "No PropLine key. Add one in Settings, or set PROPLINE_API_KEY in the environment." },
      { status: 400 },
    )
  }
  if (!usePropline && !apiKey) {
    return NextResponse.json(
      { error: "No odds API key. Add one in Settings, or set ODDS_API_KEY in the environment." },
      { status: 400 },
    )
  }
  const leagueId = isLeagueId(body.league) ? body.league : DEFAULT_LEAGUE
  const league = leagueFor(leagueId)

  const markets = marketsForLeague(leagueId, body.markets)
  const regions = body.regions || "us,us2,eu"
  const maxGames = Math.max(1, Math.min(body.maxGames ?? league.maxGames, 20))

  // Only today's games. Without a window this used to price every event the
  // feed listed, which during the season is weeks of games, and props are
  // billed per market per game: one press could spend a month's free quota.
  const fromMs = body.from ? Date.parse(body.from) : Date.now()
  const toMs = body.to ? Date.parse(body.to) : fromMs + 30 * 3600 * 1000

  if (usePropline) {
    try {
      const pull = await pullPropline({
        apiKey: proplineKey!,
        league: leagueId,
        fromMs,
        toMs,
        markets,
        maxGames,
        eventIds: body.eventIds,
        eventsOnly: body.eventsOnly,
      })
      const cappedOut = pull.cappedOut
      if (body.eventsOnly) {
        return NextResponse.json({
          league: leagueId,
          cappedOut,
          events: pull.selected,
          estimatedCredits: 0,
          requestsRemaining: pull.quota?.remaining ?? null,
          requestsUsed: pull.quota?.used ?? null,
        })
      }
      const normalized = normalizeProplineMany(pull.payloads, league.sport)
      return NextResponse.json({
        league: leagueId,
        cappedOut,
        events: pull.selected,
        quotes: normalized.quotes,
        unknownMarkets: normalized.unknownMarkets,
        dropped: normalized.dropped.slice(0, 50),
        droppedCount: normalized.dropped.length,
        failures: pull.failures,
        requestsRemaining: pull.quota?.remaining ?? null,
        requestsUsed: pull.quota?.used ?? null,
      })
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Could not reach PropLine." },
        { status: 502 },
      )
    }
  }

  try {
    const events = await fetchJson<FeedEvent[]>(eventsUrl(apiKey!, leagueId))
    const inWindow = events.data
      .filter((e) => {
        const t = Date.parse(e.commence_time)
        return Number.isFinite(t) && t >= fromMs && t <= toMs
      })
      .sort((a, b) => a.commence_time.localeCompare(b.commence_time))
    const chosen = body.eventIds?.length ? inWindow.filter((e) => body.eventIds!.includes(e.id)) : inWindow
    const wanted = chosen.slice(0, maxGames)
    const cappedOut = chosen.length - wanted.length

    if (body.eventsOnly) {
      return NextResponse.json({
        league: leagueId,
        cappedOut,
        events: wanted,
        estimatedCredits: estimateCredits(wanted.length, markets.length),
        requestsRemaining: events.remaining,
        requestsUsed: events.used,
      })
    }

    // Player props are billed per market per event, so this loop is the
    // expensive part of the whole app. The client is expected to narrow the
    // event list and the market list before calling.
    const payloads: FeedEventOdds[] = []
    const failures: { eventId: string; error: string }[] = []
    let remaining: number | null = events.remaining
    let used: number | null = events.used

    for (const e of wanted) {
      try {
        const r = await fetchJson<FeedEventOdds>(
          eventOddsUrl(apiKey!, e.id, { markets, regions, bookmakers: body.bookmakers, league: leagueId }),
        )
        payloads.push(r.data)
        if (r.remaining != null) remaining = r.remaining
        if (r.used != null) used = r.used
      } catch (err) {
        failures.push({ eventId: e.id, error: err instanceof Error ? err.message : String(err) })
      }
    }

    const normalized = normalizeMany(payloads, league.sport)

    return NextResponse.json({
      league: leagueId,
      cappedOut,
      events: wanted,
      quotes: normalized.quotes,
      unknownMarkets: normalized.unknownMarkets,
      dropped: normalized.dropped.slice(0, 50),
      droppedCount: normalized.dropped.length,
      failures,
      requestsRemaining: remaining,
      requestsUsed: used,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not reach the odds feed." },
      { status: 502 },
    )
  }
}
