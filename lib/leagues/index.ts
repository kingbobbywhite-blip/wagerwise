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
 *   Volatility. The same projected mean deserves a wider distribution, and
 *   therefore a probability closer to 50%, in a league where usage is less
 *   predictable. That is dispersionScale.
 *
 *   A different sport (NFL). Football markets are their own stats with their
 *   own spreads (see lib/nba/markets), so the NFL needs no scaling of the
 *   basketball numbers: its scales are 1 and its markets are its own.
 *
 *   A third sport (NHL). Low counts on half-point lines: shots, points, saves.
 *   Its markets are its own, like the NFL's, and so are its feed keys, even
 *   where they share a name with basketball ("player_points").
 *
 *   Market depth. The NBA has props on every book at every game. The NFL is the
 *   deepest prop market there is, but posts a week ahead and moves hard on
 *   injury news. College football is priced for the games on television and
 *   barely at all for the rest. Asking for markets a league does not post is at
 *   best a wasted request and may be a wasted credit.
 *
 * COMPANIONS. A league can carry other competitions that are pulled in the
 * same press and priced in the same tables, because they are the same sport
 * played the same week: college football sits inside the NFL section. A
 * companion keeps its own priors, caps and game cap, so a CFB prop is never
 * priced with NFL numbers. See `competitionsFor`.
 */

export type LeagueId = "nba" | "nfl" | "cfb" | "nhl"

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
   * warnings.
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
  /**
   * Other competitions pulled and priced alongside this one, in the same
   * press. Never a tab of its own: a companion appears inside this league's
   * section. Each is priced with its own config.
   */
  companions?: LeagueId[]
  /** True when this league is only ever shown inside another league's section. */
  companionOnly?: boolean
  /**
   * Choose which games to price by how deep their market is, rather than by
   * who starts first.
   *
   * Worth one extra credit only where the slate is far bigger than the cap and
   * the games differ wildly in whether anyone prices them: a college Saturday
   * lists fifty games and a handful carry real props. On a 13-game NFL Sunday
   * the cap takes nearly everything anyway, so there is nothing to rank.
   */
  depthRanked?: boolean
}

const NBA_BOOKS = ["pinnacle", "betonlineag", "lowvig", "draftkings", "fanduel", "betmgm", "caesars", "espnbet"]

const FOOTBALL_MARKETS = ["player_pass_yds", "player_rush_yds", "player_reception_yds", "player_receptions"]

/**
 * College football's own market list, and it is two rather than four.
 *
 * The college prop market is thin away from the televised games: receptions
 * and receiving yards are posted for a handful of players at the games anyone
 * is watching and for nobody at the rest, so two of the four markets came back
 * empty and padded the board with props nothing could price. Whether they also
 * cost a credit each is NOT settled: see UNVERIFIED_EMPTY_MARKET_COST in
 * lib/odds-feed/theoddsapi. The board-quality reason stands either way.
 */
