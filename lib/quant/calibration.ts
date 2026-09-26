import { clamp } from "./math"

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
  slips: { stake: number; actualMultiple: number | null; evAtEntry: number; status: string }[],
): Performance {
  const settled = slips.filter((s) => s.status === "SETTLED" && s.actualMultiple != null)
  const staked = settled.reduce((a, s) => a + s.stake, 0)
  const returned = settled.reduce((a, s) => a + s.stake * (s.actualMultiple ?? 0), 0)
  const expectedReturn = settled.reduce((a, s) => a + s.stake * (1 + s.evAtEntry), 0)
  return {
    entries: slips.length,
    settled: settled.length,
    staked,
    returned,
    profit: returned - staked,
    roi: staked > 0 ? (returned - staked) / staked : null,
    expectedRoi: staked > 0 ? (expectedReturn - staked) / staked : null,
    wins: settled.filter((s) => (s.actualMultiple ?? 0) > 1).length,
    losses: settled.filter((s) => (s.actualMultiple ?? 0) <= 1).length,
  }
}
