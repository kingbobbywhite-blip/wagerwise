import { NextResponse } from "next/server"
import { estimateCredits, eventOddsUrl, eventsUrl, marketsForLeague, normalizeMany } from "@/lib/odds-feed/theoddsapi"
import {
  PICKEM_BOOKS,
  normalizeProplineMany,
  pickemNoteFor,
  pickemSlate,
  pullPropline,
  resolveProplineKey,
  type PickemGame,
  type PickemLine,
} from "@/lib/odds-feed/propline"
import type { FeedEvent, FeedEventOdds } from "@/lib/odds-feed/types"
import { DEFAULT_LEAGUE, LEAGUE_IDS, creditWarning, inSeason, isLeagueId, leagueFor, type LeagueId } from "@/lib/leagues"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Today's slate with player prop prices attached, for any supported league.
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
 *
 * Two feeds can price the slate. The Odds API bills per market per game against
 * a monthly quota. PropLine bills per request against a daily one, and its
 * payload also carries the pick'em apps' own lines, which are split out and
 * returned separately: they say what the apps offer, never what a pick is worth.
 */

interface RequestBody {
  apiKey?: string
  /** "theoddsapi" (default) or "propline": which feed prices the slate. */
  provider?: string
  proplineKey?: string
  /** Also pull the pick'em apps' lines from PropLine when The Odds API prices the slate. */
  pickemLines?: boolean
  /** Which league to pull. Defaults to the NBA. */
  league?: string
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

  if (body.league != null && !isLeagueId(body.league)) {
    return NextResponse.json(
      { error: `Unsupported league "${body.league}". Supported: ${LEAGUE_IDS.join(", ")}.` },
      { status: 400 },
    )
  }

  const provider = body.provider === "propline" ? "propline" : "theoddsapi"
  const proplineKey = resolveProplineKey(body.proplineKey)
  const apiKey = resolveKey(body)

  if (provider === "propline" && !proplineKey) {
    return NextResponse.json(
      {
        error:
          "No PropLine key. Add one in Settings, or set PROPLINE_API_KEY in a .env.local file, or switch the provider back to The Odds API.",
        needsKey: true,
      },
      { status: 400 },
    )
  }
  if (provider === "theoddsapi" && !apiKey) {
    return NextResponse.json(
      {
        error:
          "No odds API key. Add one in Settings, or set ODDS_API_KEY in a .env.local file. Without a sportsbook price there is nothing to compare a line against, so the app will not guess.",
        needsKey: true,
      },
      { status: 400 },
    )
  }
  const leagueId = isLeagueId(body.league) ? body.league : DEFAULT_LEAGUE
  const league = leagueFor(leagueId)

  // Each league's defaults come from its own config: the markets it actually
  // posts, the books that price it, and a game cap sized to its slate. A market
  // list from settings is kept only where it fits the league's sport.
  const markets = marketsForLeague(leagueId, body.markets)
  const bookmakers = body.bookmakers?.length ? body.bookmakers : league.books
  const regions = body.regions || "us,us2,eu"
  const maxGames = Math.max(1, Math.min(body.maxGames ?? league.maxGames, 20))

  // Default window: from now to 30 hours out, which covers a whole slate
  // regardless of the caller's timezone.
  const fromMs = body.from ? Date.parse(body.from) : Date.now()
  const toMs = body.to ? Date.parse(body.to) : fromMs + 30 * 3600 * 1000

  if (provider === "propline") {
    return fromPropline({ apiKey: proplineKey!, leagueId, markets, maxGames, fromMs, toMs, eventsOnly: !!body.eventsOnly })
  }

