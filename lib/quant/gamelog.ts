import { clamp } from "./math"

/**
 * Game-log estimation, used when no odds exist for a prop.
 *
 * A season average is the wrong input for a probability. It tells you the centre
 * and nothing about the spread, so a player averaging 20 on 14 shots a night and
 * one averaging 20 on wild 8-to-34 swings look identical. The second is a
 * completely different bet at the same line.
 *
 * Given actual per-game values we can measure both the centre and the spread
 * directly, and we can rebuild the projection from a minutes forecast rather
 * than assuming last season's role still holds.
 *
 * Everything here still produces an UNPRICED estimate. It is not a substitute
 * for a market price, it is a way of being honestly uncertain when none exists.
 */

export interface GameLogEntry {
  value: number
  minutes?: number | null
  /** ISO date, newest first or oldest first, order does not matter. */
  date?: string | null
}

export interface MinutesContext {
  /** Days of rest before this game. 0 means a back-to-back. */
  restDays?: number | null
  /** Team-mates ruled out, used to apply a usage bump. */
  teammatesOut?: number | null
  /** Explicit minutes forecast, which overrides everything else if supplied. */
  projectedMinutes?: number | null
  /** Manual production bump as a fraction, e.g. 0.08 for eight percent. */
  usageBump?: number | null
}

export interface GameLogEstimate {
  /** Projected value for tonight. */
  mean: number
  /** Empirical game-to-game variance, floored so a short log cannot claim certainty. */
  variance: number
  sd: number
  /** Ratio of variance to mean, comparable to the per-market dispersion priors. */
  dispersion: number
  games: number
  /** Minutes the projection assumes. */
  projectedMinutes: number | null
  /** Average minutes in the log. */
  logMinutes: number | null
  /** Per-minute production rate, when minutes are available. */
  perMinute: number | null
  notes: string[]
}

/** Recency weights: the last few games say more about the current role. */
function recencyWeights(n: number, halfLife = 8): number[] {
  const w: number[] = []
  for (let i = 0; i < n; i++) w.push(Math.pow(0.5, i / halfLife))
  return w
}

function weightedMean(values: number[], weights: number[]): number {
  const tw = weights.reduce((a, b) => a + b, 0)
  return tw > 0 ? values.reduce((a, v, i) => a + v * weights[i], 0) / tw : 0
}

/**
 * Unbiased weighted variance. The (1 - sumSq/total^2) denominator is the
 * reliability correction for weighted samples; without it a recency-weighted
 * log systematically understates spread.
 */
function weightedVariance(values: number[], weights: number[], mean: number): number {
  const tw = weights.reduce((a, b) => a + b, 0)
  const sumSq = weights.reduce((a, b) => a + b * b, 0)
  if (tw <= 0) return 0
  const denom = tw - sumSq / tw
  if (denom <= 0) return 0
  return values.reduce((a, v, i) => a + weights[i] * Math.pow(v - mean, 2), 0) / denom
}

/**
 * Minutes forecast from the log plus context.
 *
 * Adjustments are deliberately small. Minutes are the single biggest driver of
 * counting stats, so a wrong minutes call ruins the projection, and a large
 * speculative adjustment is worse than none.
 */
export function projectMinutes(log: GameLogEntry[], ctx: MinutesContext = {}): { minutes: number | null; notes: string[] } {
  const notes: string[] = []
  if (ctx.projectedMinutes != null && Number.isFinite(ctx.projectedMinutes)) {
    return { minutes: ctx.projectedMinutes, notes: ["Using the supplied minutes forecast."] }
  }

  const withMinutes = log.filter((g) => g.minutes != null && Number.isFinite(g.minutes) && (g.minutes as number) > 0)
  if (withMinutes.length === 0) return { minutes: null, notes: ["No minutes in the game log, so no minutes adjustment was possible."] }

  const w = recencyWeights(withMinutes.length)
  let minutes = weightedMean(withMinutes.map((g) => g.minutes as number), w)

  // Rest. A back-to-back costs a little time; extended rest gives a little back.
  if (ctx.restDays != null) {
    if (ctx.restDays === 0) {
      minutes -= 1.5
      notes.push("Back-to-back: minutes trimmed by 1.5.")
    } else if (ctx.restDays >= 3) {
      minutes += 0.5
      notes.push("Three or more days rest: minutes raised by 0.5.")
    }
  }

  // Absences. Each rotation player out is worth a few minutes to those who remain.
  if (ctx.teammatesOut != null && ctx.teammatesOut > 0) {
    const bump = Math.min(ctx.teammatesOut * 2, 6)
    minutes += bump
    notes.push(`${ctx.teammatesOut} rotation player${ctx.teammatesOut > 1 ? "s" : ""} out: minutes raised by ${bump}.`)
  }

  // Nobody plays a full game and nobody in a rotation plays two minutes.
  minutes = clamp(minutes, 8, 42)
  return { minutes, notes }
}

