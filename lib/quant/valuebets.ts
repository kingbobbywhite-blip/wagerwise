import { MARKETS, type MarketKey } from "@/lib/nba/markets"
import type { LeagueId } from "@/lib/leagues"
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
import { normalizeName, playerKeyIn } from "./correlation"

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
  /**
   * Which competition the prop belongs to, when a league's section covers more
   * than one. College football is pulled inside the NFL section and arrives
   * as "cfb", and it is priced with CFB priors and CFB plausibility ceilings
   * rather than the section's. Absent means the section's own league.
   */
  competition?: LeagueId
}

export type ValueSide = "OVER" | "UNDER"

export interface ValueBet {
  id: string
  player: string
  market: MarketKey
  marketLabel: string
  gameId: string
  /** Set when the pull covered more than one competition: "cfb" inside the NFL section. */
  competition?: LeagueId
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
  /**
   * The best opposite side that also priced positive and was dropped, because
   * one prop gets one decision. Shown on the row so it is not silently hidden.
   */
  otherSide?: { side: ValueSide; line: number; bookName: string; edge: number }
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
  /**
   * Commission an exchange takes on net winnings, by book id (ProphetX's 2%).
   * The posted price is gross, so the edge and the stake are judged on what
   * actually comes back. Books not listed pay what they post.
   */
  commission?: Record<string, number>
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
  /** The competition these quotes came from, when the pull covered more than one. */
  competition?: LeagueId
  quotes: FeedQuote[]
}

/**
 * Group feed quotes by player, market and game.
 *
 * The game is in the key because a name is not an identity: see playerKeyIn.
 * It was left out on the reasoning that a player has one game a day, which is
 * true of a person and false of a name once the slate holds 130 college teams.
 * Without it, two players sharing a normalised name had their books pooled
 * into one consensus, and whichever line came back was wrong for both.
 */
export function groupQuotes(quotes: FeedQuote[]): PropGroup[] {
  const map = new Map<string, PropGroup>()
  for (const q of quotes) {
    const key = `${playerKeyIn(q.player, q.gameId)}|${q.market}`
    const g = map.get(key)
    if (g) g.quotes.push(q)
    else
      map.set(key, {
        key,
        player: q.player,
        market: q.market,
        gameId: q.gameId,
        commenceTime: q.commenceTime ?? null,
        competition: q.competition,
        quotes: [q],
      })
  }
  return Array.from(map.values())
}

/**
 * Normalised player names that appear in more than one game in this pull.
 *
 * These are the names where any match made on the name alone — a pick'em line
 * from the other feed, a row on an imported board — can land on the wrong
 * person. Nothing is dropped for being ambiguous; it is reported, because a
 * silently wrong price is the one failure this app exists to prevent.
 */
export function ambiguousPlayers(quotes: FeedQuote[]): Set<string> {
  const games = new Map<string, Set<string>>()
  for (const q of quotes) {
    const who = normalizeName(q.player)
    const set = games.get(who) ?? new Set<string>()
    set.add(q.gameId)
    games.set(who, set)
  }
  const out = new Set<string>()
  for (const [who, set] of games) if (set.size > 1) out.add(who)
  return out
}

/**
 * Build a reference projection from a set of quotes.
 * Returns null when the set cannot support one.
 */
/**
 * How much wider a projection should be for a line priced days before kickoff.
 *
 * Returns a multiplier on variance. This is the NFL's and college football's
 * particular trap: props post on Tuesday for a Sunday game, and between those
 * two days a starter is ruled out, a backfield split changes, or a weather
 * forecast turns over. The price you pulled was correct for what was known
 * then, and the uncertainty about what will be known by kickoff is real
 * uncertainty that belongs in the distribution rather than in a footnote.
 *
 * Four percent of variance per day, capped at twelve percent, which is three
 * days out. On an NBA or NHL slate pulled the same evening it is under four
 * percent and changes nothing; on a passing line pulled midweek it widens the
 * spread about six percent and pulls every probability back toward a coin flip.
 * Deliberately modest: it is a known unknown, not a reason to stop pricing.
 */
export function kickoffVarianceFactor(commenceTime: string | null | undefined, now: number): number {
  const t = commenceTime ? Date.parse(commenceTime) : NaN
  if (!Number.isFinite(t)) return 1
  const days = (t - now) / 86_400_000
  if (!(days > 0)) return 1
  return 1 + Math.min(0.12, 0.04 * days)
}

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

  // Price each competition with its own priors and ceilings. A college game
  // pulled inside the NFL section is a college game: wider, and with room for
  // a 500-yard passer in the plausibility check.
  const projection: ProjectionSettings = {
    ...settings.projection,
    league: group.competition ?? settings.projection.league,
    dispersion: {
      ...settings.projection.dispersion,
      global:
        (settings.projection.dispersion.global ?? 1) * kickoffVarianceFactor(group.commenceTime, now),
    },
  }

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
    projection,
    `|ref`,
    now,
  )
}

export function sideEdge(fairProb: number, american: number, commission = 0): { edge: number; kelly: number } {
  // Commission comes off the winnings, not the stake: a +100 at 2% returns 1.98.
  const b = (americanToDecimal(american) - 1) * (1 - clamp(commission, 0, 1))
  const edge = fairProb * (1 + b) - 1
  const kelly = b <= 0 ? 0 : Math.max(0, edge / b)
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
  const ambiguous = ambiguousPlayers(quotes)

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

        const { edge, kelly } = sideEdge(s.fairProb, s.price, settings.commission?.[offer.book] ?? 0)
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
        if (ambiguous.has(normalizeName(group.player))) {
          warnings.unshift(
            `Another player on this slate has the same name. This price is from ${group.gameId.replace("@", " at ")} only, but check the app is showing you the right player before betting it.`,
          )
        }

        out.push({
          id: `${group.key}|${offer.book}|${s.side}|${offer.line}`,
          player: group.player,
          market: group.market,
          marketLabel: MARKETS[group.market].label,
          gameId: group.gameId,
          competition: group.competition,
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
 * Collapse every opinion on the same player and market down to one decision:
 * the single best-priced side.
 *
 * Duplicates at five books are the same decision five times. And an over at
 * one book beside an under at another is not two picks: offered both, people
 * take both, and on a pick'em app, where every side pays the same, one of the
 * two is a guaranteed miss. Both can price positive only when the books'
 * lines differ enough to leave a middle, and a middle is a hedge, not an
 * edge. The other side is named on the bet that is kept, so nothing is
 * silently hidden.
 */
export function bestPerSelection(bets: ValueBet[]): ValueBet[] {
  const best = new Map<string, ValueBet>()
  const bestOther = new Map<string, ValueBet>()
  for (const b of bets) {
    // Keyed by game as well, so two same-named players in different games are
    // two decisions rather than one that silently discards the other.
    const key = `${playerKeyIn(b.player, b.gameId)}|${b.market}`
    const existing = best.get(key)
    if (!existing || b.edge > existing.edge) {
      if (existing && existing.side !== b.side) bestOther.set(key, existing)
      best.set(key, b)
    } else if (existing.side !== b.side) {
      const o = bestOther.get(key)
      if (!o || b.edge > o.edge) bestOther.set(key, b)
    }
  }
  for (const [key, kept] of best) {
    const other = bestOther.get(key)
    if (!other || other.side === kept.side) continue
    best.set(key, { ...kept, otherSide: { side: other.side, line: other.line, bookName: other.bookName, edge: other.edge } })
  }
  return Array.from(best.values()).sort((a, b) => b.edge - a.edge)
}
