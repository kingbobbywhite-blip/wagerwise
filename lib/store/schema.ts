import { DEFAULT_CORRELATION, type CorrelationSettings } from "@/lib/quant/correlation"
import { DEFAULT_CONSTRAINTS, type OptimizerConstraints } from "@/lib/quant/optimizer"
import { DEFAULT_APPS, type BookApp, type CapturedPayout } from "@/lib/quant/payouts"
import { DEFAULT_PROJECTION_SETTINGS, type ProjectionSettings, type RawPropRow } from "@/lib/quant/projection"
import type { MarketKey } from "@/lib/nba/markets"
import type { FeedQuote } from "@/lib/quant/valuebets"
import type { PickemLine } from "@/lib/odds-feed/propline"
import { DEFAULT_LEAGUE, LEAGUES, isLeagueId, type LeagueId } from "@/lib/leagues"

export const STATE_VERSION = 1

export interface BankrollSettings {
  bankroll: number
  unitSize: number
  /** Fraction of full Kelly to actually stake. Full Kelly is far too volatile. */
  kellyFraction: number
  /** Hard ceiling on any single entry, as a fraction of bankroll. */
  maxStakePct: number
  /** Refuse to surface entries below this expected value. */
  minEvPct: number
}

export const DEFAULT_BANKROLL: BankrollSettings = {
  bankroll: 1000,
  unitSize: 10,
  kellyFraction: 0.25,
  maxStakePct: 0.02,
  minEvPct: 0,
}

/**
 * Which feed prices the slate. The Odds API carries Pinnacle's player props;
 * PropLine bills per request rather than per market, and carries the pick'em
 * apps' own lines in the same payload.
 */
export type OddsProvider = "theoddsapi" | "propline"

export const ODDS_PROVIDERS: OddsProvider[] = ["theoddsapi", "propline"]

export interface OddsFeedSettings {
  /** Which feed prices the slate. */
  provider: OddsProvider
  /** The Odds API key. Stored in this browser only and sent only to that API. */
  apiKey: string
  /** PropLine key. Stored in this browser only and sent only to PropLine. */
  proplineKey: string
  /**
   * Pull the pick'em apps' own lines from PropLine alongside the prices. With
   * PropLine as the provider they come in the same requests for free; with The
   * Odds API pricing the slate it costs one PropLine request per game, against
   * a daily allowance rather than the monthly credit quota.
   */
  pickemLines: boolean
  /** Books to request, in preference order. */
  books: string[]
  /**
   * Books you hold an account at and can actually bet.
   *
   * Every other book is a reference only: it helps judge what a line is worth
   * but is never shown as the place to bet. Pinnacle, BetOnline and LowVig are
   * the sharpest references and none of them takes US customers, so a bet
   * recommended there is a bet you cannot place.
   */
  bettable: string[]
  /** Regions parameter for the feed. */
  regions: string
}

export const DEFAULT_ODDS_FEED: OddsFeedSettings = {
  provider: "theoddsapi",
  apiKey: "",
  proplineKey: "",
  pickemLines: true,
  books: ["pinnacle", "betonlineag", "lowvig", "draftkings", "fanduel"],
  // FanDuel is the only sportsbook in the rotation. The rest of the list
  // above prices the market; nothing is ever recommended there.
  bettable: ["fanduel"],
  regions: "us,us2,eu",
}

/** The bettable list every phone stored before it was narrowed to FanDuel. */
const OLD_DEFAULT_BETTABLE = ["fanduel", "draftkings", "betmgm", "williamhill_us", "espnbet"]

/** Apps once shipped by default and never used, dropped from stored settings. */
const RETIRED_APPS = new Set(["dabble", "chalkboard"])

export interface DailySettings {
  /** Which league the Today screen is showing. */
  league: LeagueId
  /** Ignore value bets below this edge. */
  minEdge: number
  /** Require a market-making book in every reference price. */
  requireSharpReference: boolean
  /** Legs per parlay. */
  parlayLegs: number
  /** Cap on games pulled in one refresh, to protect the feed quota. */
  maxGames: number
  /**
   * Feed market keys to request. Fewer markets means fewer credits.
   *
   * Null means "use whatever this league posts", which is almost always the
   * right answer: basketball and the NFL post entirely different markets, and
   * paying for a market that comes back empty is the easiest way to waste a
   * quota. Entries from the wrong sport for a league are ignored.
   */
  markets: string[] | null
}

export const DEFAULT_DAILY: DailySettings = {
  league: DEFAULT_LEAGUE,
  minEdge: 0.02,
  requireSharpReference: true,
  parlayLegs: 3,
  maxGames: LEAGUES[DEFAULT_LEAGUE].maxGames,
  markets: null,
}