/**
 * Build a projection and a spread from a game log.
 *
 * When minutes are present the projection is rebuilt as
 * (per-minute rate) x (projected minutes), which is what makes a rotation change
 * tractable. Without minutes it falls back to the recency-weighted average.
 */
export function estimateFromGameLog(
  log: GameLogEntry[],
  ctx: MinutesContext = {},
  /** Prior dispersion for this market, used to floor a short or flat log. */
  priorDispersion = 1.5,
): GameLogEstimate | null {
  const clean = log.filter((g) => Number.isFinite(g.value) && g.value >= 0)
  if (clean.length < 3) return null

  const notes: string[] = []
  const w = recencyWeights(clean.length)
  const values = clean.map((g) => g.value)
  const rawMean = weightedMean(values, w)
  let variance = weightedVariance(values, w, rawMean)

  const { minutes: projMinutes, notes: minuteNotes } = projectMinutes(clean, ctx)
  notes.push(...minuteNotes)

  const withMinutes = clean.filter((g) => g.minutes != null && (g.minutes as number) > 0)
  let logMinutes: number | null = null
  let perMinute: number | null = null
  let mean = rawMean

  if (withMinutes.length >= 3 && projMinutes != null) {
    const mw = recencyWeights(withMinutes.length)
    logMinutes = weightedMean(withMinutes.map((g) => g.minutes as number), mw)
    perMinute = weightedMean(withMinutes.map((g) => g.value / (g.minutes as number)), mw)
    mean = perMinute * projMinutes
    if (logMinutes > 0) {
      const ratio = projMinutes / logMinutes
      // Production scales with minutes, and so does its spread.
      variance *= clamp(ratio, 0.5, 1.8)
      if (Math.abs(ratio - 1) > 0.05) {
        notes.push(
          `Rebuilt from a per-minute rate: ${projMinutes.toFixed(1)} projected minutes against ${logMinutes.toFixed(1)} in the log.`,
        )
      }
    }
  } else {
    notes.push("Not enough minutes data to rebuild from a per-minute rate; using the recency-weighted average.")
  }

  if (ctx.usageBump != null && ctx.usageBump !== 0) {
    const b = clamp(ctx.usageBump, -0.4, 0.4)
    mean *= 1 + b
    notes.push(`Manual usage adjustment of ${(b * 100).toFixed(0)}% applied.`)
  }

  // A short log can produce an implausibly tight variance purely by chance, and
  // a tight variance is what turns a shaky projection into a confident-looking
  // probability. Floor it at the market's own prior dispersion.
  const flooredVariance = Math.max(variance, mean * priorDispersion * 0.75, 1e-6)
  if (flooredVariance > variance) {
    notes.push("Observed spread was tighter than this market usually runs, so it was widened toward the prior.")
  }

  // Short logs get widened further: five games is not a distribution.
  const shortLogPenalty = clean.length < 10 ? 1 + (10 - clean.length) * 0.04 : 1
  if (shortLogPenalty > 1) notes.push(`Only ${clean.length} games in the log, so the spread was widened further.`)

  const finalVariance = flooredVariance * shortLogPenalty

  return {
    mean,
    variance: finalVariance,
    sd: Math.sqrt(finalVariance),
    dispersion: mean > 0 ? finalVariance / mean : priorDispersion,
    games: clean.length,
    projectedMinutes: projMinutes,
    logMinutes,
    perMinute,
    notes,
  }
}

/** Parse "24, 18, 31, 12" or a JSON array into a game log of plain values. */
export function parseGameLog(input: string | number[] | null | undefined): number[] {
  if (input == null) return []
  if (Array.isArray(input)) return input.filter((n) => Number.isFinite(n))
  const s = String(input).trim()
  if (!s) return []
  return s
    .replace(/[[\]]/g, "")
    .split(/[,;|\s]+/)
    .map((t) => Number.parseFloat(t))
    .filter((n) => Number.isFinite(n))
}
