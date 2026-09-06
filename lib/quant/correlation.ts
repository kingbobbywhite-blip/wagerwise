import type { MarketKey } from "@/lib/nba/markets"
import { MARKETS } from "@/lib/nba/markets"
import { clamp } from "./math"

/**
 * Correlation model for parlay legs.
 *
 * This is the part the previous engine did not have, and it is where most
 * parlay pricing goes wrong. Multiplying leg probabilities together assumes
 * independence. NBA legs are not independent:
 *
 *  - Same player, points and threes move together. If he is hot from deep, both
 *    legs cash. Treating them as independent UNDERSTATES the joint probability,
 *    so you refuse a slip that is actually good.
 *  - Same player, points and PRA are almost the same bet.
 *  - Two players on the same team competing for the same shots are mildly
 *    NEGATIVELY correlated on scoring, but positively correlated through pace
 *    and overtime. The net is close to zero and slightly positive.
 *  - A guard's assists and his team-mate's points are positively correlated,
 *    because the assist requires the made basket.
 *  - Opposing players are positively correlated through game pace: a fast,
 *    high-total game gives everyone more possessions.
 *
 * Ignoring positive correlation makes every same-game parlay look worse than it
 * is. Ignoring it on the payout side of a DFS flex play makes partial-hit
 * outcomes look more likely than they are. Both directions cost money.
 *
 * These are structural priors, not fitted coefficients. They are deliberately
 * conservative and are exposed in settings.
 */

export interface CorrelationLeg {
  player: string
  team: string | null
  opponent: string | null
  gameId: string | null
  market: MarketKey | null
  /** true if the leg is an OVER, false if UNDER. */
  isOver: boolean
}

/** Same-player correlations between the underlying stats. */
const STAT_CORR: Partial<Record<string, number>> = {
  "PTS|REB": 0.12,
  "PTS|AST": 0.16,
  "PTS|3PM": 0.46,
  "PTS|FGM": 0.86,
  "PTS|FTM": 0.52,
  "PTS|FGA": 0.72,
  "PTS|TOV": 0.14,
  "PTS|STL": 0.06,
  "PTS|BLK": 0.02,
  "PTS|MIN": 0.55,
  "REB|AST": 0.05,
  "REB|BLK": 0.30,
  "REB|STL": 0.05,
  "REB|MIN": 0.50,
  "REB|3PM": -0.06,
  "REB|TOV": 0.08,
  "AST|TOV": 0.34,
  "AST|STL": 0.10,
  "AST|MIN": 0.48,
  "AST|3PM": 0.08,
  "AST|BLK": -0.02,
  "3PM|3PA": 0.78,
  "3PM|FGM": 0.55,
  "3PM|MIN": 0.34,
  "3PM|STL": 0.03,
  "3PM|BLK": -0.04,
  "STL|BLK": 0.06,
  "STL|MIN": 0.30,
  "BLK|MIN": 0.32,
  "TOV|MIN": 0.36,
  "FGM|FGA": 0.85,
  "FGM|MIN": 0.55,
  "FTM|MIN": 0.38,
}

function statCorr(a: MarketKey, b: MarketKey): number {
  if (a === b) return 1
  return STAT_CORR[`${a}|${b}`] ?? STAT_CORR[`${b}|${a}`] ?? 0.03
}

/**
 * Correlation between two markets for the SAME player, expanding combo markets
 * into their components. PRA versus PTS is high because points are a large
 * share of the PRA total.
 */
function samePlayerMarketCorr(a: MarketKey, b: MarketKey): number {
  if (a === b) return 1
  const ca = MARKETS[a].components
  const cb = MARKETS[b].components
  if (ca.length === 1 && cb.length === 1) return statCorr(ca[0], cb[0])

  // Weight each component by its typical share of the combo total, then average
  // the pairwise stat correlations. Shared components dominate, which is why
  // PTS and PRA come out strongly correlated.
  const wa = componentWeights(a)
  const wb = componentWeights(b)
  let acc = 0
  for (const [ka, va] of Object.entries(wa)) {
    for (const [kb, vb] of Object.entries(wb)) {
      acc += va * vb * statCorr(ka as MarketKey, kb as MarketKey)
    }
  }
  // Normalise by the geometric mean of each combo's internal variance share so
  // a market is perfectly correlated with itself.
  const na = internalNorm(a)
  const nb = internalNorm(b)
  const denom = Math.sqrt(na * nb)
  return clamp(denom > 0 ? acc / denom : acc, -0.95, 0.98)
}

function componentWeights(key: MarketKey): Partial<Record<MarketKey, number>> {
  const cfg = MARKETS[key]
  const out: Partial<Record<MarketKey, number>> = {}
  const totals = cfg.components.map((c) => MARKETS[c].typicalMean)
  const sum = totals.reduce((a, b) => a + b, 0) || 1
  cfg.components.forEach((c, i) => {
    out[c] = totals[i] / sum
  })
  return out
}

function internalNorm(key: MarketKey): number {
  const w = componentWeights(key)
  let acc = 0
  for (const [ka, va] of Object.entries(w)) {
    for (const [kb, vb] of Object.entries(w)) {
      acc += (va as number) * (vb as number) * statCorr(ka as MarketKey, kb as MarketKey)
    }
  }
  return acc
}

