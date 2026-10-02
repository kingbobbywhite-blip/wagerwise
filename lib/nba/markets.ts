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
  // NFL
  | "PASS_YDS" | "PASS_TDS" | "PASS_COMP" | "PASS_ATT" | "PASS_INT"
  | "RUSH_YDS" | "RUSH_ATT" | "REC" | "REC_YDS" | "RUSH_REC_YDS"
  // NHL
  | "SOG" | "SAVES" | "HKY_PTS" | "HKY_AST" | "HKY_GOALS" | "HKY_BLK" | "HKY_PPP"

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

  // NFL. Yardage is modelled as an overdispersed count: it is an integer, it is
  // right-skewed (a 70-yard catch is possible, a minus-70 one is not), and the
  // negative binomial captures that skew where a normal would not. Ratios are
  // variance / mean from typical starter game logs: a QB at 250 passing yards
  // sits near sd 70 (ratio ~19), a lead back at 65 rushing yards near sd 29
  // (~13), a WR1 at 60 receiving yards near sd 31 (~16). Passing touchdowns
  // and interceptions are UNDER-dispersed relative to Poisson, which the
  // binomial branch of the count model handles.
  PASS_YDS:     { key: "PASS_YDS",     label: "Passing Yards",         short: "PaYd", dispersion: 19,   components: ["PASS_YDS"], typicalMean: 235 },
  PASS_TDS:     { key: "PASS_TDS",     label: "Passing TDs",           short: "PaTD", dispersion: 0.80, components: ["PASS_TDS"], typicalMean: 1.5 },
  PASS_COMP:    { key: "PASS_COMP",    label: "Pass Completions",      short: "Cmp",  dispersion: 1.15, components: ["PASS_COMP"], typicalMean: 21 },
  PASS_ATT:     { key: "PASS_ATT",     label: "Pass Attempts",         short: "Att",  dispersion: 1.10, components: ["PASS_ATT"], typicalMean: 33 },
  PASS_INT:     { key: "PASS_INT",     label: "Interceptions",         short: "INT",  dispersion: 0.95, components: ["PASS_INT"], typicalMean: 0.8 },
  RUSH_YDS:     { key: "RUSH_YDS",     label: "Rushing Yards",         short: "RuYd", dispersion: 13,   components: ["RUSH_YDS"], typicalMean: 55 },
  RUSH_ATT:     { key: "RUSH_ATT",     label: "Rush Attempts",         short: "Car",  dispersion: 1.60, components: ["RUSH_ATT"], typicalMean: 14 },
  REC:          { key: "REC",          label: "Receptions",            short: "Rec",  dispersion: 1.10, components: ["REC"], typicalMean: 4 },
  REC_YDS:      { key: "REC_YDS",      label: "Receiving Yards",       short: "ReYd", dispersion: 16,   components: ["REC_YDS"], typicalMean: 48 },
  RUSH_REC_YDS: { key: "RUSH_REC_YDS", label: "Rush + Rec Yards",      short: "R+R",  dispersion: 14,   components: ["RUSH_YDS", "REC_YDS"], typicalMean: 75 },

  // NHL. Small counts on half-point lines, which is the point: a skater who
  // averages 2.9 shots goes over 2.5 about 56% of the time and under 3.5 about
  // 67%, so one side of a standard line is often far from a coin flip, and a
  // pick'em app pays it as if it were one. Shots, points, assists and goals are
  // close to Poisson (shots slightly over, from power-play time and score
  // effects). Saves depend on the other team's shots and are more spread out:
  // a 27-save goalie sits near sd 6.5, a ratio of about 1.6. Labels are distinct
  // from the basketball ones because a label is resolved back to its market.
  SOG:       { key: "SOG",       label: "Shots On Goal",         short: "SOG",  dispersion: 1.10, components: ["SOG"], typicalMean: 2.3 },
  SAVES:     { key: "SAVES",     label: "Goalie Saves",          short: "SV",   dispersion: 1.60, components: ["SAVES"], typicalMean: 26 },
  HKY_PTS:   { key: "HKY_PTS",   label: "Hockey Points",         short: "HPts", dispersion: 1.05, components: ["HKY_GOALS", "HKY_AST"], typicalMean: 0.6 },
  HKY_AST:   { key: "HKY_AST",   label: "Hockey Assists",        short: "HAst", dispersion: 1.00, components: ["HKY_AST"], typicalMean: 0.38 },
  HKY_GOALS: { key: "HKY_GOALS", label: "Goals",                 short: "G",    dispersion: 1.00, components: ["HKY_GOALS"], typicalMean: 0.25 },
  HKY_BLK:   { key: "HKY_BLK",   label: "Hockey Blocked Shots",  short: "HBlk", dispersion: 1.20, components: ["HKY_BLK"], typicalMean: 1.3 },
  HKY_PPP:   { key: "HKY_PPP",   label: "Power Play Points",     short: "PPP",  dispersion: 1.00, components: ["HKY_PPP"], typicalMean: 0.2 },
}

