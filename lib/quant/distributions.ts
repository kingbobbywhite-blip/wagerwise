import { bisect, clamp, logFactorial, logGamma, normalCdf } from "./math"

/**
 * Discrete outcome distributions for NBA box-score stats.
 *
 * Why discrete rather than "projection minus line over a standard deviation":
 *  - Box-score stats are integers. Whole-number lines push, and a push is not a
 *    loss. A normal approximation silently prices pushes at zero.
 *  - Counting stats with small means (steals, blocks, threes) are strongly
 *    skewed. A symmetric normal misprices the tails badly, and the tails are
 *    exactly where parlay legs live.
 *
 * Every distribution is parameterised by a mean and a variance. The variance
 * comes from a per-market dispersion ratio (see nba-markets.ts) rather than
 * being assumed equal to the mean, because NBA points are heavily overdispersed
 * relative to Poisson while threes are close to Poisson.
 */

export interface OutcomeDistribution {
  mean: number
  variance: number
  sd: number
  /** P(X = k) for integer k. */
  pmf(k: number): number
  /** P(X <= k) for integer k. */
  cdf(k: number): number
  /** P(X >= k) for integer k. */
  pAtLeast(k: number): number
  /** Largest value held in the tabulated support. */
  support: number
  family: "poisson" | "negbin" | "binomial" | "normal"
}

const MAX_SUPPORT = 400

function tabulate(
  logPmf: (k: number) => number,
  mean: number,
  variance: number,
  family: OutcomeDistribution["family"],
): OutcomeDistribution {
  const sd = Math.sqrt(Math.max(variance, 1e-12))
  const support = Math.min(MAX_SUPPORT, Math.max(8, Math.ceil(mean + 14 * sd + 12)))

  const pmfArr = new Float64Array(support + 1)
  let total = 0
  for (let k = 0; k <= support; k++) {
    const v = Math.exp(logPmf(k))
    const safe = Number.isFinite(v) && v > 0 ? v : 0
    pmfArr[k] = safe
    total += safe
  }
  // Renormalise so the truncated tail does not leak probability.
  if (total > 0) {
    for (let k = 0; k <= support; k++) pmfArr[k] /= total
  } else {
    pmfArr[Math.min(support, Math.round(mean))] = 1
  }

  const cdfArr = new Float64Array(support + 1)
  let acc = 0
  for (let k = 0; k <= support; k++) {
    acc += pmfArr[k]
    cdfArr[k] = acc > 1 ? 1 : acc
  }

  return {
    mean,
    variance,
    sd,
    family,
    support,
    pmf(k: number) {
      const i = Math.round(k)
      if (i < 0 || i > support) return 0
      return pmfArr[i]
    },
    cdf(k: number) {
      const i = Math.floor(k)
      if (i < 0) return 0
      if (i >= support) return 1
      return cdfArr[i]
    },
    pAtLeast(k: number) {
      const i = Math.ceil(k)
      if (i <= 0) return 1
      if (i > support) return 0
      return 1 - cdfArr[i - 1]
    },
  }
}

function poisson(mean: number): OutcomeDistribution {
  const m = Math.max(mean, 1e-6)
  return tabulate((k) => -m + k * Math.log(m) - logFactorial(k), m, m, "poisson")
}

function negativeBinomial(mean: number, variance: number): OutcomeDistribution {
  const m = Math.max(mean, 1e-6)
  const v = Math.max(variance, m * 1.0000001)
  // Mean/variance parameterisation: p = m/v, r = m^2/(v-m)
  const p = m / v
  const r = (m * m) / (v - m)
  const logPmf = (k: number) =>
    logGamma(k + r) - logGamma(r) - logFactorial(k) + r * Math.log(p) + k * Math.log(1 - p)
  return tabulate(logPmf, m, v, "negbin")
}