  try {
    // The events listing is free, so the game list never costs a credit.
    const events = await fetchJson<FeedEvent[]>(eventsUrl(apiKey!, leagueId))
    const todays = events.data
      .filter((e) => {
        const t = Date.parse(e.commence_time)
        return Number.isFinite(t) && t >= fromMs && t <= toMs
      })
      .sort((a, b) => a.commence_time.localeCompare(b.commence_time))

    const selected = todays.slice(0, maxGames)
    const estimatedCredits = estimateCredits(selected.length, markets.length)
    const cost = creditWarning(leagueId, selected.length, markets.length)
    // What a pull would have cost without the cap, so the cap is visible rather
    // than silently swallowing two thirds of the slate.
    const cappedOut = Math.max(0, todays.length - selected.length)

    if (body.eventsOnly) {
      return NextResponse.json({
        league: leagueId,
        provider,
        events: todays,
        selected: selected.length,
        cappedOut,
        estimatedCredits,
        costWarning: cost.message,
        costSevere: cost.severe,
        requestsRemaining: events.remaining,
        requestsUsed: events.used,
      })
    }

    if (selected.length === 0) {
      // Distinguish "wrong time of year" from "something is broken". An empty
      // WNBA slate in January is the off-season; an empty one in July is a
      // problem worth chasing.
      const note = inSeason(leagueId)
        ? `No ${league.label} games tip in this window.`
        : `No ${league.label} games tip in this window, and ${league.label} is out of season right now, so an empty slate is expected rather than a fault.`
      // The listing is already paid for (it is free), so say when the next game
      // is. "Nothing today, next one Tuesday" is an answer; a blank page is not.
      const next = events.data
        .filter((e) => Date.parse(e.commence_time) > toMs)
        .sort((a, b) => a.commence_time.localeCompare(b.commence_time))[0]
      return NextResponse.json({
        league: leagueId,
        provider,
        events: [],
        quotes: [],
        estimatedCredits: 0,
        requestsRemaining: events.remaining,
        requestsUsed: events.used,
        inSeason: inSeason(leagueId),
        nextEvent: next
          ? { commence_time: next.commence_time, home_team: next.home_team, away_team: next.away_team }
          : null,
        note,
      })
    }

    const payloads: FeedEventOdds[] = []
    const failures: { eventId: string; matchup: string; error: string }[] = []
    let remaining: number | null = events.remaining
    let used: number | null = events.used

    for (const e of selected) {
      try {
        const r = await fetchJson<FeedEventOdds>(eventOddsUrl(apiKey!, e.id, { markets, regions, bookmakers, league: leagueId }))
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

    const normalized = normalizeMany(payloads, league.sport)

    // The pick'em lines are a bonus on this path: a failure there is reported
    // and never costs the prices already pulled.
    const pickem =
      body.pickemLines && proplineKey
        ? await pickemFromPropline({ apiKey: proplineKey, leagueId, markets, maxGames, fromMs, toMs, games: selected })
        : { lines: [] as PickemLine[], games: [] as PickemGame[], started: [] as string[], note: null, remaining: null }

    return NextResponse.json({
      league: leagueId,
      provider,
      events: selected,
      quotes: normalized.quotes,
      pickemLines: pickem.lines,
      pickemGames: pickem.games,
      pickemStarted: pickem.started,
      pickemNote: pickem.note,
      proplineRemaining: pickem.remaining,
      unknownMarkets: normalized.unknownMarkets,
      droppedCount: normalized.dropped.length,
      failures,
      estimatedCredits,
      costWarning: cost.message,
      costSevere: cost.severe,
      cappedOut,
      inSeason: inSeason(leagueId),
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

interface PullArgs {
  apiKey: string
  leagueId: LeagueId
  markets: string[]
  maxGames: number
  fromMs: number
  toMs: number
}

/** The whole slate from PropLine: prices and pick'em lines in the same requests. */
async function fromPropline(args: PullArgs & { eventsOnly: boolean }) {
  const league = leagueFor(args.leagueId)
  try {
    // Every book: PropLine bills per request, not per book, so narrowing the
    // list saves nothing and loses prices.
    const pull = await pullPropline({ ...args, league: args.leagueId })
    const cappedOut = pull.cappedOut
    const base = {
      league: args.leagueId,
      provider: "propline" as const,
      // The Odds API's monthly credits are untouched; PropLine counts requests per day.
      estimatedCredits: 0,
      proplineRequests: pull.requests,
      requestsRemaining: pull.quota?.remaining ?? null,
      requestsUsed: pull.quota?.used ?? null,
      quotaPeriod: "day" as const,
      inSeason: inSeason(args.leagueId),
    }

    if (args.eventsOnly) {
      return NextResponse.json({ ...base, events: pull.inWindow, selected: pull.selected.length, cappedOut })
    }

    if (pull.selected.length === 0) {
      const note = inSeason(args.leagueId)
        ? `No ${league.label} games tip in this window.`
        : `No ${league.label} games tip in this window, and ${league.label} is out of season right now, so an empty slate is expected rather than a fault.`
      const next = pull.nextEvent
      return NextResponse.json({
        ...base,
        events: [],
        quotes: [],
        pickemLines: [],
        pickemGames: [],
        pickemStarted: [],
        nextEvent: next ? { commence_time: next.commence_time, home_team: next.home_team, away_team: next.away_team } : null,
        note,
      })
    }

    const normalized = normalizeProplineMany(pull.payloads, league.sport)
    return NextResponse.json({
      ...base,
      events: pull.selected,
      quotes: normalized.quotes,
      pickemLines: normalized.pickemLines,
      pickemGames: normalized.pickemGames,
      pickemStarted: normalized.startedGames,
      pickemNote: pickemNoteFor(normalized.pickemLines.length, pull.failures, {
        games: pull.selected.length,
        started: normalized.startedGames.length,
      }),
      unknownMarkets: normalized.unknownMarkets,
      droppedCount: normalized.dropped.length,
      failures: pull.failures,
      cappedOut,
      fetchedAt: new Date().toISOString(),
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not reach PropLine." },
      { status: 502 },
    )
  }
}

/**
 * Only the pick'em apps' lines, from PropLine, to sit beside The Odds API's
 * prices, for exactly the games The Odds API priced.
 */
async function pickemFromPropline(
  args: PullArgs & { games: FeedEvent[] },
): Promise<{ lines: PickemLine[]; games: PickemGame[]; started: string[]; note: string | null; remaining: number | null }> {
  const league = leagueFor(args.leagueId)
  try {
    const pull = await pullPropline({ ...args, league: args.leagueId, bookmakers: PICKEM_BOOKS })
    const normalized = normalizeProplineMany(pull.payloads, league.sport)
    const note = pickemNoteFor(
      normalized.pickemLines.length,
      pull.failures,
      pickemSlate(
        args.games,
        pull.selected,
        normalized.startedGames,
        pull.failures.map((f) => f.eventId),
      ),
    )
    return {
      lines: normalized.pickemLines,
      games: normalized.pickemGames,
      started: normalized.startedGames,
      note,
      remaining: pull.quota?.remaining ?? null,
    }
  } catch (err) {
    return {
      lines: [],
      games: [],
      started: [],
      note: `Pick'em lines unavailable: ${err instanceof Error ? err.message : String(err)}`,
      remaining: null,
    }
  }
}
