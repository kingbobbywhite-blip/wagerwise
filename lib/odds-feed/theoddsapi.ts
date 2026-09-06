import type { MarketKey } from "@/lib/nba/markets"
import { normalizeName } from "@/lib/quant/correlation"
import type { BookQuote } from "@/lib/quant/projection"
import type { FeedEvent, FeedEventOdds } from "./types"

/**
 * The Odds API adapter.
 *
 * This is the half of the pipeline that carries the signal. A DFS board tells
 * you what is on offer; a sportsbook price tells you what it is worth. Without
 * the second half the app has nothing to compare against and correctly refuses
 * to price anything.
 *
 * The feed is a paid product. That is the deal: the sportsbook side is the part
 * worth paying for, and scraping the DFS apps instead is both against their
 * terms and the half that carries no information.
 */

export const NBA_SPORT_KEY = "basketball_nba"

/** Feed market keys mapped to our own taxonomy. */
export const FEED_MARKET_MAP: Record<string, MarketKey> = {
  player_points: "PTS",
  player_rebounds: "REB",
  player_assists: "AST",
  player_threes: "3PM",
  player_blocks: "BLK",
  player_steals: "STL",
  player_turnovers: "TOV",
  player_points_rebounds_assists: "PRA",
  player_points_rebounds: "PR",
  player_points_assists: "PA",
  player_rebounds_assists: "RA",
  player_blocks_steals: "STL_BLK",
  player_field_goals: "FGM",
  player_frees_made: "FTM",
}

export const DEFAULT_FEED_MARKETS = Object.keys(FEED_MARKET_MAP)

/** Reverse lookup, used when requesting only the markets on your board. */
export function feedKeyFor(market: MarketKey): string | null {
  for (const [k, v] of Object.entries(FEED_MARKET_MAP)) if (v === market) return k
  return null
}

export interface NormalizedQuote extends BookQuote {
  player: string
  playerKey: string
  market: MarketKey
  gameId: string
  homeTeam: string
  awayTeam: string
  commenceTime: string
}

export interface NormalizeResult {
  quotes: NormalizedQuote[]
  /** Feed markets present in the payload that we do not model. */
  unknownMarkets: string[]
  /** Outcomes dropped, with the reason, so a silent gap is impossible. */
  dropped: { reason: string; detail: string }[]
}

/**
 * Flatten one event's odds payload into per-book, per-player, per-market quotes.
 *
 * Over and Under arrive as separate outcomes at the same point, so they are
 * paired back up here. An unpaired side is still emitted, because a one-sided
 * price is worth something, but the projection layer marks it as having an
 * assumed rather than measured margin.
 */
export function normalizeEventOdds(event: FeedEventOdds): NormalizeResult {
  const quotes: NormalizedQuote[] = []
  const unknownMarkets = new Set<string>()
  const dropped: NormalizeResult["dropped"] = []

  const gameId = `${event.away_team}@${event.home_team}`

  for (const book of event.bookmakers ?? []) {
    for (const market of book.markets ?? []) {
      const mapped = FEED_MARKET_MAP[market.key]
      if (!mapped) {
        unknownMarkets.add(market.key)
        continue
      }

      // Group outcomes by player and line, then pair over with under.
      const grouped = new Map<string, { player: string; point: number; over?: number; under?: number }>()
      for (const o of market.outcomes ?? []) {
        const player = (o.description ?? "").trim()
        if (!player) {
          dropped.push({ reason: "no player on outcome", detail: `${book.key} ${market.key} ${o.name}` })
          continue
        }
        if (o.point == null || !Number.isFinite(o.point)) {
          dropped.push({ reason: "no line on outcome", detail: `${book.key} ${market.key} ${player}` })
          continue
        }
        if (!Number.isFinite(o.price)) {
          dropped.push({ reason: "no price on outcome", detail: `${book.key} ${market.key} ${player}` })
          continue
        }
        const key = `${normalizeName(player)}|${o.point}`
        const entry = grouped.get(key) ?? { player, point: o.point }
        const side = o.name.trim().toLowerCase()
        if (side === "over") entry.over = o.price
        else if (side === "under") entry.under = o.price
        else {
          dropped.push({ reason: `unexpected outcome name "${o.name}"`, detail: `${book.key} ${market.key} ${player}` })
          continue
        }
        grouped.set(key, entry)
      }

      for (const g of grouped.values()) {
        if (g.over == null && g.under == null) continue
        quotes.push({
          book: book.key,
          line: g.point,
          overOdds: g.over ?? null,
          underOdds: g.under ?? null,
          fetchedAt: market.last_update ?? book.last_update ?? null,
          player: g.player,
          playerKey: normalizeName(g.player),
          market: mapped,
          gameId,
          homeTeam: event.home_team,
          awayTeam: event.away_team,
          commenceTime: event.commence_time,
        })
      }
    }
  }

  return { quotes, unknownMarkets: Array.from(unknownMarkets), dropped }
}