const CFB_MARKETS = ["player_pass_yds", "player_rush_yds"]

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
    // The four markets with the deepest pricing and the most pick'em interest,
    // and the four every pick'em app and FanDuel post. Touchdowns, completions,
    // attempts, carries and interceptions are mapped too; add their feed keys
    // under Settings to pull them.
    markets: FOOTBALL_MARKETS,
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
    // College football rides along: same sport, same markets, same Saturday-to-
    // Monday week, and the pick'em apps post both on one board.
    companions: ["cfb"],
    note: "Games are mostly Sunday, plus Thursday and Monday nights, so most days have nothing to pull. College football is pulled with it and priced with its own numbers. Props post days ahead and move hard on injury news: a line pulled days out is widened for that, but refresh on game day. The feed does not say which team a player is on, so a quarterback and his own receiver are only linked as same-game, not as a stack.",
  },
  cfb: {
    id: "cfb",
    label: "College football",
    short: "CFB",
    sportKey: "americanfootball_ncaaf",
    sport: "football",
    gameMinutes: 60,
    meanScale: 1,
    // Wider than the NFL at the same projected mean, and this is the single
    // most important thing to get right about college football. The talent gap
    // between the two rosters is often enormous, starters sit out the fourth
    // quarter of a blowout, and the backfield split is far less knowable than
    // in the NFL. All three widen the outcome and pull every probability back
    // toward a coin flip, which is the honest answer here.
    //
    // UNFITTED: 1.2 is reasoned from those three facts, not measured against
    // realised results. The tracker's per-competition calibration is where it
    // gets checked once there are enough settled college legs to check it
    // with; until then it is a prior and is labelled as one on screen.
    dispersionScale: 1.2,
    markets: CFB_MARKETS,
    books: NBA_BOOKS,
    // A Saturday has 50 or more games and only the televised ones carry real
    // prop pricing, so the cap is small on purpose: four games at two markets
    // is 8 credits on top of the NFL pull.
    maxGames: 4,
    typicalSlate: 45,
    season: [8, 9, 10, 11, 12, 1],
    // A 500-yard passing game and a 300-yard rushing game both happen in
    // college football, so NFL ceilings would flag real outcomes as implausible.
    caps: {
      PASS_YDS: 650, PASS_TDS: 9, PASS_COMP: 55, PASS_ATT: 75, PASS_INT: 6,
      RUSH_YDS: 400, RUSH_ATT: 45, REC: 20, REC_YDS: 350, RUSH_REC_YDS: 450,
    },
    companionOnly: true,
    depthRanked: true,
    note: "Priced inside the NFL section with its own, wider numbers. Only the games on television carry real prop pricing, so most of a Saturday slate comes back unpriced and is correctly left out. Blowouts are routine and starters sit: treat a projection here as less certain than the same number in the NFL.",
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
    // Only the four markets PrizePicks, Underdog and FanDuel all actually post
    // with both sides near a coin flip: shots on goal, points, goalie saves and
    // blocked shots. Goals and power-play points are deliberately NOT here.
    // Their only posted line is 0.5 against a mean near 0.25, so the favoured
    // side is an 80% under, no pick'em app posts the prop at all, and pulling
    // them filled the board with picks that could not be placed anywhere.
    // They stay mapped, for reading a logged entry; add their feed keys under
    // Settings if a book ever hangs a line worth taking.
    markets: ["player_shots_on_goal", "player_points", "player_total_saves", "player_blocked_shots"],
    books: NBA_BOOKS,
    // A busy night is 12 to 15 games. Four markets across 12 is 48 credits.
    maxGames: 12,
    typicalSlate: 9,
    season: [10, 11, 12, 1, 2, 3, 4, 5, 6],
    caps: { SOG: 12, SAVES: 60, HKY_PTS: 6, HKY_AST: 5, HKY_GOALS: 4, HKY_BLK: 10, HKY_PPP: 4 },
    note: "Low counts on half-point lines, so one side of a standard line is often far from a coin flip: shots on goal 2.5 and points 0.5 are where pick'em lines most often lag the books. Only the markets the apps actually post are pulled. Starting goalies are confirmed late and a backup in net moves every save line and the other team's shots, so refresh close to puck drop. The feed does not say which team a player is on, so a goalie's saves and the other team's shots are linked only as same-game.",
  },
}

export const LEAGUE_IDS = Object.keys(LEAGUES) as LeagueId[]

/**
 * Leagues that get a tab of their own. A companion competition is pulled and
 * priced inside its parent's section, so it is not one of these.
 */
export const TAB_LEAGUE_IDS = LEAGUE_IDS.filter((id) => !LEAGUES[id].companionOnly)

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
 * Every competition one press of this league's button pulls: the league itself
 * first, then its companions. One entry for a league with no companions, so
 * callers can always loop.
 *
 * Companions are OPT-IN and off unless asked for. A companion costs real feed
 * credits, and the default for anything that spends money is not to. A caller
 * that forgets the flag therefore under-pulls rather than over-bills, which is
 * the cheaper mistake of the two.
 */
export function competitionsFor(id: LeagueId, opts: { companions?: boolean } = {}): LeagueConfig[] {
  const league = LEAGUES[id]
  if (!opts.companions) return [league]
  return [league, ...(league.companions ?? []).map((c) => LEAGUES[c])]
}

/** The companions this league would add, which is nothing unless it has any. */
export function companionsOf(id: LeagueId): LeagueConfig[] {
  return (LEAGUES[id].companions ?? []).map((c) => LEAGUES[c])
}

/**
 * Is the league plausibly in season on this date?
 *
 * Used only to explain an empty slate. An empty response in July from the NBA
 * is the off-season; the same response in January is a real problem worth
 * looking at. Telling the two apart saves a pointless debugging session. A
 * league whose companion is in season counts as in season, because the press
 * will still return a slate.
 */
