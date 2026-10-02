import type { MarketKey, Sport } from "@/lib/nba/markets"

/**
 * League configuration.
 *
 * Everything that differs between leagues lives here, so adding one is mostly
 * a data change rather than a code change. The engine itself is league-agnostic:
 * it prices a distribution against a line, and a line is a line whoever posted it.
 *
 * What genuinely differs is the SHAPE of the distribution, and it differs for
 * reasons worth stating rather than fudging:
 *
 *   Game length (basketball). The NBA plays 48 minutes; the WNBA plays 40.
 *   Fewer minutes and slower pace mean fewer possessions, so every counting
 *   stat is smaller. That is the meanScale below, and it is used only for the
 *   sanity-check priors: a real market price always overrides it.
 *
 *   Volatility. Holding the dispersion ratio fixed while the mean falls already
 *   widens the relative spread, because variance/mean = r implies
 *   sd/mean = sqrt(r/mean). That handles most of the WNBA difference.
 *
 *   A different sport (NFL). Football markets are their own stats with their
 *   own spreads (see lib/nba/markets), so the NFL needs no scaling of the
 *   basketball numbers: its scales are 1 and its markets are its own.
 *
 *   A third sport (NHL). Low counts on half-point lines: shots, points, saves.
 *   Its markets are its own, like the NFL's, and so are its feed keys, even
 *   where they share a name with basketball ("player_points").
 *
 *   Market depth. The NBA has props on every book at every game. The WNBA has
 *   props on most books for most games. The NFL is the deepest prop market
 *   there is, but posts a week ahead and moves hard on injury news.
 *   Asking for markets a league does not post burns feed credits for nothing.
 */

export type LeagueId = "nba" | "wnba" | "nfl" | "nhl"

export interface LeagueConfig {
  id: LeagueId
  label: string
  /** Badge text. */
  short: string
  /** The Odds API sport key. */
  sportKey: string
  /** Which family of markets the league uses. */
  sport: Sport
  /** Regulation length in minutes. */
  gameMinutes: number
  /**
   * Multiplier on each market's league-wide typical mean.
   *
   * Used only where no market price exists, as a prior and for plausibility
   * warnings. Derived from per-possession scoring times possessions per game:
   * the NBA runs about 100 possessions at 48 minutes and the WNBA about 82 at
   * 40. Per-player rather than per-team, because
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
    sport: "basketball",
    gameMinutes: 48,
    meanScale: 1,
    dispersionScale: 1,
    markets: ["player_points", "player_rebounds", "player_assists", "player_threes"],
    books: NBA_BOOKS,
    maxGames: 14,
    typicalSlate: 11,
    season: [10, 11, 12, 1, 2, 3, 4, 5, 6],
    caps: { PTS: 60, REB: 30, AST: 25, "3PM": 14, STL: 8, BLK: 10 },
    note: "Deepest basketball prop market. Every game is priced by every book, so the consensus is meaningful and stale lines are rare.",
  },
  wnba: {
    id: "wnba",
    label: "WNBA",
    short: "WNBA",
    sportKey: "basketball_wnba",
    sport: "basketball",
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
  nfl: {
    id: "nfl",
    label: "NFL",
    short: "NFL",
    sportKey: "americanfootball_nfl",
    sport: "football",
    gameMinutes: 60,
    // NFL markets carry their own typical means and spreads, so nothing from
    // basketball is scaled across.
    meanScale: 1,
    dispersionScale: 1,
    // The four markets with the deepest pricing and the most pick'em interest.
    // Touchdowns, completions, attempts, carries and interceptions are mapped
    // too; add their feed keys under Settings to pull them.
    markets: ["player_pass_yds", "player_rush_yds", "player_reception_yds", "player_receptions"],
    books: NBA_BOOKS,
    // A full Sunday is 13 or 14 games. Four markets across all of them is about
    // 56 credits, the same as a full NBA night.
    maxGames: 14,
    typicalSlate: 13,
    season: [9, 10, 11, 12, 1, 2],
    caps: {
      PASS_YDS: 550, PASS_TDS: 7, PASS_COMP: 45, PASS_ATT: 65, PASS_INT: 5,
      RUSH_YDS: 300, RUSH_ATT: 40, REC: 18, REC_YDS: 300, RUSH_REC_YDS: 350,
    },
    note: "Games are mostly Sunday, plus Thursday and Monday nights, so most days have nothing to pull. Props post days ahead and move hard on injury news: refresh on game day. The feed does not say which team a player is on, so a quarterback and his own receiver are only linked as same-game, not as a stack.",
  },
  nhl: {
    id: "nhl",
    label: "NHL",
    short: "NHL",
    sportKey: "icehockey_nhl",
    sport: "hockey",
    gameMinutes: 60,
    // Hockey markets carry their own means and spreads; nothing is scaled across.
    meanScale: 1,
    dispersionScale: 1,
    // Shots on goal and saves first: the deepest-priced NHL props and the ones
    // where a half-point line leaves one side furthest from a coin flip. Goals,
    // blocked shots and power-play points are mapped too; add their feed keys
    // under Settings to pull them.
    markets: ["player_shots_on_goal", "player_points", "player_total_saves", "player_assists"],
    books: NBA_BOOKS,
    // A busy night is 12 to 15 games. Four markets across 12 is 48 credits.
    maxGames: 12,
    typicalSlate: 9,
    season: [10, 11, 12, 1, 2, 3, 4, 5, 6],
    caps: { SOG: 12, SAVES: 60, HKY_PTS: 6, HKY_AST: 5, HKY_GOALS: 4, HKY_BLK: 10, HKY_PPP: 4 },
    note: "Low counts on half-point lines, so one side of a standard line is often far from a coin flip: shots on goal 2.5 and points 0.5 are where pick'em lines most often lag the books. Starting goalies are confirmed late and a backup in net moves every save line and the other team's shots, so refresh close to puck drop. The feed does not say which team a player is on, so a goalie's saves and the other team's shots are linked only as same-game.",
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
 * month. A full NFL Sunday is 14 games; at four markets that is 56 credits in one
 * press, and a handful of careless refreshes empties the month. This is the single
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
