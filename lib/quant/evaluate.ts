import type { MarketKey } from "@/lib/nba/markets"
import {
  choleskyWithShrinkage,
  correlationMatrix,
  DEFAULT_CORRELATION,
  type CorrelationLeg,
  type CorrelationSettings,
} from "./correlation"
import { bisect, clamp, hashString, makeRng, normalCdf, normalInvCdf } from "./math"
import { americanToDecimal } from "./odds"
import { breakEvenLegProb, evAtLegProb, payoutMultiple, type PayoutMode } from "./payouts"

export type Side = "OVER" | "UNDER"

export interface EvalLeg {
  id: string
  player: string
  team: string | null
  opponent: string | null
  gameId: string | null
  market: MarketKey | null
  marketLabel: string
  line: number
  side: Side
  /** Modelled probability this leg cashes. */
  pWin: number
  /** Modelled probability this leg voids on a whole-number line. */
  pPush: number
  /** Price on venues that quote each leg (exchange, prediction market). */
  american?: number | null
}

function toCorrelationLeg(l: EvalLeg): CorrelationLeg {
  return {
    player: l.player,
    team: l.team,
    opponent: l.opponent,
    gameId: l.gameId,
    market: l.market,
    isOver: l.side === "OVER",
  }
}

// ---------------------------------------------------------------------------
// Bivariate normal, used by the fast analytic scorer
// ---------------------------------------------------------------------------

const GL_NODES = [
  -0.9815606342467192, -0.9041172563704749, -0.7699026741943047, -0.5873179542866175,
  -0.3678314989981802, -0.1252334085114689, 0.1252334085114689, 0.3678314989981802,
  0.5873179542866175, 0.7699026741943047, 0.9041172563704749, 0.9815606342467192,
]
const GL_WEIGHTS = [
  0.0471753363865118, 0.1069393259953184, 0.1600783285433462, 0.2031674267230659,
  0.2334925365383548, 0.2491470458134028, 0.2491470458134028, 0.2334925365383548,
  0.2031674267230659, 0.1600783285433462, 0.1069393259953184, 0.0471753363865118,
]

/**
 * P(Z1 > h and Z2 > k) for standard bivariate normals with correlation r,
 * via the Drezner-Wesolowsky integral evaluated with Gauss-Legendre.
 */
export function bivariateUpper(h: number, k: number, r: number): number {
  const rho = clamp(r, -0.97, 0.97)
  const base = (1 - normalCdf(h)) * (1 - normalCdf(k))
  if (Math.abs(rho) < 1e-9) return base

  let acc = 0
  const half = rho / 2
  for (let i = 0; i < GL_NODES.length; i++) {
    const s = half * (GL_NODES[i] + 1)
    const den = 1 - s * s
    const expo = -(h * h - 2 * s * h * k + k * k) / (2 * den)
    acc += GL_WEIGHTS[i] * Math.exp(expo) / Math.sqrt(den)
  }
  const integral = (half * acc) / (2 * Math.PI)
  return clamp(base + integral, 0, 1)
}

// ---------------------------------------------------------------------------
// Fast analytic joint probability (used inside the optimizer's search loop)
// ---------------------------------------------------------------------------

/**
 * Approximate P(every leg cashes) under a Gaussian copula using a pairwise
 * product correction:
 *
 *   log P(all) ~= sum(log p_i) + sum over pairs of log( P(i and j) / (p_i p_j) )
 *
 * Exact for two legs, and accurate enough to rank candidate slips during search.
 * Final recommendations are always re-scored with the full simulation, because
 * this expansion drifts once you stack many strongly correlated legs.
 */
export function approxJointAllHit(
  legs: EvalLeg[],
  cfg: CorrelationSettings = DEFAULT_CORRELATION,
): number {
  const n = legs.length
  if (n === 0) return 0
  const p = legs.map((l) => clamp(l.pWin, 1e-6, 1 - 1e-6))
  if (n === 1) return p[0]

  const z = p.map((pi) => normalInvCdf(1 - pi))
  const m = correlationMatrix(legs.map(toCorrelationLeg), cfg)

  let logP = 0
  for (let i = 0; i < n; i++) logP += Math.log(p[i])
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const joint = bivariateUpper(z[i], z[j], m[i][j])
      const indep = p[i] * p[j]
      if (joint > 1e-12 && indep > 1e-12) logP += Math.log(joint / indep)
    }
  }
  return clamp(Math.exp(logP), 0, 1)
}