export interface AppSettings {
  bankroll: BankrollSettings
  daily: DailySettings
  oddsFeed: OddsFeedSettings
  projection: ProjectionSettings
  correlation: CorrelationSettings
  constraints: OptimizerConstraints
  apps: BookApp[]
  defaultAppId: string
  defaultModeId: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  bankroll: DEFAULT_BANKROLL,
  daily: DEFAULT_DAILY,
  oddsFeed: DEFAULT_ODDS_FEED,
  projection: DEFAULT_PROJECTION_SETTINGS,
  correlation: DEFAULT_CORRELATION,
  constraints: DEFAULT_CONSTRAINTS,
  apps: DEFAULT_APPS,
  defaultAppId: "prizepicks",
  defaultModeId: "power",
}

export interface Slate {
  id: string
  label: string
  importedAt: string
  rows: RawPropRow[]
  /** Free-text note about where the data came from. */
  source: string
  /**
   * League the props belong to. Sets the dispersion prior and plausibility
   * ceilings the board prices with. Absent on slates captured before leagues
   * existed, which were all NBA.
   */
  league?: LeagueId
}

/** VOID: the player did not play ("Reboot" on PrizePicks). The leg drops out, like a push. */
export type LegResult = "PENDING" | "WIN" | "LOSS" | "PUSH" | "VOID"

/**
 * What kind of pick a leg was. Goblins are easier lines that pay less, demons
 * harder ones that pay more, so each needs a different hit rate to be worth
 * it and their records only mean something kept apart.
 */
export type PickType = "standard" | "goblin" | "demon"
export type SlipStatus = "PENDING" | "SETTLED" | "VOID"



export interface TrackedLeg {
  player: string
  marketKey: MarketKey | null
  marketLabel: string
  line: number
  side: "OVER" | "UNDER"
  /**
   * Probability the model gave this leg at the moment the bet was placed. Null
   * for a leg the app never priced, such as one logged from an entry placed
   * straight in the pick'em app; those count toward profit but not calibration.
   */
  pWinAtEntry: number | null
  app: string | null
  result: LegResult
  actual: number | null
  /** Absent on legs logged before pick types were recorded. */
  pickType?: PickType
}

export interface TrackedSlip {
  id: string
  createdAt: string
  settledAt: string | null
  appId: string
  modeId: string
  legs: TrackedLeg[]
  stake: number
  /**
   * The payout the app actually displayed when the entry was built, captured
   * rather than read back from a stored table. Stored tables drift; the number
   * on screen at build time is ground truth. Null for a logged flex entry that
   * had already paid out: its screen shows what it paid, not what it would have.
   */
  capturedPayout: CapturedPayout | null
  /** Snapshot of what the model believed when the bet went in. Null when any leg was never priced. */
  evAtEntry: number | null
  pAllHitAtEntry: number | null
  /** "built" in the app, or "logged" from an entry placed elsewhere. Absent on older entries, which were all built. */
  source?: "built" | "logged"
  /** Null when the entry was logged after it paid out and its all-hit payout was never shown. */
  topMultiple: number | null
  status: SlipStatus
  /** Gross multiple actually returned, once settled. */
  actualMultiple: number | null
  /**
   * Dollars the app actually returned, read off the settled entry ("$10 paid
   * $5", or nothing for one marked Loss). When known it IS the result: it
   * already reflects goblins, demons, reboots and whatever table the app
   * really used, none of which a stored table gets right. Absent on entries
   * settled from their legs.
   */
  paidOut?: number | null
  notes: string
}

/**
 * The last pull from the odds feed.
 *
 * Cached in local storage on purpose. Player props are billed per market per
 * event, so a page refresh that silently re-pulls the slate is a refresh that
 * costs money. Nothing refetches without an explicit press.
 */
export interface DailyCache {
  /** The league this cache belongs to. A cache is never shown for another one. */
  league: LeagueId
  fetchedAt: string
  quotes: FeedQuote[]
  events: { id: string; commence_time: string; home_team: string; away_team: string }[]
  requestsRemaining: number | null
  creditsSpent: number
  /**
   * When today's window had no games: the next game the feed lists, or null if
   * it lists none at all. Tells "no game today" apart from "season over".
   */
  nextEvent?: { commence_time: string; home_team: string; away_team: string } | null
  /** Games in today's window that had already started at pull time, and so were not priced. */
  startedCount?: number
  /** The feed that priced this pull. Absent on pulls from before there was a choice. */
  provider?: OddsProvider
  /** Lines the pick'em apps were posting at pull time, from PropLine. Absent when not pulled. */
  pickemLines?: PickemLine[]
  /** Why the pick'em lines are missing or partial, when they are. */
  pickemNote?: string | null
}