/** Positive when the two legs help each other, negative when they fight. */
export interface CorrelationSettings {
  /** Scales every non-same-player correlation. 0 reproduces naive independence. */
  strength: number
  /** Same-team, different-player scoring competition. Negative by default. */
  teammateUsage: number
  /** Same-game pace effect shared by everyone on the floor. */
  gamePace: number
  /** Assist-to-scorer link between team-mates. */
  assistLink: number
}

export const DEFAULT_CORRELATION: CorrelationSettings = {
  strength: 1,
  teammateUsage: -0.08,
  gamePace: 0.07,
  assistLink: 0.12,
}

/**
 * Correlation between two legs as they will actually settle, i.e. after
 * accounting for direction. Two positively correlated stats bet on opposite
 * sides become negatively correlated outcomes.
 */
export function legCorrelation(
  a: CorrelationLeg,
  b: CorrelationLeg,
  cfg: CorrelationSettings = DEFAULT_CORRELATION,
): number {
  if (a === b) return 1
  if (!a.market || !b.market) return 0

  const samePlayer = normalizeName(a.player) === normalizeName(b.player)
  let rho: number

  if (samePlayer) {
    rho = samePlayerMarketCorr(a.market, b.market)
    // Identical market on the same player is the same event.
    if (a.market === b.market) rho = 0.99
  } else {
    const sameTeam = !!a.team && !!b.team && a.team === b.team
    const sameGame =
      (!!a.gameId && a.gameId === b.gameId) ||
      (!!a.team && !!b.opponent && (a.team === b.opponent || b.team === a.opponent))

    if (!sameGame && !sameTeam) {
      // Different games. Genuinely close to independent; a tiny positive term
      // survives for league-wide scoring environment.
      rho = 0.01
    } else {
      const statRho = statCorr(primaryStat(a.market), primaryStat(b.market))
      const pace = cfg.gamePace * Math.max(0.2, statRho + 0.4)

      if (sameTeam) {
        const usage = isVolumeScoring(a.market) && isVolumeScoring(b.market) ? cfg.teammateUsage : 0
        const assist =
          (a.market === "AST" && isVolumeScoring(b.market)) || (b.market === "AST" && isVolumeScoring(a.market))
            ? cfg.assistLink
            : 0
        rho = pace + usage + assist
      } else {
        // Opponents: pace helps both, but a defensive stat for one side feeds on
        // the other side's mistakes.
        const defensive =
          (a.market === "STL" || a.market === "BLK" || a.market === "STL_BLK") &&
          (b.market === "TOV" || isVolumeScoring(b.market))
        const defensiveB =
          (b.market === "STL" || b.market === "BLK" || b.market === "STL_BLK") &&
          (a.market === "TOV" || isVolumeScoring(a.market))
        rho = pace + (defensive || defensiveB ? 0.04 : 0)
      }
    }
  }

  // The strength dial scales every correlation, same-player pairs included.
  // Setting it to zero must produce genuine independence, because that is the
  // baseline the app compares against to show what correlation is worth.
  rho *= cfg.strength

  // Direction: betting opposite sides flips the sign of the outcome correlation.
  const sameDirection = a.isOver === b.isOver
  const signed = sameDirection ? rho : -rho
  return clamp(signed, -0.99, 0.99)
}

function primaryStat(key: MarketKey): MarketKey {
  return MARKETS[key].components[0]
}

function isVolumeScoring(key: MarketKey): boolean {
  return key === "PTS" || key === "PRA" || key === "PR" || key === "PA" || key === "FGM" || key === "FGA" || key === "3PM" || key === "FTM"
}

export function normalizeName(n: string): string {
  return (n ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

// ---------------------------------------------------------------------------
// Matrix utilities
// ---------------------------------------------------------------------------

export function correlationMatrix(
  legs: CorrelationLeg[],
  cfg: CorrelationSettings = DEFAULT_CORRELATION,
): number[][] {
  const n = legs.length
  const m: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    m[i][i] = 1
    for (let j = i + 1; j < n; j++) {
      const r = legCorrelation(legs[i], legs[j], cfg)
      m[i][j] = r
      m[j][i] = r
    }
  }
  return m
}

/**
 * Cholesky factorisation with automatic shrinkage toward the identity.
 *
 * A matrix assembled from pairwise priors is not guaranteed positive
 * semi-definite. Rather than failing, we blend toward the identity until the
 * factorisation succeeds. Shrinking toward the identity means shrinking toward
 * independence, which is the conservative direction.
 */
export function choleskyWithShrinkage(matrix: number[][]): { L: number[][]; shrinkage: number } {
  const n = matrix.length
  if (n === 0) return { L: [], shrinkage: 0 }

  for (const lambda of [0, 0.01, 0.03, 0.06, 0.12, 0.25, 0.5, 0.75, 1]) {
    const m = matrix.map((row, i) => row.map((v, j) => (i === j ? 1 : v * (1 - lambda))))
    const L = tryCholesky(m)
    if (L) return { L, shrinkage: lambda }
  }
  // Identity fallback: fully independent.
  const L = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)))
  return { L, shrinkage: 1 }
}

function tryCholesky(m: number[][]): number[][] | null {
  const n = m.length
  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = m[i][j]
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k]
      if (i === j) {
        if (s <= 1e-12) return null
        L[i][j] = Math.sqrt(s)
      } else {
        L[i][j] = s / L[j][j]
      }
    }
  }
  return L
}
