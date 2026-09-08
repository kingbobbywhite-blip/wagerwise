import { countDistribution, normalDistribution, type OutcomeDistribution } from "@/lib/quant/distributions"

/**
 * NBA market taxonomy, dispersion model and name normalisation.
 *
 * Dispersion ratio = variance / mean for the stat. These are priors fitted to
 * typical NBA game-log behaviour, not universal constants:
 *
 *   Points are heavily overdispersed relative to Poisson (ratio ~2.6) because
 *   scoring arrives in 2s and 3s and minutes fluctuate. A 25 ppg player has a
 *   game-to-game standard deviation near 8, and 2.6 * 25 = 65 gives sd 8.1.
 *
 *   Rebounds and assists are mildly overdispersed (~1.25). A 10 rpg player sits
 *   near sd 3.5.
 *
 *   Threes are close to Poisson (~1.15) because made threes are a bounded
 *   binomial on attempts, which pulls variance down, while attempt volatility
 *   pushes it back up.
 *
 *   Steals and blocks are essentially Poisson at their low means.
 *
 * These ratios are the single biggest modelling assumption in the app and are
 * exposed in settings so they can be retuned against realised results.
 */

export type MarketKey =
  | "PTS" | "REB" | "AST" | "3PM" | "STL" | "BLK" | "TOV"
  | "FGM" | "FTM" | "FGA" | "3PA" | "MIN"
  | "PRA" | "PR" | "PA" | "RA" | "STL_BLK" | "FANTASY"

export interface MarketConfig {
  key: MarketKey
  label: string
  short: string
  /** variance / mean */
  dispersion: number
  /** Continuous stats use a normal marginal instead of a count distribution. */
  continuous?: boolean
  /** Component stats, used by the correlation model for combo markets. */
  components: MarketKey[]
  /** Typical league-wide mean, used only for sanity checks on imported data. */
  typicalMean: number
}

export const MARKETS: Record<MarketKey, MarketConfig> = {
  PTS:     { key: "PTS",     label: "Points",                    short: "PTS",  dispersion: 2.60, components: ["PTS"], typicalMean: 14 },
  REB:     { key: "REB",     label: "Rebounds",                  short: "REB",  dispersion: 1.25, components: ["REB"], typicalMean: 5.5 },
  AST:     { key: "AST",     label: "Assists",                   short: "AST",  dispersion: 1.25, components: ["AST"], typicalMean: 3.5 },
  "3PM":   { key: "3PM",     label: "3-Pointers Made",           short: "3PM",  dispersion: 1.15, components: ["3PM"], typicalMean: 1.8 },
  STL:     { key: "STL",     label: "Steals",                    short: "STL",  dispersion: 1.05, components: ["STL"], typicalMean: 0.9 },
  BLK:     { key: "BLK",     label: "Blocks",                    short: "BLK",  dispersion: 1.15, components: ["BLK"], typicalMean: 0.6 },
  TOV:     { key: "TOV",     label: "Turnovers",                 short: "TOV",  dispersion: 1.10, components: ["TOV"], typicalMean: 1.7 },
  FGM:     { key: "FGM",     label: "Field Goals Made",          short: "FGM",  dispersion: 1.50, components: ["FGM"], typicalMean: 5.2 },
  FTM:     { key: "FTM",     label: "Free Throws Made",          short: "FTM",  dispersion: 1.60, components: ["FTM"], typicalMean: 2.4 },
  FGA:     { key: "FGA",     label: "Field Goals Attempted",     short: "FGA",  dispersion: 1.45, components: ["FGA"], typicalMean: 11 },
  "3PA":   { key: "3PA",     label: "3-Pointers Attempted",      short: "3PA",  dispersion: 1.30, components: ["3PA"], typicalMean: 5 },
  MIN:     { key: "MIN",     label: "Minutes",                   short: "MIN",  dispersion: 1.00, continuous: true, components: ["MIN"], typicalMean: 28 },
  PRA:     { key: "PRA",     label: "Pts + Reb + Ast",           short: "PRA",  dispersion: 2.20, components: ["PTS", "REB", "AST"], typicalMean: 23 },
  PR:      { key: "PR",      label: "Pts + Reb",                 short: "PR",   dispersion: 2.30, components: ["PTS", "REB"], typicalMean: 19 },
  PA:      { key: "PA",      label: "Pts + Ast",                 short: "PA",   dispersion: 2.40, components: ["PTS", "AST"], typicalMean: 17 },
  RA:      { key: "RA",      label: "Reb + Ast",                 short: "RA",   dispersion: 1.50, components: ["REB", "AST"], typicalMean: 9 },
  STL_BLK: { key: "STL_BLK", label: "Steals + Blocks",           short: "S+B",  dispersion: 1.10, components: ["STL", "BLK"], typicalMean: 1.5 },
  FANTASY: { key: "FANTASY", label: "Fantasy Score",             short: "FP",   dispersion: 2.40, continuous: true, components: ["PTS", "REB", "AST", "STL", "BLK", "TOV"], typicalMean: 30 },
}

