import { describe, expect, it } from "vitest"
import { dailyCacheFrom, type TodayResponse } from "@/lib/today/cache"

describe("dailyCacheFrom", () => {
  const full: Required<TodayResponse> = {
    fetchedAt: "2026-01-16T00:00:00Z",
    quotes: [],
    events: [{ id: "e1", commence_time: "2026-01-16T00:10:00Z", home_team: "H", away_team: "A" }],
    requestsRemaining: 412,
    estimatedCredits: 8,
    nextEvent: null,
    provider: "propline",
    pickemLines: [],
    pickemGames: [{ app: "prizepicks", gameId: "A@H" }],
    pickemStarted: ["A@H"],
    pickemNote: "note",
  }

  it("keeps every field the route returns, including the games each app answered for and the games under way", () => {
    const cache = dailyCacheFrom(full, "nba", "theoddsapi")
    expect(cache).toEqual({
      league: "nba",
      fetchedAt: full.fetchedAt,
      quotes: full.quotes,
      events: full.events,
      requestsRemaining: 412,
      creditsSpent: 8,
      nextEvent: null,
      provider: "propline",
      pickemLines: full.pickemLines,
      pickemGames: full.pickemGames,
      pickemStarted: ["A@H"],
      pickemNote: "note",
    })
  })

  it("drops none of the response's fields on the way to the cache", () => {
    const cache = dailyCacheFrom(full, "nba", "theoddsapi") as unknown as Record<string, unknown>
    // estimatedCredits is stored as creditsSpent; every other field keeps its name.
    for (const key of Object.keys(full).filter((k) => k !== "estimatedCredits")) {
      expect(cache[key], key).toEqual((full as Record<string, unknown>)[key])
    }
  })

  it("fills defaults for a minimal response", () => {
    expect(dailyCacheFrom({}, "wnba", "theoddsapi", "2026-01-16T00:00:00Z")).toEqual({
      league: "wnba",
      fetchedAt: "2026-01-16T00:00:00Z",
      quotes: [],
      events: [],
      requestsRemaining: null,
      creditsSpent: 0,
      nextEvent: undefined,
      provider: "theoddsapi",
      pickemLines: undefined,
      pickemGames: undefined,
      pickemStarted: undefined,
      pickemNote: null,
    })
  })
})
