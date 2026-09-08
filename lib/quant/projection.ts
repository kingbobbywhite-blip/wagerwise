import { distributionFor, distributionWithVariance, normalizeMarket, MARKETS, type DispersionOverrides, type MarketKey } from "@/lib/nba/markets"
import { bookConsensus, bookProfile, consensusQuality, type ConsensusResult } from "./books"
import { meanImpliedByLine, resolveLine, type OutcomeDistribution } from "./distributions"
import { estimateFromGameLog, parseGameLog, type GameLogEntry, type MinutesContext } from "./gamelog"
import { clamp } from "./math"
import { fairTwoWay, probToAmerican, type DevigMethod } from "./odds"

/**
 * Turns slate rows into probabilities, and refuses to when it cannot.
 *
 * The governing rule: a prop is PRICED only if a real sportsbook price stands
 * behind it. Everything else is UNPRICED, is excluded from expected-value
 * arithmetic and from the optimizer, and says so on the board.
 *
 * That rule exists because the alternative manufactures edge. A projection built
 * from season averages, compared against a line those same averages cannot
 * possibly know better than the market, will happily report a fifteen percent
 * edge that is entirely an artefact of a thin input. The most common cause of a
 * large expected-value reading is a bad input, not a soft line.
 */

export type PricingStatus = "priced" | "unpriced"
export type ProjectionSourceKind = "market" | "gamelog" | "projection" | "form" | "none"

export interface BookQuote {
  /** Book identifier, matched against the profiles in books.ts. */
  book: string
  /** The line this book is posting, which often differs from the DFS line. */
  line: number
  overOdds: number | null
  underOdds: number | null
  /** ISO timestamp the price was captured. Used to flag stale quotes. */
  fetchedAt?: string | null
}

export interface RawPropRow {
  player: string
  team?: string | null
  opponent?: string | null
  gameId?: string | null
  gameTime?: string | null
  market: string
  /** The line the app you would actually bet is offering. */
  line: number
  app?: string | null
  source?: string | null
  notes?: string | null

  /** Sportsbook prices. This is what decides priced versus unpriced. */
  quotes?: BookQuote[]

  /** Single-book convenience fields, folded into quotes when present. */
  book?: string | null
  bookLine?: number | null
  overOdds?: number | null
  underOdds?: number | null

  /** Per-game history, used only when there is no market price. */
  gameLog?: number[] | string | null
  minutesLog?: number[] | string | null
  restDays?: number | null
  teammatesOut?: number | null
  projectedMinutes?: number | null
  usageBump?: number | null

  /** Weak fallbacks. Never enough to make a prop priced. */
  projection?: number | null
  seasonAvg?: number | null
  l10Avg?: number | null
  l5Avg?: number | null
  minutesAvg?: number | null
  minutesProj?: number | null
  hitRate?: string | number | null
  l10HitRate?: string | number | null
  l5HitRate?: string | number | null
}

export interface ProjectionSettings {
  devigMethod: DevigMethod
  assumedHoldPct: number
  dispersion: DispersionOverrides
  /** Quotes older than this are flagged stale. */
  staleQuoteMinutes: number
  /** Refuse to price from a book price older than this at all. */
  maxQuoteAgeMinutes: number
  /** Require at least one market-making or sharp book before pricing. */
  requireSharpBook: boolean
}

