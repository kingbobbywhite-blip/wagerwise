import { correlationMatrix, DEFAULT_CORRELATION, normalizeName, type CorrelationLeg, type CorrelationSettings } from "./correlation"
import { dfsPayout, evaluateSlip, type EvalLeg, type SlipEvaluation } from "./evaluate"
import { clamp, hashString } from "./math"
import { supportedPickCounts, type PayoutMode } from "./payouts"

/**
 * Slip construction.
 *
 * The previous engine picked "the best available leg from each different stat
 * market". That rule is easy to explain but it is not an optimisation: it throws
 * away the second-best points leg even when it is far stronger than the best
 * turnovers leg, and it treats market diversity as if it were the goal rather
 * than a crude proxy for decorrelation.
 *
 * This version searches for the entry that maximises an explicit objective
 * (expected value, expected log growth, or probability of profit) under the
 * actual payout table, scoring candidates with the correlation-aware simulator.
 * Diversification is expressed directly as a correlation constraint instead of
 * being smuggled in through market labels.
 */

export interface OptimizerConstraints {
  picks: number
  /** At most this many legs from any one player. Above 1 permits stacks. */
  maxPerPlayer: number
  /** At most this many legs from any one game. */
  maxPerGame: number
  /** At most this many legs from any one team. */
  maxPerTeam: number
  /** Reject legs the model does not rate at least this highly. */
  minLegProb: number
  /** Reject legs whose projection is not backed by enough evidence. */
  minConfidence: number
  /** Reject slips whose average pairwise correlation exceeds this. */
  maxAvgCorrelation: number
  /** Require every leg to come from a different stat market. */
  distinctMarkets: boolean
}

export const DEFAULT_CONSTRAINTS: OptimizerConstraints = {
  picks: 4,
  maxPerPlayer: 1,
  maxPerGame: 3,
  maxPerTeam: 2,
  minLegProb: 0.5,
  minConfidence: 30,
  maxAvgCorrelation: 0.35,
  distinctMarkets: false,
}

export type Objective = "ev" | "growth" | "floor" | "upside"

export const OBJECTIVES: { value: Objective; label: string; blurb: string }[] = [
  { value: "ev", label: "Max expected value", blurb: "Highest average return per dollar. The right default if you are betting a large number of slips." },
  { value: "growth", label: "Max bankroll growth", blurb: "Maximises expected log growth, which is what actually compounds a bankroll. Prefers lower variance than pure expected value." },
  { value: "floor", label: "Highest floor", blurb: "Maximises the chance of finishing ahead, among slips that are not negative expected value." },
  { value: "upside", label: "Upside", blurb: "Chases the biggest payout while refusing to go negative expected value." },
]

export interface CandidateLeg extends EvalLeg {
  confidence: number
  /** Model mean minus the line, in units of the stat. */
  lineEdge: number
  /** lineEdge divided by the stat's own standard deviation, so it compares
   *  across markets: two points of edge on steals is huge, on points it is not. */
  lineEdgeZ: number
  app: string | null
}

