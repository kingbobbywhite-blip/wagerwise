import { MARKETS, type MarketKey } from "@/lib/nba/markets"
import { resolveLine } from "@/lib/quant/distributions"
import { probToAmerican } from "@/lib/quant/odds"
import { optimizeSlips, type BuiltSlip, type CandidateLeg, type OptimizerConstraints } from "@/lib/quant/optimizer"
import type { CorrelationSettings } from "@/lib/quant/correlation"
import {
  bestPerSelection,
  findValueBets,
  groupQuotes,
  referenceProjection,
  type FeedQuote,
  type ValueBet,
  type ValueBetSettings,
} from "@/lib/quant/valuebets"

/**
 * The daily pipeline: feed quotes in, plays out.
 *
 * Three products come out of the same data, because the three questions a
 * bettor actually has are different:
 *
 *  1. What single bets are mispriced right now, and at which book.
 *  2. What parlay is worth building out of those, once correlation is priced.
 *  3. What numbers to look for on a pick'em app, since the app's own board
 *     cannot be read from here.
 *
 * The third is the honest answer to "just tell me what to play on PrizePicks".
 * Nothing in this codebase knows what PrizePicks is offering, so instead it
 * gives you the number at which each side becomes worth taking, and you check
 * that against your screen in a few seconds.
 */

export interface GameSummary {
  gameId: string
  homeTeam: string
  awayTeam: string
  commenceTime: string | null
  propCount: number
}

export interface DfsTarget {
  key: string
  player: string
  market: MarketKey
  marketLabel: string
  gameId: string
  commenceTime: string | null
  /** Consensus projection for the stat. */
  mean: number
  sd: number
  confidence: number
  /** Fair line: the number at which the market thinks it is a coin flip. */
  fairLine: number
  /** Highest line at which taking the OVER still clears the bar, or null. */
  overAt: number | null
  overProb: number | null
  /** Lowest line at which taking the UNDER still clears the bar, or null. */
  underAt: number | null
  underProb: number | null
  referenceBooks: string[]
  hasSharpBook: boolean
}

export interface DailyPicks {
  games: GameSummary[]
  valueBets: ValueBet[]
  parlays: BuiltSlip[]
  dfsTargets: DfsTarget[]
  stats: {
    quotes: number
    props: number
    booksSeen: string[]
    pricedProps: number
  }
}

export interface BuildOptions {
  value: ValueBetSettings
  correlation: CorrelationSettings
  constraints: OptimizerConstraints
  /** Per-leg hit rate a pick'em entry needs, used to place the DFS targets. */
  dfsBreakEven: number
  /**
   * Minimum leg probability for parlay construction.
   *
   * Deliberately lower than the pick'em default. On a DFS app every leg is
   * roughly even money, so a leg under 50% is close to worthless. On a
   * sportsbook the price carries the value: a +160 leg that hits 45% of the
   * time is an excellent bet. Legs here have already been filtered on edge,
   * which is the thing that actually matters, so the probability floor only
   * needs to keep out the far tail where the model is least reliable.
   */
  parlayMinLegProb?: number
  /** Commission charged on parlay winnings, for exchanges. */
  parlayCommission?: number
  /** How many parlays to return. */
  parlayCount?: number
  now?: number
}

export function summariseGames(quotes: FeedQuote[]): GameSummary[] {
  const map = new Map<string, GameSummary>()
  for (const q of quotes) {
    const g = map.get(q.gameId)
    if (g) {
      g.propCount++
    } else {
      const [away, home] = q.gameId.split("@")
      map.set(q.gameId, {
        gameId: q.gameId,
        homeTeam: q.homeTeam ?? home ?? "",
        awayTeam: q.awayTeam ?? away ?? "",
        commenceTime: q.commenceTime ?? null,
        propCount: 1,
      })
    }
  }
  return Array.from(map.values()).sort((a, b) => (a.commenceTime ?? "").localeCompare(b.commenceTime ?? ""))
}

/**
 * Find the softest line still worth taking on each side.
 *
 * Walks half-point lines outward from the projection and reports the last one
 * that clears the required hit rate. If nothing clears, both sides come back
 * null, which is the correct answer far more often than people expect.
 */
export function dfsTargetsFor(
  mean: number,
  distribution: { pAtLeast(k: number): number; pmf(k: number): number },
  breakEven: number,
): { fairLine: number; overAt: number | null; overProb: number | null; underAt: number | null; underProb: number | null } {
  // Walk actual half-point lines. Pick'em apps post x.5 almost universally, and
  // a whole number would introduce a push the targets do not account for.
  const start = Math.max(0.5, Math.floor(mean - 15) + 0.5)
  const end = Math.ceil(mean + 15) + 0.5

  let fairLine = Math.round(mean - 0.5) + 0.5
  let bestGap = Infinity
  let overAt: number | null = null
  let overProb: number | null = null
  let underAt: number | null = null
  let underProb: number | null = null

  for (let half = start; half <= end; half += 1) {
    if (half <= 0) continue
    const { over, under } = resolveLine(distribution as never, half)

    const gap = Math.abs(over - 0.5)
    if (gap < bestGap) {
      bestGap = gap
      fairLine = half
    }
    // Highest line where the over still clears.
    if (over >= breakEven && (overAt == null || half > overAt)) {
      overAt = half
      overProb = over
    }
    // Lowest line where the under still clears.
    if (under >= breakEven && (underAt == null || half < underAt)) {
      underAt = half
      underProb = under
    }
  }

  return { fairLine, overAt, overProb, underAt, underProb }
}

