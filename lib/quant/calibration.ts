import { clamp, normalInvCdf } from "./math"
import type { MarketKey } from "@/lib/nba/markets"
import type { LeagueId } from "@/lib/leagues"

/**
 * Did the model tell the truth?
 *
 * A betting model is not judged by its win rate. It is judged by calibration:
 * when it says 60%, do those legs land 60% of the time? A model that says 70%
 * and hits 55% will bankrupt you slowly while looking like bad luck. This is the
 * only part of the app that can tell you the projections are wrong, so it
 * matters more than any single recommendation.
 *
 * It needs volume. Fifty legs tell you almost nothing; several hundred start to
 * be informative. The sample size is reported alongside every number for that
 * reason.
 */

export interface Observation {
  /** Probability the model gave before the game. */
  p: number
  /** Did it actually cash? Pushes should be excluded by the caller. */
  win: boolean
  /**
   * What the leg was, so the same legs can be read along a second axis.
   * Absent on legs logged before any of this was recorded, which report in
   * their own bucket rather than being folded into a guess.
   */
  competition?: LeagueId
  league?: LeagueId
  market?: MarketKey | null
  marketLabel?: string
}

export interface CalibrationBucket {
  lo: number
  hi: number
  count: number
  /** Average probability the model predicted in this bucket. */
  predicted: number
  /** Fraction that actually won. */
  actual: number
  /** Standard error on the actual rate, for judging whether a gap is real. */
  stderr: number
}

export function calibrationBuckets(obs: Observation[], edges = [0.5, 0.55, 0.6, 0.65, 0.7, 1.01]): CalibrationBucket[] {
  const lows = [0, ...edges.slice(0, -1)]
  const out: CalibrationBucket[] = []
  for (let i = 0; i < edges.length; i++) {
    const lo = lows[i]
    const hi = edges[i]
    const inBucket = obs.filter((o) => o.p >= lo && o.p < hi)
    if (inBucket.length === 0) {
      out.push({ lo, hi, count: 0, predicted: 0, actual: 0, stderr: 0 })
      continue
    }
    const predicted = inBucket.reduce((a, o) => a + o.p, 0) / inBucket.length
    const wins = inBucket.filter((o) => o.win).length
    const actual = wins / inBucket.length
    out.push({
      lo,
      hi,
      count: inBucket.length,
      predicted,
      actual,
      stderr: Math.sqrt(Math.max(actual * (1 - actual), 1e-9) / inBucket.length),
    })
  }
  return out
}

/** Mean squared error of the probabilities. Lower is better; 0.25 is a coin flip. */
export function brierScore(obs: Observation[]): number | null {
  if (obs.length === 0) return null
  return obs.reduce((a, o) => a + Math.pow(o.p - (o.win ? 1 : 0), 2), 0) / obs.length
}

/** Average negative log likelihood. Punishes confident mistakes hard. */
export function logLoss(obs: Observation[]): number | null {
  if (obs.length === 0) return null
  return (
    -obs.reduce((a, o) => {
      const p = clamp(o.p, 1e-6, 1 - 1e-6)
      return a + (o.win ? Math.log(p) : Math.log(1 - p))
    }, 0) / obs.length
  )
}

/**
 * Overall bias: positive means the model is overconfident, i.e. it predicted a
 * higher hit rate than it delivered.
 */
export function calibrationBias(obs: Observation[]): number | null {
  if (obs.length === 0) return null
  const predicted = obs.reduce((a, o) => a + o.p, 0) / obs.length
  const actual = obs.filter((o) => o.win).length / obs.length
  return predicted - actual
}

export interface Performance {
  entries: number
  settled: number
  staked: number
  returned: number
  profit: number
  /** Profit divided by amount staked. */
  roi: number | null
  /** What the model said the return should have been. */
  expectedRoi: number | null
  wins: number
  losses: number
}

export function summarise(
  slips: { stake: number; actualMultiple: number | null; evAtEntry: number | null; status: string }[],
): Performance {
  const settled = slips.filter((s) => s.status === "SETTLED" && s.actualMultiple != null)
  const staked = settled.reduce((a, s) => a + s.stake, 0)
  const returned = settled.reduce((a, s) => a + s.stake * (s.actualMultiple ?? 0), 0)
  // Only entries the model priced have an expectation to compare against.
  const modelled = settled.filter((s) => s.evAtEntry != null)
  const modelledStake = modelled.reduce((a, s) => a + s.stake, 0)
  const expectedReturn = modelled.reduce((a, s) => a + s.stake * (1 + (s.evAtEntry ?? 0)), 0)
  return {
    entries: slips.length,
    settled: settled.length,
    staked,
    returned,
    profit: returned - staked,
    roi: staked > 0 ? (returned - staked) / staked : null,
    expectedRoi: modelledStake > 0 ? (expectedReturn - modelledStake) / modelledStake : null,
    wins: settled.filter((s) => (s.actualMultiple ?? 0) > 1).length,
    losses: settled.filter((s) => (s.actualMultiple ?? 0) <= 1).length,
  }
}