// ---------------------------------------------------------------------------
// Full simulation
// ---------------------------------------------------------------------------

export interface SimulationResult {
  /** P(count of cashing legs = k), indexed by k. Pushed legs are excluded. */
  hitDistribution: number[]
  /** P(all non-pushed legs cash). */
  pAllHit: number
  /** Joint outcome samples collapsed into gross payout multiples. */
  outcomes: { multiple: number; prob: number }[]
  correlationShrinkage: number
  avgPairCorrelation: number
  simulations: number
}

export interface EvaluateOptions {
  simulations?: number
  correlation?: CorrelationSettings
  /** Fixed seed makes the same slip evaluate identically on every render. */
  seed?: number
  /**
   * Payout table used for the break-even benchmark shown beside expected value.
   * Supplying it is how a mistyped multiplier becomes visible: if the break-even
   * rate does not look like a plausible per-leg number, the table is wrong.
   */
  benchmarkMode?: PayoutMode
  /**
   * Pre-built correlation matrix for exactly these legs, in order. The optimizer
   * computes the full pool matrix once and slices it, which removes the dominant
   * cost from the inner search loop.
   */
  matrix?: number[][]
}

/**
 * Simulate a slip under a Gaussian copula.
 *
 * Rather than sampling each stat line and comparing it to the posted number, we
 * sample directly in the copula's uniform space and compare against thresholds
 * derived from each leg's win and push probability. That is mathematically the
 * same model and is much faster, which matters because the optimizer runs this
 * thousands of times.
 */
/**
 * Maps a simulated outcome to the gross multiple returned on a one-unit stake.
 *
 * `outcomes[i]` is 1 when leg i cashed, 0 when it pushed and -1 when it lost.
 * DFS tables only need the counts; a straight parlay needs to know which legs
 * survived, because its payout is the product of their individual prices.
 */
export type PayoutFn = (wins: number, pushes: number, picks: number, outcomes: Int8Array) => number

export function simulateSlip(
  legs: EvalLeg[],
  payout: PayoutFn,
  opts: EvaluateOptions = {},
): SimulationResult {
  const n = legs.length
  const simulations = opts.simulations ?? 20000
  const cfg = opts.correlation ?? DEFAULT_CORRELATION

  if (n === 0) {
    return { hitDistribution: [1], pAllHit: 0, outcomes: [{ multiple: 0, prob: 1 }], correlationShrinkage: 0, avgPairCorrelation: 0, simulations: 0 }
  }

  const matrix = opts.matrix ?? correlationMatrix(legs.map(toCorrelationLeg), cfg)
  const { L, shrinkage } = choleskyWithShrinkage(matrix)

  let pairSum = 0
  let pairCount = 0
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      pairSum += matrix[i][j]
      pairCount++
    }
  }

  // Thresholds in uniform space: higher u is a better outcome for the leg.
  const loseCut = new Float64Array(n)
  const pushCut = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const pw = clamp(legs[i].pWin, 0, 1)
    const pp = clamp(legs[i].pPush, 0, Math.max(0, 1 - pw))
    const pl = Math.max(0, 1 - pw - pp)
    loseCut[i] = pl
    pushCut[i] = pl + pp
  }

  const seed = opts.seed ?? hashString(legs.map((l) => `${l.id}:${l.side}`).join("|"))
  const rng = makeRng(seed)

  const hitCounts = new Float64Array(n + 1)
  const multipleTally = new Map<number, number>()
  let allHitCount = 0

  const z = new Float64Array(n)
  const legOutcomes = new Int8Array(n)

  for (let s = 0; s < simulations; s++) {
    // Box-Muller pairs for the independent normals.
    for (let i = 0; i < n; i += 2) {
      const u1 = Math.max(rng(), 1e-12)
      const u2 = rng()
      const rad = Math.sqrt(-2 * Math.log(u1))
      const theta = 2 * Math.PI * u2
      z[i] = rad * Math.cos(theta)
      if (i + 1 < n) z[i + 1] = rad * Math.sin(theta)
    }

    let wins = 0
    let pushes = 0
    for (let i = 0; i < n; i++) {
      let acc = 0
      const Li = L[i]
      for (let k = 0; k <= i; k++) acc += Li[k] * z[k]
      const u = normalCdf(acc)
      if (u >= pushCut[i]) {
        wins++
        legOutcomes[i] = 1
      } else if (u >= loseCut[i]) {
        pushes++
        legOutcomes[i] = 0
      } else {
        legOutcomes[i] = -1
      }
    }

    hitCounts[wins]++
    if (wins + pushes === n) allHitCount++

    const mult = payout(wins, pushes, n, legOutcomes)
    multipleTally.set(mult, (multipleTally.get(mult) ?? 0) + 1)
  }

  const hitDistribution = Array.from(hitCounts, (c) => c / simulations)
  const outcomes = Array.from(multipleTally.entries())
    .map(([multiple, count]) => ({ multiple, prob: count / simulations }))
    .sort((a, b) => a.multiple - b.multiple)

  return {
    hitDistribution,
    pAllHit: allHitCount / simulations,
    outcomes,
    correlationShrinkage: shrinkage,
    avgPairCorrelation: pairCount > 0 ? pairSum / pairCount : 0,
    simulations,
  }
}

