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
  /**
   * The line the books themselves hang, which is the line a pick'em app
   * almost always copies, the side the market favours there, and how often
   * that side hits. This is the number the targets are sorted by.
   */
  marketLine: number
  marketSide: "OVER" | "UNDER"
  marketProb: number
  /** Over and under probability at each half-point line around the projection. */
  ladder: { line: number; over: number; under: number }[]
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
    /** Edges found only at books outside the bettable list, and so not shown. */
    hiddenOffers: number
    /** The books those hidden edges were at. */
    hiddenBooks: string[]
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
  /**
   * Books a bet may be recommended at. Quotes from every other book still count
   * toward the reference price, but are never offered as the bet. Omit to allow
   * any book.
   */
  bettableBooks?: string[]
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
  distribution: { pAtLeast(k: number): number; pmf(k: number): number; variance?: number },
  breakEven: number,
): {
  fairLine: number
  overAt: number | null
  overProb: number | null
  underAt: number | null
  underProb: number | null
  ladder: { line: number; over: number; under: number }[]
} {
  // Walk actual half-point lines. Pick'em apps post x.5 almost universally, and
  // a whole number would introduce a push the targets do not account for.
  // The window is 15 either side, widened to 1.5 standard deviations where
  // that is larger. 15 covers every basketball stat (which is why basketball
  // targets are unchanged), but a 250-yard passing line has a standard
  // deviation near 70, and a fixed 15 would cut the search off before the
  // target. 1.5 sd reaches any bar up to about 93%, far beyond any payout table.
  const sd = Math.sqrt(Math.max(distribution.variance ?? 0, 0))
  const reach = Math.max(15, Math.ceil(1.5 * sd))
  const start = Math.max(0.5, Math.floor(mean - reach) + 0.5)
  const end = Math.ceil(mean + reach) + 0.5

  let fairLine = Math.round(mean - 0.5) + 0.5
  let bestGap = Infinity
  let overAt: number | null = null
  let overProb: number | null = null
  let underAt: number | null = null
  let underProb: number | null = null
  const ladder: { line: number; over: number; under: number }[] = []

  for (let half = start; half <= end; half += 1) {
    if (half <= 0) continue
    const { over, under } = resolveLine(distribution as never, half)
    ladder.push({ line: half, over, under })

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

  return { fairLine, overAt, overProb, underAt, underProb, ladder }
}

/**
 * The line most of the books are hanging: the one a pick'em app copies. Ties
 * go to the line nearest the projection.
 */
export function marketLineOf(lines: number[], mean: number): number {
  const counts = new Map<number, number>()
  for (const l of lines) counts.set(l, (counts.get(l) ?? 0) + 1)
  let best = lines[0]
  let bestCount = -1
  for (const [line, n] of counts) {
    if (n > bestCount || (n === bestCount && Math.abs(line - mean) < Math.abs(best - mean))) {
      best = line
      bestCount = n
    }
  }
  return best
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

    const marketLine = marketLineOf(group.quotes.map((q) => q.line), ref.mean)
    const atMarket = resolveLine(ref.distribution as never, marketLine)
    const marketSide = atMarket.over >= atMarket.under ? "OVER" : "UNDER"

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
      marketLine,
      marketSide,
      marketProb: Math.max(atMarket.over, atMarket.under),
      ...t,
    })
  }

  // Most likely to hit first, at the line the app is most likely showing.
  return out.sort((a, b) => b.marketProb - a.marketProb)
}

export interface PickemLeg {
  target: DfsTarget
  side: "OVER" | "UNDER"
  line: number
  prob: number
}

/**
 * A pick'em entry to play: the likeliest targets that clear the bar, at the
 * books' line, which is the line PrizePicks, Underdog, Sleeper and the rest
 * almost always post.
 *
 * One leg per player, so it never holds both sides of anything, and at most
 * two per game, so one blowout cannot sink the whole entry. Null when fewer
 * targets clear the bar than the entry needs: a short entry padded with
 * coin flips is the bet the bar exists to stop.
 */
export function buildPickemEntry(targets: DfsTarget[], size: number, bar: number, maxPerGame = 2): PickemLeg[] | null {
  const legs: PickemLeg[] = []
  const players = new Set<string>()
  const games = new Map<string, number>()
  for (const t of [...targets].sort((a, b) => b.marketProb - a.marketProb)) {
    if (legs.length >= size) break
    if (t.marketProb < bar) break
    const who = t.player.toLowerCase()
    if (players.has(who) || (games.get(t.gameId) ?? 0) >= maxPerGame) continue
    players.add(who)
    games.set(t.gameId, (games.get(t.gameId) ?? 0) + 1)
    legs.push({ target: t, side: t.marketSide, line: t.marketLine, prob: t.marketProb })
  }
  return legs.length === size ? legs : null
}

/** The chance a side hits at a given line, if the line is one the target priced. */
export function probAt(t: Pick<DfsTarget, "ladder">, line: number, side: "OVER" | "UNDER"): number | null {
  const step = t.ladder.find((r) => Math.abs(r.line - line) < 1e-9)
  return step ? (side === "OVER" ? step.over : step.under) : null
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

  const everyValue = findValueBets(quotes, opts.value, now)
  // References judge the price; only books you can use are offered as the bet.
  const bettable = opts.bettableBooks ? new Set(opts.bettableBooks) : null
  const allValue = bettable ? everyValue.filter((b) => bettable.has(b.book)) : everyValue
  // One decision per prop, then most likely to hit first. Edge is still on
  // every row; probability is what the list is read by.
  const valueBets = bestPerSelection(allValue).sort((a, b) => b.fairProb - a.fairProb)

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
    stats: {
      quotes: quotes.length,
      props: groups.length,
      booksSeen,
      pricedProps,
      hiddenOffers: everyValue.length - allValue.length,
      hiddenBooks: Array.from(new Set(everyValue.filter((b) => !allValue.includes(b)).map((b) => b.book))).sort(),
    },
  }
}

/**
 * The one thing to do with a target, given the line your pick'em app is
 * showing: take the over, take the under, or pass.
 *
 * A target carries both thresholds, an over at or below one number and an
 * under at or above a higher one. Printed side by side they read as two
 * picks, and people played both. Against a real line only one can apply,
 * and between the two thresholds neither does.
 */
export function dfsVerdict(t: Pick<DfsTarget, "overAt" | "underAt" | "fairLine">, appLine: number): "OVER" | "UNDER" | "PASS" {
  if (!Number.isFinite(appLine)) return "PASS"
  const over = t.overAt != null && appLine <= t.overAt
  const under = t.underAt != null && appLine >= t.underAt
  // Both can only hold if the bar sits below a coin flip, which no payout
  // table does; if it ever happens, the side further from fair wins.
  if (over && under) return appLine < t.fairLine ? "OVER" : "UNDER"
  return over ? "OVER" : under ? "UNDER" : "PASS"
}

/** Fair price for a target line, for display beside the DFS numbers. */
export function fairPriceAt(prob: number | null): number | null {
  return prob == null ? null : probToAmerican(prob)
}