export function normalizeMany(events: FeedEventOdds[]): NormalizeResult {
  const all: NormalizeResult = { quotes: [], unknownMarkets: [], dropped: [] }
  const unknown = new Set<string>()
  for (const e of events) {
    const r = normalizeEventOdds(e)
    all.quotes.push(...r.quotes)
    all.dropped.push(...r.dropped)
    for (const m of r.unknownMarkets) unknown.add(m)
  }
  all.unknownMarkets = Array.from(unknown)
  return all
}

// ---------------------------------------------------------------------------
// Matching feed quotes onto board props
// ---------------------------------------------------------------------------

export interface MatchTarget {
  player: string
  market: MarketKey | null
}

export interface QuoteIndex {
  get(player: string, market: MarketKey | null): NormalizedQuote[]
  size: number
  players: string[]
}

export function indexQuotes(quotes: NormalizedQuote[]): QuoteIndex {
  const byKey = new Map<string, NormalizedQuote[]>()
  for (const q of quotes) {
    const k = `${q.playerKey}|${q.market}`
    const arr = byKey.get(k)
    if (arr) arr.push(q)
    else byKey.set(k, [q])
  }
  return {
    get(player, market) {
      if (!market) return []
      return byKey.get(`${normalizeName(player)}|${market}`) ?? []
    },
    size: quotes.length,
    players: Array.from(new Set(quotes.map((q) => q.playerKey))),
  }
}

export interface AttachResult<T> {
  rows: T[]
  matched: number
  unmatched: { player: string; market: string }[]
}

/**
 * Attach feed quotes to slate rows.
 *
 * Matching is on normalised player name plus market. Names that do not match are
 * reported rather than fuzzily guessed: attaching Jalen Williams' price to
 * Jaylin Williams would be worse than leaving the prop unpriced.
 */
export function attachQuotes<T extends { player: string; marketKey: MarketKey | null; marketLabel?: string }>(
  rows: T[],
  index: QuoteIndex,
): AttachResult<T & { quotes: BookQuote[] }> {
  const out: (T & { quotes: BookQuote[] })[] = []
  const unmatched: { player: string; market: string }[] = []
  let matched = 0

  for (const row of rows) {
    const found = index.get(row.player, row.marketKey)
    if (found.length > 0) matched++
    else unmatched.push({ player: row.player, market: row.marketLabel ?? String(row.marketKey) })
    out.push({
      ...row,
      quotes: found.map((q) => ({ book: q.book, line: q.line, overOdds: q.overOdds, underOdds: q.underOdds, fetchedAt: q.fetchedAt })),
    })
  }

  return { rows: out, matched, unmatched }
}

// ---------------------------------------------------------------------------
// Request builders
// ---------------------------------------------------------------------------

const BASE = "https://api.the-odds-api.com/v4"

export function eventsUrl(apiKey: string): string {
  return `${BASE}/sports/${NBA_SPORT_KEY}/events?apiKey=${encodeURIComponent(apiKey)}`
}

export function eventOddsUrl(
  apiKey: string,
  eventId: string,
  opts: { markets: string[]; regions: string; bookmakers?: string[] },
): string {
  const params = new URLSearchParams({
    apiKey,
    regions: opts.regions,
    markets: opts.markets.join(","),
    oddsFormat: "american",
  })
  if (opts.bookmakers && opts.bookmakers.length > 0) params.set("bookmakers", opts.bookmakers.join(","))
  return `${BASE}/sports/${NBA_SPORT_KEY}/events/${encodeURIComponent(eventId)}/odds?${params.toString()}`
}

/**
 * Player-prop markets are billed per market per event, so requesting fourteen
 * markets across a twelve-game slate is a hundred and sixty-eight credits.
 * Requesting only the markets actually on your board is the difference between
 * a usable quota and an exhausted one.
 */
export function estimateCredits(events: number, markets: number, bookmakerRegions = 1): number {
  return events * markets * bookmakerRegions
}
