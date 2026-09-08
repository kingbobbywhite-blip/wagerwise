import { MARKETS, type MarketKey } from "@/lib/nba/markets"
import { resolveLine } from "./distributions"
import { bookProfile, isSharp } from "./books"
import { americanToDecimal, probToAmerican } from "./odds"
import {
  projectProp,
  DEFAULT_PROJECTION_SETTINGS,
  type BookQuote,
  type ProjectedProp,
  type ProjectionSettings,
} from "./projection"
import { clamp } from "./math"

/**
 * Finding bets that are priced wrong.
 *
 * The idea is old and it is the only thing on a sportsbook that reliably makes
 * money: a handful of books set the number, everyone else copies it, and the
 * copies lag. When a retail book is still offering Over 24.5 at -105 while the
 * sharp consensus says that side is worth -130, the difference is yours.
 *
 * Two rules keep this honest:
 *
 *  1. The book being evaluated is excluded from the consensus it is measured
 *     against. Otherwise a book partly prices itself and every quote looks a
 *     little bit like value.
 *  2. At least one market-making book must remain in the consensus afterwards.
 *     A consensus of copies is not a reference price, it is the same lag
 *     measured twice.
 *
 * What this does NOT do is find edge on the sharp book itself. If Pinnacle is
 * the only price, there is nothing to compare it to, and the honest output is
 * no bet.
 */

export interface FeedQuote extends BookQuote {
  player: string
  market: MarketKey
  gameId: string
  homeTeam?: string
  awayTeam?: string
  commenceTime?: string
}

export type ValueSide = "OVER" | "UNDER"

export interface ValueBet {
  id: string
  player: string
  market: MarketKey
  marketLabel: string
  gameId: string
  commenceTime: string | null

  book: string
  bookName: string
  bookTier: string
  side: ValueSide
  line: number
  /** The price this book is offering. */
  price: number

  /** Probability the model gives this side, from the consensus of other books. */
  fairProb: number
  /** That probability expressed as a price. */
  fairPrice: number
  /** fairProb x decimal odds − 1. Expected profit per unit staked. */
  edge: number
  /** Full Kelly fraction for this single bet. */
  kelly: number

  consensusMean: number
  consensusSd: number
  /** Books that formed the reference price. */
  referenceBooks: string[]
  /** Line the sharp consensus itself sits on, for eyeballing the gap. */
  consensusLine: number
  confidence: number
  warnings: string[]
}

export interface ValueBetSettings {
  projection: ProjectionSettings
  /** Ignore anything below this edge. */
  minEdge: number
  /** Flag anything above this as more likely stale or mismatched than real. */
  suspiciousEdge: number
  /** Require a market-making book in the reference consensus. */
  requireSharpReference: boolean
  /** Reject prices longer than this; the model is least reliable in the tails. */
  maxAmerican: number
}

export const DEFAULT_VALUE_SETTINGS: ValueBetSettings = {
  projection: DEFAULT_PROJECTION_SETTINGS,
  minEdge: 0.02,
  suspiciousEdge: 0.12,
  requireSharpReference: true,
  maxAmerican: 400,
}

export interface PropGroup {
  key: string
  player: string
  market: MarketKey
  gameId: string
  commenceTime: string | null
  quotes: FeedQuote[]
}

/** Group feed quotes by player and market. */
export function groupQuotes(quotes: FeedQuote[]): PropGroup[] {
  const map = new Map<string, PropGroup>()
  for (const q of quotes) {
    const key = `${q.player.toLowerCase()}|${q.market}`
    const g = map.get(key)
    if (g) g.quotes.push(q)
    else
      map.set(key, {
        key,
        player: q.player,
        market: q.market,
        gameId: q.gameId,
        commenceTime: q.commenceTime ?? null,
        quotes: [q],
      })
  }
  return Array.from(map.values())
}

/**
 * Build a reference projection from a set of quotes.
 * Returns null when the set cannot support one.
 */
export function referenceProjection(
  group: PropGroup,
  quotes: FeedQuote[],
  settings: ValueBetSettings,
  now: number,
): ProjectedProp | null {
  if (quotes.length === 0) return null
  if (settings.requireSharpReference && !quotes.some((q) => isSharp(q.book))) return null

  // Evaluate at the median quoted line; the exact choice does not matter because
  // the projection is inverted back into a mean either way.
  const lines = quotes.map((q) => q.line).sort((a, b) => a - b)
  const median = lines[Math.floor(lines.length / 2)]

  return projectProp(
    {
      player: group.player,
      market: MARKETS[group.market].label,
      line: median,
      gameId: group.gameId,
      quotes: quotes.map((q) => ({
        book: q.book,
        line: q.line,
        overOdds: q.overOdds,
        underOdds: q.underOdds,
        fetchedAt: q.fetchedAt ?? null,
      })),
    },
    settings.projection,
    `|ref`,
    now,
  )
}