export interface BuiltSlip {
  id: string
  legs: CandidateLeg[]
  evaluation: SlipEvaluation
  objective: Objective
  label: string
  rationale: string
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Objective scoring
// ---------------------------------------------------------------------------

function score(objective: Objective, e: SlipEvaluation): number {
  switch (objective) {
    case "ev":
      return e.ev
    case "growth":
      // Expected log growth at the Kelly stake. Zero when the slip is -EV.
      if (e.kelly <= 0) return -1
      return e.outcomes.reduce((acc, o) => acc + o.prob * Math.log(Math.max(1e-9, 1 + e.kelly * (o.multiple - 1))), 0)
    case "floor":
      return e.ev <= 0 ? e.ev - 1 : e.pProfit
    case "upside":
      return e.ev <= 0 ? e.ev - 1 : e.ev * Math.log(1 + e.topMultiple)
  }
}

// ---------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------

interface Pool {
  legs: CandidateLeg[]
  matrix: number[][]
  playerKey: string[]
  gameKey: string[]
  teamKey: string[]
}

function buildPool(legs: CandidateLeg[], cfg: CorrelationSettings): Pool {
  const corrLegs: CorrelationLeg[] = legs.map((l) => ({
    player: l.player,
    team: l.team,
    opponent: l.opponent,
    gameId: l.gameId,
    market: l.market,
    isOver: l.side === "OVER",
  }))
  return {
    legs,
    matrix: correlationMatrix(corrLegs, cfg),
    playerKey: legs.map((l) => normalizeName(l.player)),
    gameKey: legs.map((l) => l.gameId ?? gameKeyFromTeams(l.team, l.opponent)),
    teamKey: legs.map((l) => (l.team ?? "").toUpperCase()),
  }
}

function gameKeyFromTeams(team: string | null, opponent: string | null): string {
  if (!team && !opponent) return ""
  return [team ?? "", opponent ?? ""].map((s) => s.toUpperCase()).sort().join("@")
}

function submatrix(pool: Pool, idx: number[]): number[][] {
  return idx.map((i) => idx.map((j) => pool.matrix[i][j]))
}

function feasible(pool: Pool, idx: number[], next: number, c: OptimizerConstraints): boolean {
  const nextPlayer = pool.playerKey[next]
  const nextGame = pool.gameKey[next]
  const nextTeam = pool.teamKey[next]
  let players = 0
  let games = 0
  let teams = 0

  for (const i of idx) {
    if (i === next) return false
    if (pool.playerKey[i] === nextPlayer) {
      players++
      // Never take both sides of the same stat for one player.
      if (pool.legs[i].market === pool.legs[next].market) return false
    }
    if (nextGame && pool.gameKey[i] === nextGame) games++
    if (nextTeam && pool.teamKey[i] === nextTeam) teams++
    if (c.distinctMarkets && pool.legs[i].market && pool.legs[i].market === pool.legs[next].market) return false
  }
  if (players + 1 > c.maxPerPlayer) return false
  if (nextGame && games + 1 > c.maxPerGame) return false
  if (nextTeam && teams + 1 > c.maxPerTeam) return false
  return true
}

function avgCorrelation(pool: Pool, idx: number[]): number {
  if (idx.length < 2) return 0
  let s = 0
  let n = 0
  for (let i = 0; i < idx.length; i++) {
    for (let j = i + 1; j < idx.length; j++) {
      s += pool.matrix[idx[i]][idx[j]]
      n++
    }
  }
  return n ? s / n : 0
}

// ---------------------------------------------------------------------------
// Beam search
// ---------------------------------------------------------------------------

export interface OptimizeOptions {
  mode: PayoutMode
  constraints?: Partial<OptimizerConstraints>
  correlation?: CorrelationSettings
  objectives?: Objective[]
  /** How many finished slips to return. */
  count?: number
  /** Legs considered by the search, after single-leg filtering. */
  poolSize?: number
  beamWidth?: number
  searchSimulations?: number
  finalSimulations?: number
  /** Two returned slips may not share more than this many legs. */
  maxOverlap?: number
}

export function optimizeSlips(all: CandidateLeg[], opts: OptimizeOptions): BuiltSlip[] {
  const c: OptimizerConstraints = { ...DEFAULT_CONSTRAINTS, ...opts.constraints }
  const cfg = opts.correlation ?? DEFAULT_CORRELATION
  const objectives = opts.objectives ?? ["ev", "growth", "floor"]
  const beamWidth = opts.beamWidth ?? 14
  const poolSize = opts.poolSize ?? 40
  const searchSims = opts.searchSimulations ?? 1500
  const finalSims = opts.finalSimulations ?? 25000
  const maxOverlap = opts.maxOverlap ?? Math.max(1, c.picks - 2)

  const supported = supportedPickCounts(opts.mode)
  if (supported.length > 0 && !supported.includes(c.picks)) {
    return []
  }

  // Single-leg filter, then keep the strongest legs by how far the model is from
  // the line relative to that stat's own noise.
  const filtered = all
    .filter((l) => l.pWin >= c.minLegProb && l.confidence >= c.minConfidence)
    .sort((a, b) => legStrength(b) - legStrength(a))
    .slice(0, poolSize)

  if (filtered.length < c.picks) return []

  const pool = buildPool(filtered, cfg)
  const payout = dfsPayout(opts.mode)
  const results: BuiltSlip[] = []

  for (const objective of objectives) {
    const best = beamSearch(pool, payout, c, cfg, objective, beamWidth, searchSims)
    for (const idx of best) {
      const legs = idx.map((i) => pool.legs[i])
      const evaluation = evaluateSlip(legs, payout, {
        simulations: finalSims,
        correlation: cfg,
        matrix: submatrix(pool, idx),
        seed: hashString(idx.join(",") + objective),
      })
      if (evaluation.avgPairCorrelation > c.maxAvgCorrelation) continue
      results.push({
        id: idx.slice().sort((a, b) => a - b).join("-") + ":" + objective,
        legs,
        evaluation,
        objective,
        label: labelFor(objective, legs.length),
        rationale: rationaleFor(objective, legs, evaluation, opts.mode),
        warnings: warningsFor(legs, evaluation),
      })
    }
  }

  // Deduplicate identical leg sets, keeping the best-scoring version.
  const byLegs = new Map<string, BuiltSlip>()
  for (const s of results) {
    const key = s.legs.map((l) => l.id).sort().join("|")
    const existing = byLegs.get(key)
    if (!existing || s.evaluation.ev > existing.evaluation.ev) byLegs.set(key, s)
  }

  const ranked = Array.from(byLegs.values()).sort((a, b) => b.evaluation.ev - a.evaluation.ev)

  // Enforce diversity so the user gets genuinely different entries rather than
  // five variations on the same four legs.
  const chosen: BuiltSlip[] = []
  for (const s of ranked) {
    const ids = new Set(s.legs.map((l) => l.id))
    const tooSimilar = chosen.some((other) => {
      let overlap = 0
      for (const l of other.legs) if (ids.has(l.id)) overlap++
      return overlap > maxOverlap
    })
    if (!tooSimilar) chosen.push(s)
    if (chosen.length >= (opts.count ?? 6)) break
  }
  return chosen
}

/**
 * Ranking heuristic for the single-leg pre-filter. Standardised line edge is a
 * better sort key than raw win probability because it is comparable across
 * markets: two points of edge on a steals line is enormous, two points on a
 * scoring line is ordinary.
 */
function legStrength(l: CandidateLeg): number {
  return l.pWin * 2 + Math.abs(l.lineEdgeZ) * 0.35 + (l.confidence / 100) * 0.5
}

function beamSearch(
  pool: Pool,
  payout: (wins: number, pushes: number, picks: number) => number,
  c: OptimizerConstraints,
  cfg: CorrelationSettings,
  objective: Objective,
  beamWidth: number,
  sims: number,
): number[][] {
  const n = pool.legs.length
  let beam: { idx: number[]; s: number }[] = []

  for (let i = 0; i < Math.min(n, beamWidth * 2); i++) {
    beam.push({ idx: [i], s: pool.legs[i].pWin })
  }

  for (let depth = 1; depth < c.picks; depth++) {
    const next: { idx: number[]; s: number }[] = []
    const seen = new Set<string>()

    for (const state of beam) {
      const last = state.idx[state.idx.length - 1]
      for (let j = 0; j < n; j++) {
        // Enforce increasing index order so each combination is visited once.
        if (j <= last) continue
        if (!feasible(pool, state.idx, j, c)) continue
        const idx = [...state.idx, j]
        const key = idx.join(",")
        if (seen.has(key)) continue
        seen.add(key)

        const legs = idx.map((i) => pool.legs[i])
        const evaluation = evaluateSlip(legs, payout, {
          simulations: sims,
          correlation: cfg,
          matrix: submatrix(pool, idx),
          seed: hashString(key),
        })
        next.push({ idx, s: score(objective, evaluation) })
      }
    }

    if (next.length === 0) break
    next.sort((a, b) => b.s - a.s)
    beam = next.slice(0, beamWidth)
  }

  return beam.filter((b) => b.idx.length === c.picks).map((b) => b.idx)
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

function labelFor(objective: Objective, picks: number): string {
  const base = OBJECTIVES.find((o) => o.value === objective)?.label ?? objective
  return `${base} · ${picks}-pick`
}

function rationaleFor(objective: Objective, legs: CandidateLeg[], e: SlipEvaluation, mode: PayoutMode): string {
  const corr = e.avgPairCorrelation
  const corrPhrase =
    Math.abs(corr) < 0.03
      ? "The legs are close to independent"
      : corr > 0
        ? `The legs are positively correlated on average (${corr.toFixed(2)}), which raises the chance they all land together`
        : `The legs are negatively correlated on average (${corr.toFixed(2)}), which smooths the outcome but lowers the all-hit probability`

  const evGap = e.ev - e.evIndependent
  const gapPhrase =
    Math.abs(evGap) < 0.005
      ? ""
      : ` Ignoring correlation would have put expected value at ${(e.evIndependent * 100).toFixed(1)}%, a ${evGap > 0 ? "understatement" : "overstatement"} of ${Math.abs(evGap * 100).toFixed(1)} points.`

  return [
    `${OBJECTIVES.find((o) => o.value === objective)?.blurb ?? ""}`,
    `${corrPhrase}.${gapPhrase}`,
    `Modelled all-hit probability is ${(e.pAllHit * 100).toFixed(1)}% against a ${mode.label} table topping out at ${e.topMultiple}x.`,
  ].join(" ")
}

function warningsFor(legs: CandidateLeg[], e: SlipEvaluation): string[] {
  const w: string[] = []
  if (e.ev <= 0) w.push("Negative expected value under the current payout table. Do not bet it as priced.")
  if (e.correlationShrinkage > 0.2) {
    w.push(
      `The correlation matrix needed ${(e.correlationShrinkage * 100).toFixed(0)}% shrinkage toward independence to stay valid, so the joint probability is less reliable than usual.`,
    )
  }
  const lowConf = legs.filter((l) => l.confidence < 45)
  if (lowConf.length > 0) {
    w.push(`${lowConf.length} leg${lowConf.length > 1 ? "s are" : " is"} priced from thin evidence: ${lowConf.map((l) => l.player).join(", ")}.`)
  }
  const apps = new Set(legs.map((l) => l.app).filter(Boolean))
  if (apps.size > 1) w.push(`Legs come from ${apps.size} different apps and cannot be combined into one entry.`)
  return w
}

/** Ceiling on how good a single entry can be, used for sanity-checking a slate. */
export function bestSingleLeg(legs: CandidateLeg[]): CandidateLeg | null {
  if (legs.length === 0) return null
  return legs.reduce((a, b) => (legStrength(b) > legStrength(a) ? b : a))
}

export function clampConstraints(c: Partial<OptimizerConstraints>): Partial<OptimizerConstraints> {
  return {
    ...c,
    picks: c.picks != null ? clamp(Math.round(c.picks), 2, 8) : undefined,
    minLegProb: c.minLegProb != null ? clamp(c.minLegProb, 0.3, 0.95) : undefined,
    minConfidence: c.minConfidence != null ? clamp(c.minConfidence, 0, 99) : undefined,
    maxAvgCorrelation: c.maxAvgCorrelation != null ? clamp(c.maxAvgCorrelation, -1, 1) : undefined,
  }
}
