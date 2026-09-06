import { distributionFor, normalizeMarket, type DispersionOverrides, type MarketKey } from "@/lib/nba/markets"
import { meanImpliedByLine, resolveLine, type OutcomeDistribution } from "./distributions"
import { clamp } from "./math"
import { fairTwoWay, probToAmerican, type DevigMethod } from "./odds"

/**
 * Turns imported slate rows into calibrated probabilities.
 *
 * Ordering of evidence, strongest first:
 *
 *  1. A two-way sportsbook price. Once the vig is stripped, this is the single
 *     best free projection that exists. Thousands of people with real money are
 *     already forecasting the stat, and the market number beats almost every
 *     public model. We invert it into an implied mean so it can be re-evaluated
 *     at whatever line the DFS app is actually offering.
 *  2. An explicit projection from the user's own model or scraper.
 *  3. Recent form (season, last 10, last 5) with a minutes adjustment.
 *
 * The output carries both a mean and an uncertainty on that mean. Uncertainty
 * matters as much as the point estimate: a projection you are unsure about must
 * produce probabilities closer to 50%, otherwise the optimizer will happily
 * stack six legs it only thinks are good.
 */

export type ProjectionSourceKind = "market" | "projection" | "form" | "hitrate"

export interface RawPropRow {
  player: string
  team?: string | null
  opponent?: string | null
  gameId?: string | null
  gameTime?: string | null
  market: string
  /** The line being offered by the app you would actually bet. */
  line: number
  /** Sportsbook price on the over, at bookLine if given, otherwise at line. */
  overOdds?: number | null
  underOdds?: number | null
  /** Sportsbook line, when it differs from the DFS line. */
  bookLine?: number | null
  /** Explicit projected value for the stat. */
  projection?: number | null
  seasonAvg?: number | null
  l10Avg?: number | null
  l5Avg?: number | null
  /** Minutes context, used to scale form when a role has changed. */
  minutesAvg?: number | null
  minutesProj?: number | null
  /** Historical hit rate against this line, as "7/10", "70%" or 0.7. */
  hitRate?: string | number | null
  l5HitRate?: string | number | null
  l10HitRate?: string | number | null
  /** Which app posts this line. */
  app?: string | null
  source?: string | null
  notes?: string | null
}

export interface ProjectionSettings {
  devigMethod: DevigMethod
  assumedHoldPct: number
  dispersion: DispersionOverrides
  weights: {
    market: number
    projection: number
    form: number
  }
  /** Pseudo-sample size that shrinks a small hit-rate sample toward the model. */
  hitRatePrior: number
  /** Extra uncertainty (in units of the stat's own sd) when evidence is thin. */
  thinEvidencePenalty: number
}

export const DEFAULT_PROJECTION_SETTINGS: ProjectionSettings = {
  devigMethod: "power",
  assumedHoldPct: 4.5,
  dispersion: { global: 1 },
  weights: { market: 0.62, projection: 0.26, form: 0.12 },
  hitRatePrior: 30,
  thinEvidencePenalty: 0.35,
}

export interface ProjectedProp {
  id: string
  player: string
  team: string | null
  opponent: string | null
  gameId: string | null
  gameTime: string | null
  marketKey: MarketKey | null
  marketLabel: string
  rawMarket: string
  line: number
  app: string | null
  source: string | null

  /** Blended projection for the stat. */
  mean: number
  /** Uncertainty on the mean itself, not the game-to-game spread. */
  meanUncertainty: number
  /** Game-to-game standard deviation used for pricing. */
  sd: number
  distribution: OutcomeDistribution

  pOver: number
  pUnder: number
  pPush: number

  /** Fair American price implied by the model for each side. */
  fairOverAmerican: number
  fairUnderAmerican: number

  /** Model mean minus the offered line, in units of the stat. */
  lineEdge: number
  /** lineEdge expressed in standard deviations. */
  lineEdgeZ: number

  /** Best side and its probability. */
  side: "OVER" | "UNDER"
  pWin: number

  /** Which evidence actually contributed. */
  sources: ProjectionSourceKind[]
  /** 0-100 heuristic describing how much evidence stands behind the number. */
  confidence: number
  /** Book hold observed on the source price, when there was one. */
  holdPct: number | null
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

export interface ParsedRate {
  rate: number
  sample: number
}

/** Accepts "7/10", "70%", 0.7 and 70. */
export function parseHitRate(v: string | number | null | undefined): ParsedRate | null {
  if (v == null || v === "") return null
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null
    return { rate: clamp(v > 1 ? v / 100 : v, 0, 1), sample: 0 }
  }
  const t = String(v).trim()
  const frac = t.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/)
  if (frac) {
    const num = Number.parseFloat(frac[1])
    const den = Number.parseFloat(frac[2])
    if (den > 0) return { rate: clamp(num / den, 0, 1), sample: den }
  }
  const n = Number.parseFloat(t.replace(/[%\s]/g, ""))
  if (!Number.isFinite(n)) return null
  return { rate: clamp(n > 1 ? n / 100 : n, 0, 1), sample: 0 }
}