export const MARKET_KEYS = Object.keys(MARKETS) as MarketKey[]

export type Sport = "basketball" | "football" | "hockey"

const FOOTBALL_MARKETS = new Set<MarketKey>([
  "PASS_YDS", "PASS_TDS", "PASS_COMP", "PASS_ATT", "PASS_INT",
  "RUSH_YDS", "RUSH_ATT", "REC", "REC_YDS", "RUSH_REC_YDS",
])

const HOCKEY_MARKETS = new Set<MarketKey>(["SOG", "SAVES", "HKY_PTS", "HKY_AST", "HKY_GOALS", "HKY_BLK", "HKY_PPP"])

/** Which sport a market belongs to. A basketball market on an NFL game is a wasted credit. */
export function marketSport(key: MarketKey): Sport {
  return FOOTBALL_MARKETS.has(key) ? "football" : HOCKEY_MARKETS.has(key) ? "hockey" : "basketball"
}

/**
 * The same word means a different stat in a different sport. A PrizePicks NHL
 * screen prints "Points", "Assists" and "Blocked Shots", which read as the
 * basketball markets; on a hockey entry they are the hockey ones.
 */
const HOCKEY_EQUIVALENT: Partial<Record<MarketKey, MarketKey>> = { PTS: "HKY_PTS", AST: "HKY_AST", BLK: "HKY_BLK" }

export function marketForSport(key: MarketKey, sport: Sport): MarketKey {
  if (sport === "hockey") return HOCKEY_EQUIVALENT[key] ?? key
  if (sport === "basketball") {
    for (const [b, h] of Object.entries(HOCKEY_EQUIVALENT)) if (h === key) return b as MarketKey
  }
  return key
}

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
alias("PASS_YDS", "passing yards", "pass yards", "pass yds", "passing yds", "pass yd", "passing yard")
alias("PASS_TDS", "passing tds", "pass tds", "passing touchdowns", "pass touchdowns", "pass td", "passing td")
alias("PASS_COMP", "pass completions", "completions", "passing completions", "pass comp", "cmp")
alias("PASS_ATT", "pass attempts", "passing attempts", "pass att")
alias("PASS_INT", "interceptions", "interceptions thrown", "pass ints", "pass interceptions", "int thrown")
alias("RUSH_YDS", "rushing yards", "rush yards", "rush yds", "rushing yds", "rush yd")
alias("RUSH_ATT", "rush attempts", "rushing attempts", "carries", "rush att", "rushes")
alias("REC", "receptions", "catches", "rec", "recs", "total receptions")
alias("REC_YDS", "receiving yards", "rec yards", "rec yds", "receiving yds", "rec yd")
// NHL. "Points" and "Assists" alone stay basketball; marketForSport swaps them
// on a hockey entry. "Field goals" is pinned to basketball so "goals" cannot claim it.
alias("FGM", "field goals")
alias("SOG", "shots on goal", "sog", "shots on goal sog", "player shots on goal")
alias("SAVES", "goalie saves", "saves", "total saves", "goaltender saves")
alias("HKY_PTS", "hockey points", "nhl points")
alias("HKY_AST", "hockey assists", "nhl assists")
alias("HKY_GOALS", "goals", "hockey goals", "nhl goals", "goals scored")
alias("HKY_BLK", "hockey blocked shots", "nhl blocked shots")
alias("HKY_PPP", "power play points", "pp points", "ppp", "powerplay points")
alias("RUSH_REC_YDS", "rush+rec yds", "rush+rec yards", "rushing+receiving yards", "rush+rec", "scrimmage yards",
  "rushing receiving yards", "rush rec yds", "rush+rec yd")

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
    .replace(/\b(over|under|o\/u|ou|line|prop|player|nba|wnba|nfl|ncaab|ncaa|cbb|cfb)\b/gi, " ")
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