// ---------------------------------------------------------------------------
// Reading the same legs along a second axis
// ---------------------------------------------------------------------------

export interface GroupedCalibration {
  /** What this row is: a competition id, a market key, or the absent bucket. */
  key: string
  label: string
  count: number
  predicted: number
  actual: number
  stderr: number
  /**
   * The gap, with the sign that matters: positive means the model was more
   * confident than the results. Negative is not good news either; it means the
   * distribution is wider than it needs to be and edges are being missed.
   */
  bias: number
  /**
   * The variance multiplier that would reconcile the two, or null when the
   * sample is too small or the arithmetic degenerate. See impliedDispersion.
   */
  impliedDispersion: number | null
  /** True when the gap is larger than two standard errors on this sample. */
  significant: boolean
}

/**
 * How much wider the distribution would have to be for the predictions to
 * match the results.
 *
 * Under a normal approximation a prediction p sits z = Phi^-1(p) standard
 * deviations from the line. If the realised rate is p', the spread that would
 * have produced it is z/z' times as wide, so variance scales by (z/z')^2 —
 * which is the number the outcome-spread dial in settings multiplies. Above 1
 * means the model is overconfident and the dial should go up.
 *
 * Three honest limits, all of which belong next to the number on screen:
 *
 *   It is a normal approximation to count distributions, so it is a direction
 *   and a rough size, not a fitted parameter.
 *
 *   It measures what is LEFT after every correction the app already applies,
 *   including the kickoff widening, because the stored probability had those
 *   baked in. It cannot be used to fit them; it says whether the total was
 *   enough.
 *
 *   A leg sitting on a market's coefficient-of-variation floor does not scale
 *   as sqrt(k) at all, so for yardage markets this is looser still.
 */
export function impliedDispersion(predicted: number, actual: number, count: number, minCount = 25): number | null {
  if (count < minCount) return null
  const p = clamp(predicted, 1e-4, 1 - 1e-4)
  const a = clamp(actual, 1e-4, 1 - 1e-4)
  const z = normalInvCdf(p)
  const za = normalInvCdf(a)
  // A bucket centred on a coin flip says nothing about spread: every width
  // gives 50%, so the ratio is noise over noise.
  if (Math.abs(z) < 0.1 || Math.abs(za) < 1e-6) return null
  // Opposite signs mean the model had the wrong side, not the wrong width.
  if (z * za < 0) return null
  return (z / za) ** 2
}

/**
 * The same settled legs, grouped along whichever axis is passed.
 *
 * Deliberately one axis at a time rather than a cross-product. Competition by
 * market by probability band is thirty or more cells, and with a hundred-odd
 * settled legs almost every one of them would render a number built on five
 * results. Two separate tables, each with a floor under it, say something; a
 * grid of noise says less than nothing because it invites a reaction.
 */
export function groupedCalibration(
  obs: Observation[],
  axis: (o: Observation) => { key: string; label: string } | null,
  opts: { minCount?: number } = {},
): GroupedCalibration[] {
  const minCount = opts.minCount ?? 25
  const groups = new Map<string, { label: string; obs: Observation[] }>()
  for (const o of obs) {
    const at = axis(o)
    const key = at?.key ?? "unrecorded"
    const label = at?.label ?? "Before this was recorded"
    const g = groups.get(key)
    if (g) g.obs.push(o)
    else groups.set(key, { label, obs: [o] })
  }

  const out: GroupedCalibration[] = []
  for (const [key, g] of groups) {
    const count = g.obs.length
    const predicted = g.obs.reduce((a, o) => a + o.p, 0) / count
    const actual = g.obs.filter((o) => o.win).length / count
    const stderr = Math.sqrt(Math.max(actual * (1 - actual), 1e-9) / count)
    out.push({
      key,
      label: g.label,
      count,
      predicted,
      actual,
      stderr,
      bias: predicted - actual,
      impliedDispersion: impliedDispersion(predicted, actual, count, minCount),
      significant: Math.abs(predicted - actual) > 2 * stderr && count >= 20,
    })
  }
  return out.sort((a, b) => b.count - a.count)
}