export function inSeason(id: LeagueId, when: Date = new Date(), opts: { companions?: boolean } = {}): boolean {
  const month = when.getUTCMonth() + 1
  return competitionsFor(id, opts).some((l) => l.season.includes(month))
}

/**
 * What a full pull of this league would cost, and whether that is reckless.
 *
 * Player props are billed per market per event. The free tier is 500 requests a
 * month. A full NFL Sunday is 14 games, plus six college games pulled with it;
 * at four markets that is 80 credits in one press, and a handful of careless
 * refreshes empties the month. This is the single most expensive mistake
 * available in the app, so it is computed up front and shown before the button
 * is pressed rather than discovered afterwards.
 */
export interface CompetitionPlan {
  league: LeagueConfig
  /** Games this competition would be asked for. */
  games: number
}

/**
 * What one press of this league's button would pull, per competition.
 *
 * The league's own cap is the dial on the Today screen; a companion keeps the
 * cap sized to its own slate. Returned per competition rather than as a single
 * number because each competition can be asked for a different market list,
 * and credits are billed per market per game: multiplying a combined game
 * count by one market count overstates the cheap competition and understates
 * the expensive one.
 */
export function pullPlan(id: LeagueId, primaryCap: number, opts: { companions?: boolean } = {}): CompetitionPlan[] {
  return competitionsFor(id, opts).map((league) => ({
    league,
    games: league.id === id ? Math.max(0, primaryCap) : league.maxGames,
  }))
}

/** Games one press would pull, across every competition in the plan. */
export function plannedGames(id: LeagueId, primaryCap: number, opts: { companions?: boolean } = {}): number {
  return pullPlan(id, primaryCap, opts).reduce((a, p) => a + p.games, 0)
}

/**
 * Share of a month one pull may spend before the button has to ask first.
 *
 * Seven presses at this size empty the month, which is a fortnight of casual
 * refreshing. Above it the spend stops being a note beside the button and
 * becomes a question the button asks, because a note is read after the credits
 * are gone and a question is answered before.
 */
export const CONFIRM_PCT_OF_QUOTA = 0.15

export interface CreditPlan {
  credits: number
  pctOfQuota: number
  /** Worth shouting about: a quarter of the month in one press. */
  severe: boolean
  /** The button must ask before spending this. */
  confirm: boolean
  /** Shown beside the button. Null when the spend is unremarkable. */
  message: string | null
  /** Shown in the confirm dialog. Null when no confirm is needed. */
  prompt: string | null
}

/** The cost of a pull whose credits are already totted up across competitions. */
export function creditPlan(id: LeagueId, credits: number, monthlyQuota = 500): CreditPlan {
  const spend = Math.max(0, Math.round(credits))
  const pctOfQuota = monthlyQuota > 0 ? spend / monthlyQuota : 0
  const pct = Math.round(pctOfQuota * 100)
  const confirm = pctOfQuota >= CONFIRM_PCT_OF_QUOTA
  const prompt = confirm
    ? `This pull spends about ${spend} feed credits, ${pct}% of a 500-request month, and ${Math.ceil(1 / Math.max(pctOfQuota, 1e-9))} presses like it would empty the month. Lower the game cap or the market count in Settings to spend less. Pull anyway?`
    : null
  if (spend === 0) return { credits: spend, pctOfQuota, severe: false, confirm: false, message: null, prompt: null }
  if (pctOfQuota >= 0.25) {
    return {
      credits: spend,
      pctOfQuota,
      severe: true,
      confirm,
      message: `This pull costs about ${spend} feed credits, roughly ${pct}% of a 500-request month. ${LEAGUES[id].label} slates are large; lower the game cap or the market count before refreshing often.`,
      prompt,
    }
  }
  if (pctOfQuota >= 0.1) {
    return {
      credits: spend,
      pctOfQuota,
      severe: false,
      confirm,
      message: `About ${spend} feed credits, ${pct}% of a 500-request month.`,
      prompt,
    }
  }
  return { credits: spend, pctOfQuota, severe: false, confirm: false, message: null, prompt: null }
}

/** The same, for a pull whose every competition shares one market list. */
export function creditWarning(id: LeagueId, games: number, markets: number, monthlyQuota = 500): CreditPlan {
  return creditPlan(id, Math.max(0, games) * Math.max(0, markets), monthlyQuota)
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
