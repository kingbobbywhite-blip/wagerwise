import { clamp } from "./math"

/**
 * Sportsbook profiles and consensus weighting.
 *
 * Not every posted price carries the same information. A handful of books
 * actually make the market: they take large limits from sharp bettors, move on
 * that action, and their number is the closest thing to a fair estimate that
 * exists. Most retail books copy those numbers with a wider margin and shade
 * them toward public money.
 *
 * Weighting a Pinnacle price equally with a retail one throws away the whole
 * point of using market data. Worse, retail books are correlated with each
 * other, so averaging five of them does not give you five independent opinions,
 * it gives you one opinion counted five times.
 */

export type BookTier = "market-making" | "sharp" | "retail" | "exchange" | "unknown"

export interface BookProfile {
  id: string
  name: string
  tier: BookTier
  /** Relative weight in the consensus. Pinnacle is the reference at 1.0. */
  weight: number
  note: string
  /**
   * The odds feed this book's prices come from, when it shares one with
   * another book here. Books with the same source are one opinion, and count
   * once: see bookConsensus.
   */
  source?: string
}

export const BOOK_PROFILES: BookProfile[] = [
  {
    id: "pinnacle",
    name: "Pinnacle",
    tier: "market-making",
    weight: 1,
    note: "Takes sharp action at high limits and moves on it. The reference price. If Pinnacle is present, it dominates the consensus by design.",
  },
  {
    id: "circa",
    name: "Circa",
    tier: "market-making",
    weight: 0.85,
    note: "High limits, will book sharp money. Strong signal where it posts a market.",
  },
  {
    id: "betonlineag",
    name: "BetOnline",
    tier: "sharp",
    weight: 0.5,
    note: "Posts early and moves fast. Useful, but wider than Pinnacle.",
    source: "betonline",
  },
  {
    id: "bookmaker",
    name: "BookMaker",
    tier: "sharp",
    weight: 0.5,
    note: "Early market. Moderate limits.",
  },
  {
    id: "lowvig",
    name: "LowVig",
    tier: "sharp",
    weight: 0.45,
    note: "BetOnline's reduced-margin sister site: the same lines at less juice, so it counts as BetOnline rather than beside it.",
    source: "betonline",
  },
  {
    id: "draftkings",
    name: "DraftKings",
    tier: "retail",
    weight: 0.2,
    note: "Large retail book. Prices follow the market and shade toward public money.",
  },
  {
    id: "fanduel",
    name: "FanDuel",
    tier: "retail",
    weight: 0.2,
    note: "Large retail book. Same caveat as DraftKings.",
  },
  {
    id: "betmgm",
    name: "BetMGM",
    tier: "retail",
    weight: 0.15,
    note: "Retail. Follows the market.",
  },
  {
    id: "caesars",
    name: "Caesars",
    tier: "retail",
    weight: 0.15,
    note: "Retail. Follows the market.",
    source: "caesars",
  },
  {
    id: "espnbet",
    name: "ESPN BET",
    tier: "retail",
    weight: 0.1,
    note: "Retail. Frequently the slowest to move.",
  },
  {
    id: "williamhill_us",
    name: "Caesars",
    tier: "retail",
    weight: 0.15,
    note: "Retail. The feed's id for Caesars Sportsbook.",
    source: "caesars",
  },
  { id: "betrivers", name: "BetRivers", tier: "retail", weight: 0.1, note: "Retail." },
  { id: "fanatics", name: "Fanatics", tier: "retail", weight: 0.1, note: "Retail." },
  { id: "hardrockbet", name: "Hard Rock", tier: "retail", weight: 0.1, note: "Retail." },
  { id: "bovada", name: "Bovada", tier: "retail", weight: 0.1, note: "Retail, offshore. Deep prop menu on PropLine, slow to move." },
  // Exchanges, as PropLine carries them. A price there is whatever the last
  // participant posted, often a thin offer with a few dollars behind it, so
  // they sit in the capped bloc with the retail books and never anchor the
  // consensus. Offers below the liquidity floor are dropped before they get here.
  {
    id: "prophetx",
    name: "ProphetX",
    tier: "exchange",
    weight: 0.1,
    note: "Peer-to-peer exchange. Best price is often a thin offer; thin ones are dropped.",
  },
  {
    id: "polymarket",
    name: "Polymarket",
    tier: "exchange",
    weight: 0.1,
    note: "Prediction-market contract. Liquid on headline markets, thin on most props.",
  },
  { id: "kalshi", name: "Kalshi", tier: "exchange", weight: 0.1, note: "Regulated event contracts. Prop depth varies." },
  { id: "novig", name: "Novig", tier: "exchange", weight: 0.1, note: "No-vig exchange. Prices are only as good as the resting size." },
]

const BY_ID = new Map(BOOK_PROFILES.map((b) => [b.id, b]))

export function bookProfile(id: string): BookProfile {
  return (
    BY_ID.get(id.toLowerCase()) ?? {
      id,
      name: id,
      tier: "unknown",
      weight: 0.1,
      note: "Unrecognised book. Weighted low because its price quality is unknown.",
    }
  )
}

