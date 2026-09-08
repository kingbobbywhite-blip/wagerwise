import type { BankrollSettings } from "@/lib/store/schema"
import { clamp } from "./math"

/**
 * Stake sizing.
 *
 * Full Kelly is the growth-optimal stake only if your probabilities are exactly
 * right. They are not. Every input here is an estimate, and overestimating your
 * edge makes Kelly overbet in a way that compounds badly, so the default is a
 * quarter Kelly with a hard percentage cap on top.
 */
export interface StakeAdvice {
  stake: number
  units: number
  fullKellyStake: number
  /** What actually determined the number. */
  limitedBy: "no-edge" | "kelly" | "bankroll-cap"
  note: string
}

export function recommendStake(kellyFull: number, b: BankrollSettings): StakeAdvice {
  const fullKellyStake = Math.max(0, kellyFull) * b.bankroll
  if (kellyFull <= 0) {
    return {
      stake: 0,
      units: 0,
      fullKellyStake: 0,
      limitedBy: "no-edge",
      note: "No positive edge at this price, so the growth-optimal stake is zero.",
    }
  }

  const fractional = kellyFull * clamp(b.kellyFraction, 0.01, 1) * b.bankroll
  const cap = b.bankroll * clamp(b.maxStakePct, 0.001, 1)
  const stake = Math.min(fractional, cap)
  const units = b.unitSize > 0 ? stake / b.unitSize : 0

  return {
    stake,
    units,
    fullKellyStake,
    limitedBy: stake === cap && cap < fractional ? "bankroll-cap" : "kelly",
    note:
      stake === cap && cap < fractional
        ? `Kelly wanted more than your ${(b.maxStakePct * 100).toFixed(1)}% per-entry cap, so the cap is binding.`
        : `${(b.kellyFraction * 100).toFixed(0)}% of the full Kelly stake of ${fullKellyStake.toFixed(2)}.`,
  }
}