function binomialUnderdispersed(mean: number, variance: number): OutcomeDistribution {
  const m = Math.max(mean, 1e-6)
  const v = clamp(variance, m * 0.05, m * 0.9999999)
  // mean = n*p, var = n*p*(1-p)  =>  p = 1 - v/m,  n = m/p
  const p = clamp(1 - v / m, 1e-6, 1 - 1e-6)
  const n = Math.max(1, Math.round(m / p))
  const logPmf = (k: number) => {
    if (k > n) return -Infinity
    return logFactorial(n) - logFactorial(k) - logFactorial(n - k) + k * Math.log(p) + (n - k) * Math.log(1 - p)
  }
  return tabulate(logPmf, m, v, "binomial")
}

/**
 * Build a discrete distribution from a mean and a variance, automatically
 * choosing the family that can actually represent that dispersion.
 */
export function countDistribution(mean: number, variance: number): OutcomeDistribution {
  const m = Math.max(mean, 1e-6)
  const v = Math.max(variance, 1e-9)
  if (v > m * 1.02) return negativeBinomial(m, v)
  if (v < m * 0.98) return binomialUnderdispersed(m, v)
  return poisson(m)
}

/**
 * Continuous distribution for stats that are not integer counts (minutes,
 * fantasy score). Discretised onto integers with a continuity correction so it
 * satisfies the same interface.
 */
export function normalDistribution(mean: number, variance: number): OutcomeDistribution {
  const sd = Math.sqrt(Math.max(variance, 1e-9))
  return {
    mean,
    variance,
    sd,
    family: "normal",
    support: Math.ceil(mean + 14 * sd + 12),
    pmf(k: number) {
      return normalCdf((k + 0.5 - mean) / sd) - normalCdf((k - 0.5 - mean) / sd)
    },
    cdf(k: number) {
      return normalCdf((Math.floor(k) + 0.5 - mean) / sd)
    },
    pAtLeast(k: number) {
      return 1 - normalCdf((Math.ceil(k) - 0.5 - mean) / sd)
    },
  }
}

// ---------------------------------------------------------------------------
// Line resolution
// ---------------------------------------------------------------------------

export interface LineProbabilities {
  /** P(stat finishes strictly above the line). */
  over: number
  /** P(stat finishes strictly below the line). */
  under: number
  /** P(stat lands exactly on the line). Always 0 for half-point lines. */
  push: number
}

/**
 * Resolve a posted line against a distribution.
 *
 * Half-point lines (24.5) cannot push: over is P(X >= 25), under is P(X <= 24).
 * Whole-number lines (24) push on exactly 24, so the three outcomes are
 * P(X >= 25), P(X <= 23) and P(X = 24). Getting this wrong is worth real money
 * on DFS apps, where a push voids the leg and shrinks the payout table instead
 * of losing the slip.
 */
export function resolveLine(dist: OutcomeDistribution, line: number): LineProbabilities {
  const isWhole = Math.abs(line - Math.round(line)) < 1e-9
  if (isWhole) {
    const n = Math.round(line)
    const push = dist.pmf(n)
    const over = dist.pAtLeast(n + 1)
    const under = Math.max(0, 1 - over - push)
    return { over, under, push }
  }
  const over = dist.pAtLeast(Math.ceil(line))
  return { over, under: Math.max(0, 1 - over), push: 0 }
}

/**
 * Invert a line probability back into a projected mean.
 *
 * This is how a priced sportsbook line becomes a projection: given that the
 * fair probability of going over 24.5 points is 0.53, what average must the
 * player be expected to score? Monotone in the mean, so bisection is safe.
 *
 * @param buildDist  maps a candidate mean to a distribution (the caller supplies
 *                   the market's dispersion model)
 */
export function meanImpliedByLine(
  line: number,
  pOver: number,
  buildDist: (mean: number) => OutcomeDistribution,
): number {
  const target = clamp(pOver, 1e-4, 1 - 1e-4)
  const lo = Math.max(0.05, line * 0.15)
  const hi = Math.max(line * 3 + 6, 12)
  const f = (m: number) => resolveLine(buildDist(m), line).over - target
  return bisect(f, lo, hi, 1e-7, 120)
}