export const MARKET_KEYS = Object.keys(MARKETS) as MarketKey[]

// ---------------------------------------------------------------------------
// Name normalisation
// ---------------------------------------------------------------------------

/**
 * Exact alias table. Lookups are exact-match on a canonicalised token string,
 * which is deliberate.
 *
 * The previous implementation matched with substring containment against an
 * unordered alias list, so "pts+reb+ast" matched the Points alias "pts" and every
 * combo market silently collapsed into Points. That corrupted deduplication and
 * the market-diversity rule at the same time. Exact matching first, then a
 * longest-alias fallback, removes that whole class of bug.
 */
const ALIASES: Record<string, MarketKey> = {}

function alias(key: MarketKey, ...names: string[]) {
  for (const n of names) ALIASES[canonicalToken(n)] = key
}

/** Lowercase, strip punctuation other than '+', collapse whitespace. */
function canonicalToken(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, "+")
    .replace(/[^a-z0-9+]+/g, " ")
    .replace(/\s*\+\s*/g, "+")
    .replace(/\s+/g, " ")
    .trim()
}

alias("PTS", "points", "pts", "point", "player points", "total points", "p")
alias("REB", "rebounds", "reb", "rebound", "total rebounds", "boards", "r", "rebs")
alias("AST", "assists", "ast", "assist", "total assists", "a", "asts", "dimes")
alias("3PM", "3pm", "3ptm", "fg3m", "3s", "3pt", "3pt made", "made 3pt", "3pt fg", "3pt field goals", "3pt fgm")
alias("STL", "steals", "stl", "steal", "total steals")
alias("BLK", "blocks", "blk", "block", "blocked shots", "blks", "total blocks")
alias("TOV", "turnovers", "tov", "turnover", "to", "total turnovers")
alias("FGM", "field goals made", "fgm", "fg made", "made field goals")
alias("FTM", "free throws made", "ftm", "ft made", "made free throws")
alias("FGA", "field goals attempted", "fga", "fg attempted", "shot attempts")
alias("3PA", "3pa", "fg3a", "3pt attempted", "3pt attempts", "3pt fga")
alias("MIN", "minutes", "min", "minutes played", "mins")
alias("PRA", "pts+reb+ast", "p+r+a", "pra", "points+rebounds+assists", "points rebounds assists",
  "pts reb ast", "pts+rebs+asts", "points+rebs+asts", "p r a", "pra combo")
alias("PR", "pts+reb", "p+r", "pr", "points+rebounds", "points rebounds", "pts reb", "pts+rebs")
alias("PA", "pts+ast", "p+a", "pa", "points+assists", "points assists", "pts ast", "pts+asts")
alias("RA", "reb+ast", "r+a", "ra", "rebounds+assists", "rebounds assists", "reb ast", "rebs+asts")
alias("STL_BLK", "stl+blk", "s+b", "steals+blocks", "steals blocks", "stocks", "blocks+steals", "blk+stl")
alias("FANTASY", "fantasy score", "fantasy points", "fantasy", "fp", "dk fantasy", "fantasy pts")

/**
 * Longest-first fallback list for messy inputs such as
 * "Points + Rebounds + Assists O/U" that do not match an alias exactly.
 */
const FALLBACK: { token: string; key: MarketKey }[] = Object.entries(ALIASES)
  .map(([token, key]) => ({ token, key }))
  .filter((e) => e.token.length >= 3)
  .sort((a, b) => b.token.length - a.token.length)

