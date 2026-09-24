import type { MarketKey } from "@/lib/nba/markets"

/**
 * League configuration.
 *
 * Everything that differs between basketball leagues lives here, so adding a
 * fourth league is a data change rather than a code change. The engine itself
 * is league-agnostic: it prices a distribution against a line, and a line is a
 * line whoever posted it.
 *
 * What genuinely differs is the SHAPE of the distribution, and it differs for
 * reasons worth stating rather than fudging:
 *
 *   Game length. The NBA plays 48 minutes; the WNBA and college basketball play
 *   40. Fewer minutes and slower pace mean fewer possessions, so every counting
 *   stat is smaller. That is the meanScale below, and it is used only for the
 *   sanity-check priors — a real market price always overrides it.
 *
 *   Volatility. This is the part that actually changes probabilities. Holding
 *   the dispersion ratio fixed while the mean falls already widens the relative
 *   spread, because variance/mean = r implies sd/mean = sqrt(r/mean). That
 *   handles most of the WNBA difference. College basketball needs an explicit
 *   bump on top: five fouls in a 40-minute game removes starters far more often
 *   than six fouls in 48, rotations are deeper and less predictable, and the
 *   talent gap between opponents is enormous compared with a professional
 *   league. A college scorer's minutes are simply less knowable than a pro's.
 *
 *   Market depth. The NBA has props on every book at every game. The WNBA has
 *   props on most books for most games. College basketball has props on a
 *   handful of books, usually only for televised games, and often only points.
 *   Asking for markets a league does not post burns feed credits for nothing.
 */

export type LeagueId = "nba" | "wnba" | "ncaab"

export interface LeagueConfig {
  id: LeagueId
  label: string
  /** Badge text. */
  short: string
  /** The Odds API sport key. */
  sportKey: string
  /** Regulation length in minutes. */
  gameMinutes: number
  /**
   * Multiplier on each market's league-wide typical mean.
   *
   * Used only where no market price exists, as a prior and for plausibility
   * warnings. Derived from per-possession scoring times possessions per game:
   * the NBA runs about 100 possessions at 48 minutes, the WNBA about 82 at 40,
   * and men's college about 67 at 40. Per-player rather than per-team, because
   * a WNBA starter plays a larger share of a shorter game than an NBA starter
   * plays of a longer one, which claws back part of the gap.
   */
  meanScale: number
  /** Multiplier on each market's variance/mean ratio. See the note above. */
  dispersionScale: number
  /** Feed market keys this league actually posts often enough to be worth asking for. */
  markets: string[]
  /** Books that reliably post player props for this league. */
  books: string[]
  /** Default cap on games per pull, sized to the league's slate and the credit cost. */
  maxGames: number
  /** Rough games on a busy in-season day, used for the quota warning. */
  typicalSlate: number
  /** Months (1-12) the league is normally in season, for the off-season notice. */
  season: number[]
  /** Plausibility ceilings for the "this projection is not believable" warning. */
  caps: Partial<Record<MarketKey, number>>
  /** Shown in the UI so the league's specific caveat is never hidden. */
  note: string
}

const NBA_BOOKS = ["pinnacle", "betonlineag", "lowvig", "draftkings", "fanduel", "betmgm", "caesars", "espnbet"]