// ---------------------------------------------------------------------------
// Payout adapters
// ---------------------------------------------------------------------------

/**
 * DFS pick'em payout. A pushed leg is voided and the entry shrinks to the next
 * smaller table, which is how these apps actually settle. If the entry shrinks
 * below the smallest supported size the stake is returned.
 */
export function dfsPayout(mode: PayoutMode): PayoutFn {
  const sizes = Object.keys(mode.table).map(Number)
  const minSize = sizes.length ? Math.min(...sizes) : 2
  return (wins, pushes, picks) => {
    const effective = picks - pushes
    if (effective < minSize) return 1 // stake refunded
    return payoutMultiple(mode, effective, wins)
  }
}

/**
 * Straight parlay payout: the product of the decimal prices of the legs that
 * actually survived, paid only if every surviving leg cashed, less commission
 * on net winnings.
 *
 * A pushed leg drops out of the parlay rather than losing it, which is why the
 * per-leg outcomes are needed and not just the counts. On half-point lines
 * pushes are impossible, so this reduces to the plain product of all prices.
 */
export function oddsParlayPayout(legs: EvalLeg[], commission = 0): PayoutFn {
  const decimals = legs.map((l) => (l.american != null ? americanToDecimal(l.american) : 1.909))
  return (wins, pushes, picks, outcomes) => {
    if (wins < picks - pushes) return 0
    let gross = 1
    for (let i = 0; i < picks; i++) {
      if (outcomes[i] === 1) gross *= decimals[i]
    }
    return 1 + (gross - 1) * (1 - commission)
  }
}

// ---------------------------------------------------------------------------
// Kelly
// ---------------------------------------------------------------------------

/**
 * Kelly stake for a bet with an arbitrary payout distribution.
 *
 * Maximises E[log(1 + f * (multiple - 1))]. The closed-form b*p-q over b only
 * covers two-outcome bets, so it cannot price a flex play where three different
 * multiples are possible. This solves the general case numerically.
 */
export function kellyForOutcomes(outcomes: { multiple: number; prob: number }[]): number {
  const ev = outcomes.reduce((acc, o) => acc + o.prob * o.multiple, 0) - 1
  if (ev <= 0) return 0
  const worst = Math.min(...outcomes.map((o) => o.multiple))
  // Bound f so the bankroll can never go non-positive.
  const upper = worst >= 1 ? 0.999 : clamp(1 / (1 - worst) - 1e-6, 1e-6, 0.999)

  const dLog = (f: number) =>
    outcomes.reduce((acc, o) => {
      const edge = o.multiple - 1
      const denom = 1 + f * edge
      return denom <= 1e-9 ? acc - 1e9 : acc + (o.prob * edge) / denom
    }, 0)

  if (dLog(upper) > 0) return upper
  return clamp(bisect(dLog, 1e-9, upper, 1e-10, 200), 0, upper)
}

