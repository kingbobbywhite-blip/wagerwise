import { logFactorial } from "./math"

/**
 * Binomial helpers for payout-tier maths.
 *
 * A pick'em entry with partial-payout tiers cannot be evaluated by looking at
 * the all-hit tier alone. The expected return is the sum across every tier that
 * pays, weighted by the probability of landing exactly that many legs.
 */

/** log of n choose k. */
export function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k)
}

export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  return Math.round(Math.exp(logChoose(n, k)))
}

/** P(exactly k successes in n independent trials each with probability p). */
export function binomialPmf(n: number, k: number, p: number): number {
  if (k < 0 || k > n) return 0
  if (p <= 0) return k === 0 ? 1 : 0
  if (p >= 1) return k === n ? 1 : 0
  return Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p))
}

/** Full distribution over the number of successes, indexed by k. */
export function binomialDistribution(n: number, p: number): number[] {
  const out: number[] = []
  for (let k = 0; k <= n; k++) out.push(binomialPmf(n, k, p))
  return out
}