export const DEFAULT_PROJECTION_SETTINGS: ProjectionSettings = {
  // Power is the default and the recommended choice. Proportional devigging
  // overstates longshot probability, which on a prop board means it overstates
  // exactly the unders and overs sitting furthest from the number.
  devigMethod: "power",
  assumedHoldPct: 4.5,
  dispersion: { global: 1 },
  staleQuoteMinutes: 45,
  maxQuoteAgeMinutes: 360,
  requireSharpBook: false,
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

  /** The gate. Only priced props reach expected-value arithmetic. */
  status: PricingStatus
  /** Why a prop is unpriced, in plain language. */
  unpricedReason: string | null

  mean: number
  meanUncertainty: number
  sd: number
  distribution: OutcomeDistribution

  pOver: number
  pUnder: number
  pPush: number
  fairOverAmerican: number
  fairUnderAmerican: number

  lineEdge: number
  lineEdgeZ: number
  side: "OVER" | "UNDER"
  pWin: number

  sources: ProjectionSourceKind[]
  confidence: number
  /** Book hold observed on the sharpest contributing price. */
  holdPct: number | null
  /** Books that contributed, best first. */
  books: { book: string; name: string; weight: number; line: number; impliedMean: number }[]
  hasSharpBook: boolean
  /** Spread between book implied means, in units of the stat. */
  bookDisagreement: number
  /** Age of the freshest contributing quote, in minutes. */
  quoteAgeMinutes: number | null
  isStale: boolean
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

/** Collect quotes from the array form and the single-book convenience fields. */
export function collectQuotes(row: RawPropRow): BookQuote[] {
  const out: BookQuote[] = [...(row.quotes ?? [])]
  const hasSingle = row.overOdds != null || row.underOdds != null
  if (hasSingle) {
    out.push({
      book: row.book ?? "unknown",
      line: firstFinite(row.bookLine) ?? row.line,
      overOdds: row.overOdds ?? null,
      underOdds: row.underOdds ?? null,
      fetchedAt: null,
    })
  }
  return out.filter((q) => Number.isFinite(q.line) && (q.overOdds != null || q.underOdds != null))
}

function ageMinutes(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return (now - t) / 60000
}

// ---------------------------------------------------------------------------
// Market pricing
// ---------------------------------------------------------------------------

interface MarketPricing {
  consensus: ConsensusResult
  books: ProjectedProp["books"]
  holdPct: number | null
  quoteAgeMinutes: number | null
  isStale: boolean
  warnings: string[]
}

/**
 * Convert every book quote into an implied mean, then take the weighted
 * consensus.
 *
 * Going through the mean rather than the probability is what lets books posting
 * different numbers be combined at all: a 25.5 line at -110 and a 26.5 line at
 * +105 are two estimates of the same underlying quantity.
 */
function priceFromMarket(
  quotes: BookQuote[],
  marketKey: MarketKey | null,
  settings: ProjectionSettings,
  buildDist: (mean: number) => OutcomeDistribution,
  now: number,
): MarketPricing | null {
  const warnings: string[] = []
  const usable: { book: string; value: number; line: number; weight: number }[] = []
  let bestHold: number | null = null
  let freshest: number | null = null

  for (const q of quotes) {
    const age = ageMinutes(q.fetchedAt, now)
    if (age != null && age > settings.maxQuoteAgeMinutes) {
      warnings.push(`${bookProfile(q.book).name} price is ${Math.round(age)} minutes old and was discarded.`)
      continue
    }
    const fair = fairTwoWay(q.overOdds, q.underOdds, settings.devigMethod, settings.assumedHoldPct)
    if (!fair) continue

    const oneSided = q.overOdds == null || q.underOdds == null
    if (oneSided) {
      warnings.push(`${bookProfile(q.book).name} priced only one side, so its margin had to be assumed.`)
    }

    const impliedMean = meanImpliedByLine(q.line, fair.pOver, buildDist)
    if (!Number.isFinite(impliedMean) || impliedMean <= 0) continue

    usable.push({ book: q.book, value: impliedMean, line: q.line, weight: bookProfile(q.book).weight })
    if (bestHold == null || (!oneSided && fair.holdPct < bestHold)) bestHold = fair.holdPct
    if (age != null && (freshest == null || age < freshest)) freshest = age
  }

  if (usable.length === 0) return null

  const consensus = bookConsensus(usable.map((u) => ({ book: u.book, value: u.value })))
  if (!consensus) return null

  const byBook = new Map(usable.map((u) => [u.book, u]))
  const books = consensus.contributors.map((c) => ({
    book: c.book,
    name: bookProfile(c.book).name,
    weight: c.weight,
    line: byBook.get(c.book)?.line ?? 0,
    impliedMean: c.value,
  }))

  if (!consensus.hasSharp) {
    warnings.push(
      "No market-making book in the consensus. Retail prices follow the sharp market rather than setting it, so this projection is weaker than the confidence score alone suggests.",
    )
  }
  if (consensus.disagreement > 0 && marketKey) {
    const sd = buildDist(consensus.value).sd
    if (consensus.disagreement > Math.max(0.5, sd * 0.25)) {
      warnings.push(
        `Books disagree by ${consensus.disagreement.toFixed(1)} on this number, which is wide. One of them may be stale or the prop may be mismatched.`,
      )
    }
  }

  const isStale = freshest != null && freshest > settings.staleQuoteMinutes
  if (isStale) {
    warnings.push(`Freshest price is ${Math.round(freshest as number)} minutes old. Re-pull before betting.`)
  }

  return { consensus, books, holdPct: bestHold, quoteAgeMinutes: freshest, isStale, warnings }
}

// ---------------------------------------------------------------------------
// Unpriced estimation
// ---------------------------------------------------------------------------

interface UnpricedEstimate {
  mean: number
  variance: number
  source: ProjectionSourceKind
  notes: string[]
}

/**
 * Best effort when no market price exists.
 *
 * A game log gives both a centre and a measured spread, and lets the projection
 * be rebuilt from a minutes forecast. That is the only fallback worth having.
 * A bare season average gives a centre and nothing else, so it is accepted but
 * priced with the market's own prior spread and flagged hard.
 */
function estimateUnpriced(
  row: RawPropRow,
  marketKey: MarketKey | null,
  priorDispersion: number,
): UnpricedEstimate | null {
  const values = parseGameLog(row.gameLog)
  const minutes = parseGameLog(row.minutesLog)

  if (values.length >= 3) {
    const log: GameLogEntry[] = values.map((v, i) => ({ value: v, minutes: minutes[i] ?? null }))
    const ctx: MinutesContext = {
      restDays: row.restDays ?? null,
      teammatesOut: row.teammatesOut ?? null,
      projectedMinutes: firstFinite(row.projectedMinutes, row.minutesProj),
      usageBump: row.usageBump ?? null,
    }
    const est = estimateFromGameLog(log, ctx, priorDispersion)
    if (est) return { mean: est.mean, variance: est.variance, source: "gamelog", notes: est.notes }
  }

  const proj = firstFinite(row.projection)
  if (proj != null && proj > 0) {
    return {
      mean: proj,
      variance: proj * priorDispersion * 1.3,
      source: "projection",
      notes: ["Priced from a supplied projection with no game log, so the spread is a market prior rather than a measurement."],
    }
  }

  // Recency-weighted averages, the weakest input the app accepts.
  const l5 = firstFinite(row.l5Avg)
  const l10 = firstFinite(row.l10Avg)
  const season = firstFinite(row.seasonAvg)
  const parts: { v: number; w: number }[] = []
  if (l5 != null) parts.push({ v: l5, w: 0.45 })
  if (l10 != null) parts.push({ v: l10, w: 0.35 })
  if (season != null) parts.push({ v: season, w: 0.4 })
  if (parts.length === 0) return null

  const tw = parts.reduce((a, p) => a + p.w, 0)
  let mean = parts.reduce((a, p) => a + p.v * p.w, 0) / tw

  const minsAvg = firstFinite(row.minutesAvg)
  const minsProj = firstFinite(row.minutesProj, row.projectedMinutes)
  const notes = [
    "Priced from season and recent averages with no game log. An average carries no information about spread, so this is the weakest estimate the app produces.",
  ]
  if (minsAvg != null && minsProj != null && minsAvg > 4 && minsProj > 0) {
    const ratio = clamp(minsProj / minsAvg, 0.5, 1.8)
    mean *= ratio
    notes.push(`Scaled by a minutes ratio of ${ratio.toFixed(2)}.`)
  }

  return { mean, variance: mean * priorDispersion * 1.5, source: "form", notes }
}

// ---------------------------------------------------------------------------
// Main projection
// ---------------------------------------------------------------------------

export function projectProp(
  row: RawPropRow,
  settings: ProjectionSettings = DEFAULT_PROJECTION_SETTINGS,
  idSuffix = "",
  now: number = Date.now(),
): ProjectedProp | null {
  const player = (row.player ?? "").trim()
  const line = Number(row.line)
  if (!player || !Number.isFinite(line)) return null

  const norm = normalizeMarket(row.market ?? "")
  const warnings: string[] = []
  if (!norm.key) warnings.push(`Unrecognised market "${row.market}". Priced with a generic spread model.`)

  const priorDispersion = norm.key ? MARKETS[norm.key].dispersion : 1.8
  const build = (m: number) => distributionFor(norm.key, m, settings.dispersion)

  const quotes = collectQuotes(row)
  const market = quotes.length > 0 ? priceFromMarket(quotes, norm.key, settings, build, now) : null

  let status: PricingStatus
  let unpricedReason: string | null = null
  let mean: number
  let baseVariance: number
  let meanUncertainty: number
  let sources: ProjectionSourceKind[]
  let books: ProjectedProp["books"] = []
  let hasSharpBook = false
  let bookDisagreement = 0
  let holdPct: number | null = null
  let quoteAgeMinutes: number | null = null
  let isStale = false

  if (market && (!settings.requireSharpBook || market.consensus.hasSharp)) {
    status = "priced"
    mean = market.consensus.value
    const dist = build(mean)
    baseVariance = dist.variance
    books = market.books
    hasSharpBook = market.consensus.hasSharp
    bookDisagreement = market.consensus.disagreement
    holdPct = market.holdPct
    quoteAgeMinutes = market.quoteAgeMinutes
    isStale = market.isStale
    warnings.push(...market.warnings)
    sources = ["market"]

    // Uncertainty on the consensus: how far the books are from each other, plus
    // a floor that shrinks as the quality of the contributing books rises.
    const quality = consensusQuality(market.consensus)
    const floor = (1 - quality) * 0.5 * dist.sd
    meanUncertainty = Math.sqrt(Math.pow(bookDisagreement / 2, 2) + floor * floor)
  } else {
    status = "unpriced"

    if (market) {
      // A retail-only price when a sharp book is required. The number is still
      // the best centre available, so it is kept and clearly marked rather than
      // thrown away.
      unpricedReason = "No market-making book priced this prop, and sharp-book pricing is required in settings."
      mean = market.consensus.value
      baseVariance = build(mean).variance
      books = market.books
      bookDisagreement = market.consensus.disagreement
      holdPct = market.holdPct
      quoteAgeMinutes = market.quoteAgeMinutes
      isStale = market.isStale
      warnings.push(...market.warnings)
      sources = ["market"]
      meanUncertainty = Math.sqrt(baseVariance) * 0.4
    } else {
      const est = estimateUnpriced(row, norm.key, priorDispersion)
      if (est) {
        unpricedReason = "No sportsbook price supplied for this prop."
        mean = est.mean
        baseVariance = est.variance
        sources = [est.source]
        warnings.push(...est.notes)
        // Without a market price the centre itself is a guess. Half a standard
        // deviation of uncertainty on the mean is not pessimism, it is the
        // honest width of a projection nobody has bet against.
        meanUncertainty = Math.sqrt(baseVariance) * (est.source === "gamelog" ? 0.35 : 0.55)
      } else {
        // Nothing to estimate from at all. The row is kept so you can see what
        // you captured and what still needs a price, but it carries no
        // projection: the mean below is the posted line itself, held as a
        // placeholder. Confidence of zero is the signal to the UI that there is
        // no number here worth showing.
        unpricedReason =
          "No sportsbook price, no game log and no averages. There is nothing to project from, so no probability is shown. Attach odds to price it."
        mean = line
        baseVariance = build(Math.max(line, 0.5)).variance
        meanUncertainty = Math.sqrt(baseVariance)
        sources = ["none"]
      }
    }
  }

  // Fold uncertainty about the centre into the predictive spread, so a shaky
  // projection cannot produce a confident probability. The variance is applied
  // directly rather than as a multiplier on the market prior, so a measured
  // game-log spread survives instead of being overwritten by the default.
  const predictiveVariance = baseVariance + meanUncertainty * meanUncertainty
  const distribution = distributionWithVariance(norm.key, mean, predictiveVariance)

  const { over, under, push } = resolveLine(distribution, line)

  const side: "OVER" | "UNDER" = over >= under ? "OVER" : "UNDER"
  const pWin = side === "OVER" ? over : under
  const lineEdge = mean - line
  const lineEdgeZ = lineEdge / Math.max(distribution.sd, 1e-9)

  let confidence: number
  if (status === "priced" && market) {
    confidence = Math.round(clamp(35 + consensusQuality(market.consensus) * 60 - (isStale ? 12 : 0), 1, 99))
  } else if (sources[0] === "none") {
    confidence = 0
  } else {
    confidence = sources[0] === "gamelog" ? 30 : sources[0] === "projection" ? 20 : 12
  }
  if (!norm.key) confidence = Math.max(1, confidence - 15)

  if (Math.abs(lineEdgeZ) > 0.9 && sources[0] !== "none") {
    warnings.push(
      `The projection sits ${lineEdgeZ.toFixed(2)} standard deviations from the line. An edge that size is far more often a stale price, a mismatched prop or a bad input than real value. Verify the number before acting on it.`,
    )
  }
  if (norm.key) {
    const caps: Partial<Record<MarketKey, number>> = { PTS: 60, REB: 30, AST: 25, "3PM": 14, STL: 8, BLK: 10 }
    const cap = caps[norm.key]
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
    status,
    unpricedReason,
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
    books,
    hasSharpBook,
    bookDisagreement,
    quoteAgeMinutes,
    isStale,
    warnings,
  }
}

export function projectSlate(
  rows: RawPropRow[],
  settings: ProjectionSettings = DEFAULT_PROJECTION_SETTINGS,
  now: number = Date.now(),
): ProjectedProp[] {
  const out: ProjectedProp[] = []
  rows.forEach((row, i) => {
    const p = projectProp(row, settings, `|${i}`, now)
    if (p) out.push(p)
  })
  return out
}
