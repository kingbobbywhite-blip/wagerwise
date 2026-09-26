import { bisect, clamp } from "./math"

/**
 * Odds conversions and vig removal.
 *
 * The single most important idea in this file: a sportsbook's posted price is
 * NOT a probability. It is a probability plus a margin. Two-sided prices on a
 * player prop typically sum to 104-110%. If you compare a DFS pick'em line to a
 * raw implied probability you will systematically think you have edge that you
 * do not have. Everything downstream consumes devigged ("fair") probabilities.
 */

export function americanToDecimal(american: number): number {
  if (american === 0) return 1
  return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american)
}

export function decimalToAmerican(decimal: number): number {
  if (decimal <= 1) return 0
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1))
}

/** Implied probability INCLUDING the book's margin. */
export function americanToProb(american: number): number {
  return american > 0 ? 100 / (american + 100) : Math.abs(american) / (Math.abs(american) + 100)
}

export function probToDecimal(p: number): number {
  return p <= 0 ? Infinity : 1 / p
}

export function probToAmerican(p: number): number {
  const q = clamp(p, 1e-6, 1 - 1e-6)
  return decimalToAmerican(1 / q)
}

export function formatAmerican(a: number | null | undefined): string {
  if (a == null || !Number.isFinite(a)) return "--"
  return a > 0 ? `+${Math.round(a)}` : `${Math.round(a)}`
}

// ---------------------------------------------------------------------------
// Vig removal
// ---------------------------------------------------------------------------

export type DevigMethod = "multiplicative" | "additive" | "power" | "shin"

export const DEVIG_METHODS: { value: DevigMethod; label: string; blurb: string }[] = [
  { value: "power", label: "Power", blurb: "Solves for k where the sum of p^k equals one. Best general-purpose choice for player props." },
  { value: "shin", label: "Shin", blurb: "Models the book's margin as protection against insiders. Shades longshots harder." },
  { value: "multiplicative", label: "Proportional", blurb: "Divides every price by the overround. Simple, but overstates longshot probability." },
  { value: "additive", label: "Additive", blurb: "Subtracts the overround evenly. Reasonable only for near-even two-way markets." },
]

/**
 * Remove the margin from a set of raw implied probabilities so they sum to 1.
 * Input probabilities come from americanToProb and normally sum to > 1.
 */
export function devig(raw: number[], method: DevigMethod = "power"): number[] {
  const n = raw.length
  if (n === 0) return []
  const booksum = raw.reduce((a, b) => a + b, 0)
  if (booksum <= 0) return raw.map(() => 1 / n)
  // Nothing to strip (or a negative-hold arbitrage) - just normalise.
  if (booksum <= 1 + 1e-12) return raw.map((q) => q / booksum)

  switch (method) {
    case "multiplicative":
      return raw.map((q) => q / booksum)

    case "additive": {
      const excess = (booksum - 1) / n
      const adj = raw.map((q) => clamp(q - excess, 1e-6, 1 - 1e-6))
      const s = adj.reduce((a, b) => a + b, 0)
      return adj.map((q) => q / s)
    }

    case "power": {
      // Find k > 1 such that sum(q_i^k) = 1.
      const f = (k: number) => raw.reduce((acc, q) => acc + Math.pow(q, k), 0) - 1
      const k = bisect(f, 0.2, 10, 1e-12)
      const adj = raw.map((q) => Math.pow(q, k))
      const s = adj.reduce((a, b) => a + b, 0)
      return adj.map((q) => q / s)
    }

    case "shin": {
      // Solve for the insider-trading fraction z such that the Shin
      // probabilities sum to one.
      const shinProbs = (z: number) =>
        raw.map((q) => {
          const inner = z * z + (4 * (1 - z) * q * q) / booksum
          return (Math.sqrt(Math.max(0, inner)) - z) / (2 * (1 - z))
        })
      const f = (z: number) => shinProbs(z).reduce((a, b) => a + b, 0) - 1
      const z = bisect(f, 1e-9, 0.5, 1e-12)
      const adj = shinProbs(z)
      const s = adj.reduce((a, b) => a + b, 0)
      return adj.map((q) => q / s)
    }
  }
}

export interface FairTwoWay {
  /** Devigged probability the OVER cashes. */
  pOver: number
  /** Devigged probability the UNDER cashes. */
  pUnder: number
  /** Book margin as a percentage, e.g. 4.5 means the prices summed to 104.5%. */
  holdPct: number
  method: DevigMethod
}

/**
 * Strip the vig from a two-way player prop.
 * If only one side is priced we cannot measure the hold, so we assume a typical
 * prop market hold and shade the known side toward fair by half of it. That is
 * a real assumption and is surfaced in the UI as lower confidence.
 */
export function fairTwoWay(
  overAmerican: number | null | undefined,
  underAmerican: number | null | undefined,
  method: DevigMethod = "power",
  assumedHoldPct = 4.5,
): FairTwoWay | null {
  const hasOver = overAmerican != null && Number.isFinite(overAmerican)
  const hasUnder = underAmerican != null && Number.isFinite(underAmerican)

  if (hasOver && hasUnder) {
    const qo = americanToProb(overAmerican as number)
    const qu = americanToProb(underAmerican as number)
    const [pOver, pUnder] = devig([qo, qu], method)
    return { pOver, pUnder, holdPct: (qo + qu - 1) * 100, method }
  }

  const one = hasOver ? americanToProb(overAmerican as number) : hasUnder ? americanToProb(underAmerican as number) : null
  if (one == null) return null
  // Assume the missing side carries half the margin.
  const shaded = clamp(one / (1 + assumedHoldPct / 200), 1e-4, 1 - 1e-4)
  return hasOver
    ? { pOver: shaded, pUnder: 1 - shaded, holdPct: assumedHoldPct, method }
    : { pOver: 1 - shaded, pUnder: shaded, holdPct: assumedHoldPct, method }
}

// ---------------------------------------------------------------------------
// Parlay helpers (traditional sportsbook / exchange legs)
// ---------------------------------------------------------------------------

export function parlayDecimal(legsAmerican: number[]): number {
  return legsAmerican.reduce((acc, a) => acc * americanToDecimal(a), 1)
}

export function parlayAmerican(legsAmerican: number[]): number {
  if (legsAmerican.length === 0) return 0
  return decimalToAmerican(parlayDecimal(legsAmerican))
}

/** Break-even win probability for a price. Anything above this is +EV. */
export function breakEvenProb(american: number): number {
  return 1 / americanToDecimal(american)
}