export function buildDfsTargets(quotes: FeedQuote[], opts: BuildOptions): DfsTarget[] {
  const now = opts.now ?? Date.now()
  const out: DfsTarget[] = []

  for (const group of groupQuotes(quotes)) {
    const ref = referenceProjection(group, group.quotes, opts.value, now)
    if (!ref || ref.status !== "priced") continue

    const t = dfsTargetsFor(ref.mean, ref.distribution, opts.dfsBreakEven)
    // A prop where neither side clears is not a target, it is a pass.
    if (t.overAt == null && t.underAt == null) continue

    out.push({
      key: group.key,
      player: group.player,
      market: group.market,
      marketLabel: MARKETS[group.market].label,
      gameId: group.gameId,
      commenceTime: group.commenceTime,
      mean: ref.mean,
      sd: ref.sd,
      confidence: ref.confidence,
      referenceBooks: ref.books.map((b) => b.book),
      hasSharpBook: ref.hasSharpBook,
      ...t,
    })
  }

  // Widest usable window first: those are the props where the market disagrees
  // most with the number a pick'em app is likely to be showing.
  return out.sort((a, b) => (b.overProb ?? b.underProb ?? 0) - (a.overProb ?? a.underProb ?? 0))
}

/**
 * Turn value bets into optimizer legs.
 *
 * The odds feed does not say which team a player is on, so team-level
 * correlation cannot be detected here. The game id can, and same-game is the
 * dominant effect for a parlay, so that is what the correlation model sees.
 */
export function valueBetsToCandidates(bets: ValueBet[]): CandidateLeg[] {
  return bets.map((b) => ({
    id: b.id,
    player: b.player,
    team: null,
    opponent: null,
    gameId: b.gameId,
    market: b.market,
    marketLabel: b.marketLabel,
    line: b.line,
    side: b.side,
    pWin: b.fairProb,
    pPush: 0,
    american: b.price,
    status: "priced" as const,
    confidence: b.confidence,
    lineEdge: b.side === "OVER" ? b.consensusMean - b.line : b.line - b.consensusMean,
    lineEdgeZ:
      (b.side === "OVER" ? b.consensusMean - b.line : b.line - b.consensusMean) / Math.max(b.consensusSd, 1e-9),
    app: b.bookName,
  }))
}

export function buildDailyPicks(quotes: FeedQuote[], opts: BuildOptions): DailyPicks {
  const now = opts.now ?? Date.now()
  const games = summariseGames(quotes)
  const groups = groupQuotes(quotes)

  const allValue = findValueBets(quotes, opts.value, now)
  const valueBets = bestPerSelection(allValue)

  // Parlays are built only from legs that are individually +EV. Stacking legs
  // that are each a small loss into a parlay multiplies the loss; there is no
  // combination of bad bets that becomes a good one.
  const parlayConstraints: OptimizerConstraints = {
    ...opts.constraints,
    minLegProb: opts.parlayMinLegProb ?? 0.3,
  }

  // Parlays are built one book at a time, because you cannot combine a leg at
  // one sportsbook with a leg at another into a single ticket. Taking the best
  // price for each leg across books produces a parlay nobody can actually
  // place. Within a book, every leg is priced at that book's own number, and
  // the best parlay across all books wins.
  const perBook = new Map<string, ValueBet[]>()
  for (const b of allValue) {
    const arr = perBook.get(b.book)
    if (arr) arr.push(b)
    else perBook.set(b.book, [b])
  }

  const parlays: BuiltSlip[] = []
  for (const [, bets] of perBook) {
    const candidates = valueBetsToCandidates(bestPerSelection(bets))
    if (candidates.length < parlayConstraints.picks) continue
    parlays.push(
      ...optimizeSlips(candidates, {
        parlay: { commission: opts.parlayCommission ?? 0 },
        constraints: parlayConstraints,
        correlation: opts.correlation,
        objectives: ["ev", "growth"],
        count: 2,
      }),
    )
  }
  parlays.sort((a, b) => b.evaluation.ev - a.evaluation.ev)
  const topParlays = parlays.slice(0, opts.parlayCount ?? 4)

  const dfsTargets = buildDfsTargets(quotes, opts)

  const booksSeen = Array.from(new Set(quotes.map((q) => q.book))).sort()
  let pricedProps = 0
  for (const g of groups) {
    const ref = referenceProjection(g, g.quotes, opts.value, now)
    if (ref?.status === "priced") pricedProps++
  }

  return {
    games,
    valueBets,
    parlays: topParlays,
    dfsTargets,
    stats: { quotes: quotes.length, props: groups.length, booksSeen, pricedProps },
  }
}

/** Fair price for a target line, for display beside the DFS numbers. */
export function fairPriceAt(prob: number | null): number | null {
  return prob == null ? null : probToAmerican(prob)
}
