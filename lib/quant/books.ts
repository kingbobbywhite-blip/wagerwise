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

export type BookTier = "market-making" | "sharp" | "retail" | "unknown"

export interface BookProfile {
  id: string
  name: string
  tier: BookTier
  /** Relative weight in the consensus. Pinnacle is the reference at 1.0. */
  weight: number
  note: string
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
    note: "Reduced-margin book, largely mirrors the sharp market.",
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
    name: "Caesars (William Hill)",
    tier: "retail",
    weight: 0.15,
    note: "Retail.",
  },
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

export function isSharp(id: string): boolean {
  const t = bookProfile(id).tier
  return t === "market-making" || t === "sharp"
}

/**
 * Retail books largely copy the same source, so a room full of them is close to
 * one opinion repeated. Their combined weight is capped rather than summed, to
 * stop five correlated copies from outvoting the book that set the number.
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
  /** Spread between the highest and lowest contributing estimate. */
  disagreement: number
  contributors: { book: string; weight: number; value: number }[]
}

/**
 * Weighted consensus across books, with the retail bloc capped.
 */
export function bookConsensus(inputs: WeightedBookInput[]): ConsensusResult | null {
  const usable = inputs.filter((i) => Number.isFinite(i.value))
  if (usable.length === 0) return null

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

  return {
    value,
    totalWeight,
    hasSharp: sharp.length > 0,
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
