import { DEFAULT_CORRELATION, type CorrelationSettings } from "@/lib/quant/correlation"
import { DEFAULT_CONSTRAINTS, type OptimizerConstraints } from "@/lib/quant/optimizer"
import { DEFAULT_APPS, type BookApp, type CapturedPayout } from "@/lib/quant/payouts"
import { DEFAULT_PROJECTION_SETTINGS, type ProjectionSettings, type RawPropRow } from "@/lib/quant/projection"
import type { MarketKey } from "@/lib/nba/markets"

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

export interface OddsFeedSettings {
  /** The Odds API key. Stored in this browser only and sent only to that API. */
  apiKey: string
  /** Books to request, in preference order. */
  books: string[]
  /** Regions parameter for the feed. */
  regions: string
}

export const DEFAULT_ODDS_FEED: OddsFeedSettings = {
  apiKey: "",
  books: ["pinnacle", "betonlineag", "lowvig", "draftkings", "fanduel"],
  regions: "us,us2,eu",
}

export interface AppSettings {
  bankroll: BankrollSettings
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
}

export type LegResult = "PENDING" | "WIN" | "LOSS" | "PUSH"
export type SlipStatus = "PENDING" | "SETTLED" | "VOID"



export interface TrackedLeg {
  player: string
  marketKey: MarketKey | null
  marketLabel: string
  line: number
  side: "OVER" | "UNDER"
  /** Probability the model gave this leg at the moment the bet was placed. */
  pWinAtEntry: number
  app: string | null
  result: LegResult
  actual: number | null
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
   * on screen at build time is ground truth.
   */
  capturedPayout: CapturedPayout
  /** Snapshot of what the model believed when the bet went in. */
  evAtEntry: number
  pAllHitAtEntry: number
  topMultiple: number
  status: SlipStatus
  /** Gross multiple actually returned, once settled. */
  actualMultiple: number | null
  notes: string
}

export interface AppState {
  version: number
  settings: AppSettings
  slate: Slate | null
  slips: TrackedSlip[]
}

export const EMPTY_STATE: AppState = {
  version: STATE_VERSION,
  settings: DEFAULT_SETTINGS,
  slate: null,
  slips: [],
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
      oddsFeed: { ...DEFAULT_ODDS_FEED, ...(s.oddsFeed ?? {}) },
      projection: {
        ...DEFAULT_PROJECTION_SETTINGS,
        ...(s.projection ?? {}),
        dispersion: { ...DEFAULT_PROJECTION_SETTINGS.dispersion, ...(s.projection?.dispersion ?? {}) },
      },
      correlation: { ...DEFAULT_CORRELATION, ...(s.correlation ?? {}) },
      constraints: { ...DEFAULT_CONSTRAINTS, ...(s.constraints ?? {}) },
      apps: Array.isArray(s.apps) && s.apps.length > 0 ? s.apps : DEFAULT_APPS,
      defaultAppId: s.defaultAppId ?? DEFAULT_SETTINGS.defaultAppId,
      defaultModeId: s.defaultModeId ?? DEFAULT_SETTINGS.defaultModeId,
    },
    slate: o.slate ?? null,
    slips: Array.isArray(o.slips) ? o.slips : [],
  }
}
