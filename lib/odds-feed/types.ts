/**
 * Response shapes for The Odds API v4.
 *
 * Typed narrowly on purpose. A feed that changes shape should fail loudly at the
 * normalisation step rather than quietly producing props with undefined prices.
 */

export interface FeedEvent {
  id: string
  sport_key: string
  commence_time: string
  home_team: string
  away_team: string
}

export interface FeedOutcome {
  /** "Over" or "Under" for player props. */
  name: string
  /** The player's name for player props. */
  description?: string
  price: number
  point?: number
}

export interface FeedMarket {
  key: string
  last_update?: string
  outcomes: FeedOutcome[]
}

export interface FeedBookmaker {
  key: string
  title: string
  last_update?: string
  markets: FeedMarket[]
}

export interface FeedEventOdds {
  id: string
  commence_time: string
  home_team: string
  away_team: string
  bookmakers: FeedBookmaker[]
}

export interface FeedUsage {
  requestsRemaining: number | null
  requestsUsed: number | null
}
