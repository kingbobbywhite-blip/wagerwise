import { NextResponse } from "next/server"
import { estimateCredits, eventOddsUrl, eventsUrl, normalizeMany } from "@/lib/odds-feed/theoddsapi"
import type { FeedEvent, FeedEventOdds } from "@/lib/odds-feed/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Today's NBA slate with player prop prices attached.
 *
 * This is the endpoint behind the one-screen experience: it works out which
 * games tip today in the caller's own timezone, pulls player props for those
 * games only, and hands back normalised quotes.
 *
 * Cost control matters more here than anywhere else in the app. Player props
 * are billed per market per event, so a careless call across every market and
 * every game will empty a monthly quota in a handful of refreshes. The defaults
 * are four markets, and the response reports what the call cost and what is
 * left.
 */

/** Markets worth pulling by default: the ones DFS apps actually post. */
const DEFAULT_TODAY_MARKETS = ["player_points", "player_rebounds", "player_assists", "player_threes"]

/** Books worth asking for: sharp references plus the retail books to beat. */
const DEFAULT_TODAY_BOOKS = ["pinnacle", "betonlineag", "lowvig", "draftkings", "fanduel", "betmgm", "caesars", "espnbet"]

interface RequestBody {
  apiKey?: string
  /** ISO instant for the start of the caller's local day. */
  from?: string
  /** ISO instant for the end of the window. */
  to?: string
  markets?: string[]
  bookmakers?: string[]
  regions?: string
  /** Safety valve so one call cannot burn an entire quota. */
  maxGames?: number
  /** Return the game list only, which costs nothing. */
  eventsOnly?: boolean
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
  let body: RequestBody
  try {
    body = (await request.json()) as RequestBody
  } catch {
    return NextResponse.json({ error: "Request body was not valid JSON." }, { status: 400 })
  }

  const apiKey = resolveKey(body)
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "No odds API key. Add one in Settings, or set ODDS_API_KEY in a .env.local file. Without a sportsbook price there is nothing to compare a line against, so the app will not guess.",
        needsKey: true,
      },
      { status: 400 },
    )
  }

  const markets = body.markets?.length ? body.markets : DEFAULT_TODAY_MARKETS
  const bookmakers = body.bookmakers?.length ? body.bookmakers : DEFAULT_TODAY_BOOKS
  const regions = body.regions || "us,us2,eu"
  const maxGames = Math.max(1, Math.min(body.maxGames ?? 14, 20))

  // Default window: from now to 30 hours out, which covers a whole slate
  // regardless of the caller's timezone.
  const fromMs = body.from ? Date.parse(body.from) : Date.now()
  const toMs = body.to ? Date.parse(body.to) : fromMs + 30 * 3600 * 1000

  try {
    // The events listing is free, so the game list never costs a credit.
    const events = await fetchJson<FeedEvent[]>(eventsUrl(apiKey))
    const todays = events.data
      .filter((e) => {
        const t = Date.parse(e.commence_time)
        return Number.isFinite(t) && t >= fromMs && t <= toMs
      })
      .sort((a, b) => a.commence_time.localeCompare(b.commence_time))

    const selected = todays.slice(0, maxGames)
    const estimatedCredits = estimateCredits(selected.length, markets.length)

    if (body.eventsOnly) {
      return NextResponse.json({
        events: todays,
        selected: selected.length,
        estimatedCredits,
        requestsRemaining: events.remaining,
        requestsUsed: events.used,
      })
    }

    if (selected.length === 0) {
      return NextResponse.json({
        events: [],
        quotes: [],
        estimatedCredits: 0,
        requestsRemaining: events.remaining,
        requestsUsed: events.used,
        note: "No NBA games tip in this window.",
      })
    }

    const payloads: FeedEventOdds[] = []
    const failures: { eventId: string; matchup: string; error: string }[] = []
    let remaining: number | null = events.remaining
    let used: number | null = events.used

    for (const e of selected) {
      try {
        const r = await fetchJson<FeedEventOdds>(eventOddsUrl(apiKey, e.id, { markets, regions, bookmakers }))
        payloads.push(r.data)
        if (r.remaining != null) remaining = r.remaining
        if (r.used != null) used = r.used
      } catch (err) {
        failures.push({
          eventId: e.id,
          matchup: `${e.away_team} at ${e.home_team}`,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    const normalized = normalizeMany(payloads)

    return NextResponse.json({
      events: selected,
      quotes: normalized.quotes,
      unknownMarkets: normalized.unknownMarkets,
      droppedCount: normalized.dropped.length,
      failures,
      estimatedCredits,
      requestsRemaining: remaining,
      requestsUsed: used,
      fetchedAt: new Date().toISOString(),
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not reach the odds feed." },
      { status: 502 },
    )
  }
}