function sideEdge(fairProb: number, american: number): { edge: number; kelly: number } {
  const decimal = americanToDecimal(american)
  const edge = fairProb * decimal - 1
  const b = decimal - 1
  const kelly = b <= 0 ? 0 : Math.max(0, (fairProb * decimal - 1) / b)
  return { edge, kelly }
}

/**
 * Scan every book's every offer for a price better than the consensus of the
 * other books.
 */
export function findValueBets(
  quotes: FeedQuote[],
  settings: ValueBetSettings = DEFAULT_VALUE_SETTINGS,
  now: number = Date.now(),
): ValueBet[] {
  const out: ValueBet[] = []

  for (const group of groupQuotes(quotes)) {
    // A single price has nothing to be measured against.
    if (group.quotes.length < 2) continue

    for (const offer of group.quotes) {
      // Leave-one-out: a book never contributes to the consensus that judges it.
      const others = group.quotes.filter((q) => q !== offer)
      const ref = referenceProjection(group, others, settings, now)
      if (!ref || ref.status !== "priced") continue

      const probs = resolveLine(ref.distribution, offer.line)
      const sides: { side: ValueSide; price: number | null; fairProb: number }[] = [
        { side: "OVER", price: offer.overOdds ?? null, fairProb: probs.over },
        { side: "UNDER", price: offer.underOdds ?? null, fairProb: probs.under },
      ]

      for (const s of sides) {
        if (s.price == null || !Number.isFinite(s.price)) continue
        if (Math.abs(s.price) > settings.maxAmerican && s.price > 0) continue

        const { edge, kelly } = sideEdge(s.fairProb, s.price)
        if (edge < settings.minEdge) continue

        const warnings = [...ref.warnings]
        if (edge > settings.suspiciousEdge) {
          warnings.unshift(
            `An edge of ${(edge * 100).toFixed(1)}% is larger than these markets normally offer. The usual cause is a line that has already moved, or a prop matched to the wrong player, rather than real value. Check the price is still up before betting it.`,
          )
        }
        if (!ref.hasSharpBook) {
          warnings.unshift("No market-making book in the reference price, so this comparison is weak.")
        }
        if (ref.isStale) {
          warnings.unshift("Reference prices are stale. Re-pull before acting on this.")
        }

        out.push({
          id: `${group.key}|${offer.book}|${s.side}|${offer.line}`,
          player: group.player,
          market: group.market,
          marketLabel: MARKETS[group.market].label,
          gameId: group.gameId,
          commenceTime: group.commenceTime,
          book: offer.book,
          bookName: bookProfile(offer.book).name,
          bookTier: bookProfile(offer.book).tier,
          side: s.side,
          line: offer.line,
          price: s.price,
          fairProb: s.fairProb,
          fairPrice: probToAmerican(s.fairProb),
          edge,
          kelly: clamp(kelly, 0, 1),
          consensusMean: ref.mean,
          consensusSd: ref.sd,
          referenceBooks: ref.books.map((b) => b.book),
          consensusLine: ref.line,
          confidence: ref.confidence,
          warnings,
        })
      }
    }
  }

  // Best edge first, but a suspicious edge sorts below a believable one of
  // similar size, because acting on the first kind is how you lose money fast.
  return out.sort((a, b) => {
    const aSus = a.edge > settings.suspiciousEdge ? 1 : 0
    const bSus = b.edge > settings.suspiciousEdge ? 1 : 0
    if (aSus !== bSus) return aSus - bSus
    return b.edge - a.edge
  })
}

/**
 * Collapse duplicate opinions on the same player, market and side down to the
 * single best-priced one, so a list of bets is a list of decisions rather than
 * the same decision at five books.
 */
export function bestPerSelection(bets: ValueBet[]): ValueBet[] {
  const best = new Map<string, ValueBet>()
  for (const b of bets) {
    const key = `${b.player.toLowerCase()}|${b.market}|${b.side}`
    const existing = best.get(key)
    if (!existing || b.edge > existing.edge) best.set(key, b)
  }
  return Array.from(best.values()).sort((a, b) => b.edge - a.edge)
}