export interface AppState {
  version: number
  settings: AppSettings
  slate: Slate | null
  slips: TrackedSlip[]
  /** Last pull per league, so switching leagues does not discard a paid-for slate. */
  daily: Partial<Record<LeagueId, DailyCache>>
}

export const EMPTY_STATE: AppState = {
  version: STATE_VERSION,
  settings: DEFAULT_SETTINGS,
  slate: null,
  slips: [],
  daily: {},
}

/**
 * Merge a stored blob into the current shape.
 * Settings gain fields as the engine grows, and a user who imported a slate six
 * weeks ago should not lose it to a schema change.
 */
export function migrate(raw: unknown): AppState {
  if (!raw || typeof raw !== "object") return EMPTY_STATE
  const o = raw as Partial<AppState>
  const s = (o.settings ?? {}) as Partial<AppSettings>
  return {
    version: STATE_VERSION,
    settings: {
      bankroll: { ...DEFAULT_BANKROLL, ...(s.bankroll ?? {}) },
      daily: { ...DEFAULT_DAILY, ...(s.daily ?? {}), league: isLeagueId(s.daily?.league) ? s.daily.league : DEFAULT_LEAGUE },
      oddsFeed: migrateOddsFeed(s.oddsFeed),
      projection: {
        ...DEFAULT_PROJECTION_SETTINGS,
        ...(s.projection ?? {}),
        dispersion: { ...DEFAULT_PROJECTION_SETTINGS.dispersion, ...(s.projection?.dispersion ?? {}) },
        // A league that no longer exists (college basketball) falls back to the NBA.
        league: isLeagueId(s.projection?.league) ? s.projection.league : DEFAULT_PROJECTION_SETTINGS.league,
      },
      correlation: { ...DEFAULT_CORRELATION, ...(s.correlation ?? {}) },
      constraints: { ...DEFAULT_CONSTRAINTS, ...(s.constraints ?? {}) },
      apps: Array.isArray(s.apps) && s.apps.length > 0 ? s.apps.filter((a) => !RETIRED_APPS.has(a.id)) : DEFAULT_APPS,
      defaultAppId: s.defaultAppId ?? DEFAULT_SETTINGS.defaultAppId,
      defaultModeId: s.defaultModeId ?? DEFAULT_SETTINGS.defaultModeId,
    },
    slate: o.slate ? { ...o.slate, league: isLeagueId(o.slate.league) ? o.slate.league : undefined } : null,
    slips: Array.isArray(o.slips) ? o.slips : [],
    daily: migrateDaily(o.daily),
  }
}

/**
 * A bettable list still at the old five-book default was never chosen, so it
 * moves to the new one. A list someone edited is theirs and is kept.
 */
function migrateOddsFeed(stored: Partial<OddsFeedSettings> | undefined): OddsFeedSettings {
  const base = { ...DEFAULT_ODDS_FEED, ...(stored ?? {}) }
  const merged = { ...base, provider: ODDS_PROVIDERS.includes(base.provider) ? base.provider : DEFAULT_ODDS_FEED.provider }
  const b = stored?.bettable
  const untouched =
    Array.isArray(b) && b.length === OLD_DEFAULT_BETTABLE.length && OLD_DEFAULT_BETTABLE.every((id) => b.includes(id))
  return untouched ? { ...merged, bettable: DEFAULT_ODDS_FEED.bettable } : merged
}

/**
 * Bring the daily cache forward.
 *
 * Before leagues existed this was a single object holding an NBA pull. Anyone
 * upgrading has one of those in local storage, and it is a slate they paid feed
 * credits for, so it is kept and filed under the NBA rather than dropped.
 */
function migrateDaily(raw: unknown): Partial<Record<LeagueId, DailyCache>> {
  if (!raw || typeof raw !== "object") return {}
  const o = raw as Record<string, unknown>

  // Old shape: a bare DailyCache with quotes at the top level.
  if (Array.isArray(o.quotes)) {
    const legacy = raw as DailyCache
    return { [DEFAULT_LEAGUE]: { ...legacy, league: DEFAULT_LEAGUE } }
  }

  const out: Partial<Record<LeagueId, DailyCache>> = {}
  for (const [k, v] of Object.entries(o)) {
    if (!isLeagueId(k) || !v || typeof v !== "object") continue
    const cache = v as DailyCache
    if (!Array.isArray(cache.quotes)) continue
    out[k] = { ...cache, league: k }
  }
  return out
}