export interface NormalizedMarket {
  key: MarketKey | null
  label: string
  raw: string
}

/**
 * Collapse every way of writing a three-point market into one protected token
 * before numbers get stripped.
 *
 * This has to happen first. Removing digits from "3-Pointers Made" leaves
 * "pointers made", which then matches the Points alias and turns a threes prop
 * into a points prop. Protecting the token keeps the leading 3 attached to the
 * stat name so the later number-stripping pass cannot reach it.
 */
function protectThreePoint(s: string): string {
  return s
    .replace(/\b(?:3|three)\s*[-\u2013]?\s*(?:point|pointer|pt)s?\b/gi, " 3pt ")
    .replace(/\bthrees\b/gi, " 3pt ")
}

export function normalizeMarket(raw: string): NormalizedMarket {
  const original = (raw ?? "").trim()
  if (!original) return { key: null, label: "Unknown", raw: original }

  // Strip decorations books add around the stat name, then remove standalone
  // numbers such as the posted line. The word boundaries matter: an unanchored
  // digit strip would eat the 3 in "3PM".
  const stripped = protectThreePoint(original)
    .replace(/\b(over|under|o\/u|ou|line|prop|player|nba)\b/gi, " ")
    .replace(/\b\d+(?:\.\d+)?\b/g, " ")
  const token = canonicalToken(stripped) || canonicalToken(protectThreePoint(original))

  const exact = ALIASES[token]
  if (exact) return { key: exact, label: MARKETS[exact].label, raw: original }

  for (const f of FALLBACK) {
    if (token === f.token || token.startsWith(f.token + " ") || token.endsWith(" " + f.token) || token.includes(" " + f.token + " ")) {
      return { key: f.key, label: MARKETS[f.key].label, raw: original }
    }
  }
  // Last resort: containment, longest alias wins.
  for (const f of FALLBACK) {
    if (f.token.length >= 4 && token.includes(f.token)) {
      return { key: f.key, label: MARKETS[f.key].label, raw: original }
    }
  }
  return { key: null, label: titleCase(original), raw: original }
}

function titleCase(s: string): string {
  return s.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ")
}

// ---------------------------------------------------------------------------
// Distribution factory
// ---------------------------------------------------------------------------

export interface DispersionOverrides {
  /** Multiplier applied to every market's dispersion ratio. >1 widens outcomes. */
  global?: number
  perMarket?: Partial<Record<MarketKey, number>>
}

/**
 * Build a distribution with an EXPLICIT variance, bypassing the dispersion prior.
 *
 * This is what a measured game log needs. The prior ratios below are league-wide
 * defaults for when nothing better exists; once you have actually observed a
 * player's spread, the observation should win. Routing a measured variance back
 * through a multiplier on the prior is how that measurement gets quietly thrown
 * away.
 */
export function distributionWithVariance(
  marketKey: MarketKey | null,
  mean: number,
  variance: number,
): OutcomeDistribution {
  const cfg = marketKey ? MARKETS[marketKey] : null
  const m = Math.max(mean, 0.01)
  const v = Math.max(variance, 1e-6)
  if (cfg?.continuous) return normalDistribution(m, v)
  return countDistribution(m, v)
}

/**
 * Build the outcome distribution for a market at a given projected mean.
 *
 * A wider dispersion multiplier pulls every probability toward 50%, which is the
 * honest response to model uncertainty: if you are not sure of the projection,
 * you should not be sure of the probability either.
 */
export function distributionFor(
  marketKey: MarketKey | null,
  mean: number,
  overrides?: DispersionOverrides,
): OutcomeDistribution {
  const cfg = marketKey ? MARKETS[marketKey] : null
  const baseRatio = cfg?.dispersion ?? 1.8
  const perMarket = (marketKey && overrides?.perMarket?.[marketKey]) || 1
  const ratio = baseRatio * (overrides?.global ?? 1) * perMarket
  const m = Math.max(mean, 0.01)
  const variance = Math.max(m * ratio, 1e-6)
  if (cfg?.continuous) return normalDistribution(m, variance)
  return countDistribution(m, variance)
}
