import type { LeagueId } from "@/lib/leagues"
import type { PickemGame, PickemLine } from "@/lib/odds-feed/propline"
import type { FeedQuote } from "@/lib/quant/valuebets"
import type { DailyCache, OddsProvider } from "@/lib/store/schema"

/** The parts of /api/today's response the Today screen keeps. */
export interface TodayResponse {
  fetchedAt?: string
  quotes?: FeedQuote[]
  events?: DailyCache["events"]
  requestsRemaining?: number | null
  estimatedCredits?: number
  nextEvent?: DailyCache["nextEvent"]
  provider?: OddsProvider
  pickemLines?: PickemLine[]
  pickemGames?: PickemGame[]
  pickemStarted?: string[]
  pickemNote?: string | null
}

/**
 * The cached pull for a league, from /api/today's response. Every field the
 * screen reads back is copied here, in one place a test covers, so a field the
 * route returns cannot be dropped on the way to the screen.
 */
export function dailyCacheFrom(
  data: TodayResponse,
  league: LeagueId,
  provider: OddsProvider,
  fetchedAt: string = new Date().toISOString(),
): DailyCache {
  return {
    league,
    fetchedAt: data.fetchedAt ?? fetchedAt,
    quotes: data.quotes ?? [],
    events: data.events ?? [],
    requestsRemaining: data.requestsRemaining ?? null,
    creditsSpent: data.estimatedCredits ?? 0,
    nextEvent: data.nextEvent,
    provider: data.provider ?? provider,
    pickemLines: data.pickemLines ?? undefined,
    pickemGames: data.pickemGames ?? undefined,
    pickemStarted: data.pickemStarted ?? undefined,
    pickemNote: data.pickemNote ?? null,
  }
}