// ---------------------------------------------------------------------------
// Top-level slip evaluation
// ---------------------------------------------------------------------------

export interface SlipEvaluation {
  legs: EvalLeg[]
  simulations: number
  outcomes: { multiple: number; prob: number }[]
  hitDistribution: number[]
  /** Expected net profit per unit staked. 0.05 means +5% EV. */
  ev: number
  evPct: number
  expectedReturn: number
  sd: number
  pAllHit: number
  pProfit: number
  pLoseStake: number
  topMultiple: number
  /** EV if the legs were independent, for comparison against the modelled EV. */
  evIndependent: number
  kelly: number
  correlationShrinkage: number
  avgPairCorrelation: number

  /**
   * Per-leg hit rate at which this entry breaks even, summed across every paying
   * tier. Displayed beside expected value so an implausible payout table is
   * obvious on sight: a 4-pick that claims to break even at 20% is a typo, not
   * an opportunity.
   */
  breakEvenLegProb: number | null
  /** Mean of the legs' modelled win probabilities. */
  avgLegProb: number
  /** How far the average leg clears the break-even bar. */
  legProbMargin: number | null
  /**
   * Expected value if every leg were independent at the average leg probability.
   * A large gap against the simulated EV means correlation is doing the work,
   * which is worth knowing before you trust it.
   */
  evAtAvgLegProb: number | null
}

export function evaluateSlip(
  legs: EvalLeg[],
  payout: PayoutFn,
  opts: EvaluateOptions = {},
): SlipEvaluation {
  const sim = simulateSlip(legs, payout, opts)

  let expectedReturn = 0
  let secondMoment = 0
  let pProfit = 0
  let pLoseStake = 0
  let topMultiple = 0
  for (const o of sim.outcomes) {
    expectedReturn += o.prob * o.multiple
    secondMoment += o.prob * o.multiple * o.multiple
    if (o.multiple > 1) pProfit += o.prob
    if (o.multiple <= 0) pLoseStake += o.prob
    if (o.multiple > topMultiple) topMultiple = o.multiple
  }
  const variance = Math.max(0, secondMoment - expectedReturn * expectedReturn)

  // Independence baseline: same payout function, correlations switched off.
  const identity = legs.map((_, i) => legs.map((__, j) => (i === j ? 1 : 0)))
  const indep = simulateSlip(legs, payout, {
    ...opts,
    matrix: identity,
    simulations: Math.min(opts.simulations ?? 20000, 8000),
    correlation: { strength: 0, teammateUsage: 0, gamePace: 0, assistLink: 0 },
  })
  const evIndependent = indep.outcomes.reduce((acc, o) => acc + o.prob * o.multiple, 0) - 1

  const avgLegProb = legs.length > 0 ? legs.reduce((a, l) => a + l.pWin, 0) / legs.length : 0
  const benchmark = opts.benchmarkMode ?? null
  const breakEven = benchmark ? breakEvenLegProb(benchmark, legs.length) : null
  const evAtAvg = benchmark ? evAtLegProb(benchmark, legs.length, avgLegProb) : null

  return {
    legs,
    simulations: sim.simulations,
    outcomes: sim.outcomes,
    hitDistribution: sim.hitDistribution,
    breakEvenLegProb: breakEven,
    avgLegProb,
    legProbMargin: breakEven == null ? null : avgLegProb - breakEven,
    evAtAvgLegProb: evAtAvg,
    ev: expectedReturn - 1,
    evPct: (expectedReturn - 1) * 100,
    expectedReturn,
    sd: Math.sqrt(variance),
    pAllHit: sim.pAllHit,
    pProfit,
    pLoseStake,
    topMultiple,
    evIndependent,
    kelly: kellyForOutcomes(sim.outcomes),
    correlationShrinkage: sim.correlationShrinkage,
    avgPairCorrelation: sim.avgPairCorrelation,
  }
}

/** Convenience wrapper for a DFS entry on a named app and mode. */
export function evaluateDfsSlip(
  legs: EvalLeg[],
  mode: PayoutMode,
  opts: EvaluateOptions = {},
): SlipEvaluation {
  return evaluateSlip(legs, dfsPayout(mode), opts)
}