/**
 * The odds feed behind a book. Two books with the same source are one
 * opinion: LowVig is BetOnline's sister site, hanging the same lines at less
 * juice, and Caesars arrives under two ids.
 */
export function sourceOf(id: string): string {
  const p = bookProfile(id)
  return p.source ?? p.id.toLowerCase()
}

export function isSharp(id: string): boolean {
  const t = bookProfile(id).tier
  return t === "market-making" || t === "sharp"
}

/**
 * Retail books largely copy the same source, so a room full of them is close to
 * one opinion repeated. Their combined weight is capped rather than summed, to
 * stop five correlated copies from outvoting the book that set the number.
 * Exchanges and unrecognised books count toward the same cap.
 */
export const RETAIL_WEIGHT_CAP = 0.45

export interface WeightedBookInput {
  book: string
  value: number
}

export interface ConsensusResult {
  value: number
  /** Sum of the weights that actually contributed. */
  totalWeight: number
  /** True when at least one market-making or sharp book contributed. */
  hasSharp: boolean
  /** True when a market-making book (Pinnacle, Circa) contributed, not just a sharp one. */
  hasMarketMaker: boolean
  /**
   * The weighted estimate of each bloc on its own: the sharp books, and the
   * capped retail bloc. Null for a bloc with nobody in it. Where no market-
   * making book is present these are two independent opinions, and an edge
   * that only one of them sees is not one to trust: see projectProp.
   */
  blocs: { sharp: number | null; retail: number | null }
  /** Spread between the highest and lowest contributing estimate. */
  disagreement: number
  contributors: { book: string; weight: number; value: number }[]
}

/**
 * Weighted consensus across books, with the retail bloc capped.
 */
export function bookConsensus(inputs: WeightedBookInput[]): ConsensusResult | null {
  const finite = inputs.filter((i) => Number.isFinite(i.value))
  if (finite.length === 0) return null

  // One opinion per source. LowVig hangs BetOnline's lines, so counted beside
  // it the one book carried 0.95 of weight, about two thirds of an NBA
  // consensus on PropLine (which has no Pinnacle props), and its depth pushed
  // the consensus quality to the maximum. A source is represented by its
  // heaviest book, at the mean of what its books said.
  const bySource = new Map<string, WeightedBookInput[]>()
  for (const i of finite) {
    const key = sourceOf(i.book)
    const members = bySource.get(key)
    if (members) members.push(i)
    else bySource.set(key, [i])
  }
  const usable = Array.from(bySource.values()).map((members) => {
    const lead = members.reduce((a, b) => (bookProfile(b.book).weight > bookProfile(a.book).weight ? b : a))
    return { book: lead.book, value: members.reduce((a, m) => a + m.value, 0) / members.length }
  })

  const sharp = usable.filter((i) => isSharp(i.book))
  const retail = usable.filter((i) => !isSharp(i.book))

  const contributors: { book: string; weight: number; value: number }[] = []
  for (const i of sharp) {
    contributors.push({ book: i.book, weight: bookProfile(i.book).weight, value: i.value })
  }

  if (retail.length > 0) {
    const rawRetail = retail.reduce((a, i) => a + bookProfile(i.book).weight, 0)
    // Scale the whole retail bloc down if it would exceed its cap.
    const scale = rawRetail > RETAIL_WEIGHT_CAP ? RETAIL_WEIGHT_CAP / rawRetail : 1
    for (const i of retail) {
      contributors.push({ book: i.book, weight: bookProfile(i.book).weight * scale, value: i.value })
    }
  }

  const totalWeight = contributors.reduce((a, c) => a + c.weight, 0)
  if (totalWeight <= 0) return null

  const value = contributors.reduce((a, c) => a + c.value * c.weight, 0) / totalWeight
  const values = usable.map((i) => i.value)
  const blocOf = (members: typeof contributors) => {
    const w = members.reduce((a, c) => a + c.weight, 0)
    return w > 0 ? members.reduce((a, c) => a + c.value * c.weight, 0) / w : null
  }

  return {
    value,
    totalWeight,
    hasSharp: sharp.length > 0,
    hasMarketMaker: sharp.some((i) => bookProfile(i.book).tier === "market-making"),
    blocs: {
      sharp: blocOf(contributors.filter((c) => isSharp(c.book))),
      retail: blocOf(contributors.filter((c) => !isSharp(c.book))),
    },
    disagreement: Math.max(...values) - Math.min(...values),
    contributors: contributors.sort((a, b) => b.weight - a.weight),
  }
}

/**
 * How much to trust a consensus, on a 0-1 scale, from the books behind it.
 * A single retail price is worth far less than a Pinnacle number.
 */
export function consensusQuality(c: ConsensusResult): number {
  const base = c.hasSharp ? 0.75 : 0.3
  const depth = clamp(c.totalWeight / 1.2, 0, 1) * 0.25
  return clamp(base + depth, 0, 1)
}