function firstFinite(...vals: (number | null | undefined)[]): number | null {
  for (const v of vals) if (v != null && Number.isFinite(v)) return v
  return null
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

/**
 * Weighted recent-form estimate. Last 5 carries the most signal about the
 * current role, season average the most stability. If a minutes projection is
 * supplied and differs from recent minutes, the rate stats are rescaled, which
 * is the single most important adjustment when a rotation changes.
 */
function formEstimate(row: RawPropRow): { mean: number; weightScale: number } | null {
  const l5 = firstFinite(row.l5Avg)
  const l10 = firstFinite(row.l10Avg)
  const season = firstFinite(row.seasonAvg)
  const parts: { v: number; w: number }[] = []
  if (l5 != null) parts.push({ v: l5, w: 0.45 })
  if (l10 != null) parts.push({ v: l10, w: 0.35 })
  if (season != null) parts.push({ v: season, w: 0.4 })
  if (parts.length === 0) return null

  const totalW = parts.reduce((a, p) => a + p.w, 0)
  let mean = parts.reduce((a, p) => a + p.v * p.w, 0) / totalW

  const minsAvg = firstFinite(row.minutesAvg)
  const minsProj = firstFinite(row.minutesProj)
  if (minsAvg != null && minsProj != null && minsAvg > 4 && minsProj > 0) {
    // Cap the rescale: minutes do not translate one-for-one into production at
    // the extremes, and a huge ratio is usually bad data rather than real news.
    const ratio = clamp(minsProj / minsAvg, 0.5, 1.8)
    mean *= ratio
  }
  // More overlapping form windows means a more trustworthy estimate.
  return { mean, weightScale: clamp(parts.length / 3, 0.34, 1) }
}

// ---------------------------------------------------------------------------
// Main projection
// ---------------------------------------------------------------------------

export function projectProp(
  row: RawPropRow,
  settings: ProjectionSettings = DEFAULT_PROJECTION_SETTINGS,
  idSuffix = "",
): ProjectedProp | null {
  const player = (row.player ?? "").trim()
  const line = Number(row.line)
  if (!player || !Number.isFinite(line)) return null

  const norm = normalizeMarket(row.market ?? "")
  const warnings: string[] = []
  if (!norm.key) warnings.push(`Unrecognised market "${row.market}". Priced with a generic dispersion model.`)

  const build = (m: number) => distributionFor(norm.key, m, settings.dispersion)

  const estimates: { kind: ProjectionSourceKind; mean: number; weight: number }[] = []
  let holdPct: number | null = null

  // 1. Market price, inverted into an implied mean.
  const bookLine = firstFinite(row.bookLine) ?? line
  const fair = fairTwoWay(row.overOdds, row.underOdds, settings.devigMethod, settings.assumedHoldPct)
  if (fair) {
    holdPct = fair.holdPct
    const impliedMean = meanImpliedByLine(bookLine, fair.pOver, build)
    if (Number.isFinite(impliedMean) && impliedMean > 0) {
      const oneSided = row.overOdds == null || row.underOdds == null
      if (oneSided) warnings.push("Only one side was priced, so the vig had to be assumed rather than measured.")
      estimates.push({ kind: "market", mean: impliedMean, weight: settings.weights.market * (oneSided ? 0.6 : 1) })
    }
  }

  // 2. Explicit projection.
  const proj = firstFinite(row.projection)
  if (proj != null && proj > 0) {
    estimates.push({ kind: "projection", mean: proj, weight: settings.weights.projection })
  }

  // 3. Recent form.
  const form = formEstimate(row)
  if (form && form.mean > 0) {
    estimates.push({ kind: "form", mean: form.mean, weight: settings.weights.form * form.weightScale })
  }

  if (estimates.length === 0) {
    // Nothing to price with. Falling back to the line itself would manufacture a
    // 50/50 and pretend it is information, so we drop the row instead.
    return null
  }

  const totalW = estimates.reduce((a, e) => a + e.weight, 0)
  const mean = estimates.reduce((a, e) => a + e.mean * e.weight, 0) / totalW

  // Uncertainty on the mean: disagreement between sources, plus a floor that
  // depends on how strong the evidence is.
  const spread = Math.sqrt(
    estimates.reduce((a, e) => a + e.weight * Math.pow(e.mean - mean, 2), 0) / totalW,
  )
  const baseDist = build(mean)
  const hasMarket = estimates.some((e) => e.kind === "market")
  const evidenceFloor = hasMarket
    ? 0.05
    : estimates.some((e) => e.kind === "projection")
      ? 0.22
      : settings.thinEvidencePenalty
  const meanUncertainty = Math.sqrt(spread * spread + Math.pow(evidenceFloor * baseDist.sd, 2))

  // Fold the uncertainty on the mean into the predictive spread. This is what
  // stops a shaky projection from producing a confident probability.
  const predictiveVariance = baseDist.variance + meanUncertainty * meanUncertainty
  const inflate = predictiveVariance / Math.max(baseDist.variance, 1e-9)
  const distribution = distributionFor(norm.key, mean, {
    global: (settings.dispersion.global ?? 1) * inflate,
    perMarket: settings.dispersion.perMarket,
  })

  let { over, under, push } = resolveLine(distribution, line)

  // 4. Hit rate against this exact line, shrunk toward the model.
  const hr = parseHitRate(row.hitRate) ?? parseHitRate(row.l10HitRate) ?? parseHitRate(row.l5HitRate)
  const sources: ProjectionSourceKind[] = estimates.map((e) => e.kind)
  if (hr && hr.sample > 0) {
    const w = hr.sample / (hr.sample + settings.hitRatePrior)
    const blended = clamp(over * (1 - w) + hr.rate * w, 1e-4, 1 - 1e-4)
    const scale = (1 - push) / Math.max(1e-9, blended + (1 - blended))
    over = blended * scale
    under = Math.max(0, 1 - over - push)
    sources.push("hitrate")
  }

  const side: "OVER" | "UNDER" = over >= under ? "OVER" : "UNDER"
  const pWin = side === "OVER" ? over : under

  const lineEdge = mean - line
  const lineEdgeZ = lineEdge / Math.max(distribution.sd, 1e-9)

  // Confidence blends evidence quality against how much the model is stretching.
  let confidence = 25
  if (hasMarket) confidence += 40
  if (estimates.some((e) => e.kind === "projection")) confidence += 18
  if (estimates.some((e) => e.kind === "form")) confidence += 10
  if (hr && hr.sample >= 10) confidence += 7
  confidence -= clamp(meanUncertainty / Math.max(baseDist.sd, 1e-9), 0, 1) * 25
  if (!norm.key) confidence -= 15
  confidence = Math.round(clamp(confidence, 1, 99))

  if (Math.abs(lineEdgeZ) > 1.2) {
    warnings.push(
      `Projection sits ${lineEdgeZ.toFixed(2)} standard deviations from the line. Edges that large are usually stale data or a mismatched line, not real value.`,
    )
  }
  if (norm.key && mean > 0) {
    const typical = { PTS: 60, REB: 30, AST: 25, "3PM": 14 } as Partial<Record<MarketKey, number>>
    const cap = typical[norm.key]
    if (cap && mean > cap) warnings.push(`Projected ${mean.toFixed(1)} for ${norm.label} is outside a plausible NBA range.`)
  }

  return {
    id: `${player}|${norm.key ?? norm.label}|${line}|${row.app ?? ""}${idSuffix}`,
    player,
    team: row.team ?? null,
    opponent: row.opponent ?? null,
    gameId: row.gameId ?? null,
    gameTime: row.gameTime ?? null,
    marketKey: norm.key,
    marketLabel: norm.label,
    rawMarket: row.market ?? "",
    line,
    app: row.app ?? null,
    source: row.source ?? null,
    mean,
    meanUncertainty,
    sd: distribution.sd,
    distribution,
    pOver: over,
    pUnder: under,
    pPush: push,
    fairOverAmerican: probToAmerican(over),
    fairUnderAmerican: probToAmerican(under),
    lineEdge,
    lineEdgeZ,
    side,
    pWin,
    sources,
    confidence,
    holdPct,
    warnings,
  }
}

export function projectSlate(
  rows: RawPropRow[],
  settings: ProjectionSettings = DEFAULT_PROJECTION_SETTINGS,
): ProjectedProp[] {
  const out: ProjectedProp[] = []
  rows.forEach((row, i) => {
    const p = projectProp(row, settings, `|${i}`)
    if (p) out.push(p)
  })
  return out
}