export const LEAGUES: Record<LeagueId, LeagueConfig> = {
  nba: {
    id: "nba",
    label: "NBA",
    short: "NBA",
    sportKey: "basketball_nba",
    gameMinutes: 48,
    meanScale: 1,
    dispersionScale: 1,
    markets: ["player_points", "player_rebounds", "player_assists", "player_threes"],
    books: NBA_BOOKS,
    maxGames: 14,
    typicalSlate: 11,
    season: [10, 11, 12, 1, 2, 3, 4, 5, 6],
    caps: { PTS: 60, REB: 30, AST: 25, "3PM": 14, STL: 8, BLK: 10 },
    note: "Deepest prop market of the three. Every game is priced by every book, so the consensus is meaningful and stale lines are rare.",
  },
  wnba: {
    id: "wnba",
    label: "WNBA",
    short: "WNBA",
    sportKey: "basketball_wnba",
    gameMinutes: 40,
    // 82 possessions over 40 minutes against 100 over 48, offset by starters
    // taking a larger share of the shorter game.
    meanScale: 0.78,
    // Slightly noisier than the NBA at equal minutes: shorter rotations mean a
    // single foul-trouble night moves a line further.
    dispersionScale: 1.05,
    markets: ["player_points", "player_rebounds", "player_assists", "player_threes"],
    books: ["pinnacle", "betonlineag", "lowvig", "draftkings", "fanduel", "betmgm", "caesars"],
    maxGames: 8,
    typicalSlate: 5,
    season: [5, 6, 7, 8, 9, 10],
    caps: { PTS: 45, REB: 22, AST: 18, "3PM": 11, STL: 7, BLK: 8 },
    note: "Thinner market than the NBA, which cuts both ways: fewer books means a weaker consensus, but also more genuinely stale numbers. Small rosters make minutes projections unusually sensitive to one absence.",
  },
  ncaab: {
    id: "ncaab",
    label: "College (M)",
    short: "CBB",
    sportKey: "basketball_ncaab",
    gameMinutes: 40,
    // ~67 possessions over 40 minutes, partly offset by star usage.
    meanScale: 0.70,
    // The real difference. Five fouls in 40 minutes, deep and unpredictable
    // rotations, and a talent gap between opponents no professional league has.
    dispersionScale: 1.20,
    // Points are posted widely; rebounds and assists are patchy and threes are
    // hit and miss. Asking for four markets on a game that only posts one is
    // three wasted credits, and college slates are enormous.
    markets: ["player_points", "player_rebounds", "player_assists"],
    books: ["pinnacle", "betonlineag", "lowvig", "draftkings", "fanduel"],
    // Deliberately small. See creditWarning below: an uncapped college pull can
    // spend a month's free quota in a single press.
    maxGames: 6,
    typicalSlate: 90,
    season: [11, 12, 1, 2, 3, 4],
    caps: { PTS: 50, REB: 25, AST: 20, "3PM": 13, STL: 8, BLK: 10 },
    note: "Props exist only for the games books bother to price, usually televised ones. Expect most of the slate to come back empty, and expect points to be the only market on many games.",
  },
}

export const LEAGUE_IDS = Object.keys(LEAGUES) as LeagueId[]

export const DEFAULT_LEAGUE: LeagueId = "nba"

export function isLeagueId(v: unknown): v is LeagueId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(LEAGUES, v)
}

/** Resolve a league id, falling back to the NBA rather than throwing. */
export function leagueFor(id: unknown): LeagueConfig {
  return isLeagueId(id) ? LEAGUES[id] : LEAGUES[DEFAULT_LEAGUE]
}

/** Sport key for the feed, or null if the id is not one we support. */
export function sportKeyFor(id: unknown): string | null {
  return isLeagueId(id) ? LEAGUES[id].sportKey : null
}

/**
 * Is the league plausibly in season on this date?
 *
 * Used only to explain an empty slate. An empty response in July from the NBA
 * is the off-season; the same response in January is a real problem worth
 * looking at. Telling the two apart saves a pointless debugging session.
 */
export function inSeason(id: LeagueId, when: Date = new Date()): boolean {
  return LEAGUES[id].season.includes(when.getUTCMonth() + 1)
}

/**
 * What a full pull of this league would cost, and whether that is reckless.
 *
 * Player props are billed per market per event. The free tier is 500 requests a
 * month. A college slate in February can be 100+ games; at three markets that is
 * 300 credits in one press, and two presses empty the month. This is the single
 * most expensive mistake available in the app, so it is computed up front and
 * shown before the button is pressed rather than discovered afterwards.
 */
export function creditWarning(
  id: LeagueId,
  games: number,
  markets: number,
  monthlyQuota = 500,
): { credits: number; pctOfQuota: number; severe: boolean; message: string | null } {
  const credits = Math.max(0, games) * Math.max(0, markets)
  const pctOfQuota = monthlyQuota > 0 ? credits / monthlyQuota : 0
  if (credits === 0) return { credits, pctOfQuota, severe: false, message: null }
  if (pctOfQuota >= 0.25) {
    return {
      credits,
      pctOfQuota,
      severe: true,
      message: `This pull costs about ${credits} feed credits, roughly ${Math.round(pctOfQuota * 100)}% of a 500-request month. ${LEAGUES[id].label} slates are large; lower the game cap or the market count before refreshing often.`,
    }
  }
  if (pctOfQuota >= 0.1) {
    return {
      credits,
      pctOfQuota,
      severe: false,
      message: `About ${credits} feed credits, ${Math.round(pctOfQuota * 100)}% of a 500-request month.`,
    }
  }
  return { credits, pctOfQuota, severe: false, message: null }
}

/**
 * Scale a market's league-wide prior mean into this league.
 *
 * Only ever a fallback. If a sportsbook has priced the prop, the market's own
 * implied mean is used and this never runs.
 */
export function scaleMean(id: LeagueId, typicalMean: number): number {
  return typicalMean * LEAGUES[id].meanScale
}
