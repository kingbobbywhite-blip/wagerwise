import { describe, expect, it } from "vitest"
import {
  cleanPlayerName,
  normalizeProplineEvent,
  proplineEventOddsUrl,
  proplineEventsUrl,
  proplineMarkets,
  proplineQuota,
  proplineSportKey,
  pullPropline,
  type ProplineEventOdds,
} from "@/lib/odds-feed/propline"
import { feedKeyFor } from "@/lib/odds-feed/theoddsapi"

const event: ProplineEventOdds = {
  id: 4821,
  sport_key: "basketball_nba",
  commence_time: "2026-01-16T00:10:00Z",
  home_team: "Oklahoma City Thunder",
  away_team: "Minnesota Timberwolves",
  bookmakers: [
    {
      key: "betonlineag",
      title: "BetOnline",
      markets: [
        {
          key: "player_points",
          outcomes: [
            { name: "Over", description: "Anthony Edwards (MIN)", price: -115, point: 25.5 },
            { name: "Under", description: "Anthony Edwards (MIN)", price: -105, point: 25.5 },
          ],
        },
      ],
    },
    {
      key: "fanduel",
      title: "FanDuel",
      markets: [
        {
          key: "player_points",
          outcomes: [
            { name: "Over", description: "Anthony Edwards", price: -110, point: 25.5 },
            { name: "Under", description: "Anthony Edwards", price: -110, point: 25.5 },
          ],
        },
        {
          key: "player_rebounds",
          suspended_at: "2026-01-15T22:00:00Z",
          outcomes: [
            { name: "Over", description: "Rudy Gobert", price: -110, point: 11.5 },
            { name: "Under", description: "Rudy Gobert", price: -110, point: 11.5 },
          ],
        },
      ],
    },
    {
      key: "prophetx",
      title: "ProphetX",
      markets: [
        {
          key: "player_points",
          outcomes: [
            { name: "Over", description: "Anthony Edwards", price: 120, point: 25.5, liquidity: 4 },
            { name: "Under", description: "Anthony Edwards", price: -150, point: 25.5, liquidity: 300 },
          ],
        },
      ],
    },
    {
      key: "prizepicks",
      title: "PrizePicks",
      markets: [
        {
          key: "player_points",
          outcomes: [
            { name: "Over", description: "Anthony Edwards", price: 100, point: 24.5, dfs_odds_type: "standard" },
            { name: "Under", description: "Anthony Edwards", price: 100, point: 24.5, dfs_odds_type: "standard" },
          ],
        },
        {
          key: "player_points",
          description: "Points (demon 29.5)",
          outcomes: [{ name: "Over", description: "Anthony Edwards", price: 100, point: 29.5, dfs_odds_type: "demon" }],
        },
      ],
    },
    {
      key: "underdog",
      title: "Underdog",
      markets: [
        {
          key: "player_points",
          outcomes: [
            { name: "Higher", description: "Anthony Edwards", price: -120, point: 25.5, payout_multiplier: 1.0 },
            { name: "Lower", description: "Anthony Edwards", price: -105, point: 25.5, payout_multiplier: 0.85 },
          ],
        },
      ],
    },
  ],
}

describe("PropLine requests", () => {
  it("uses PropLine's own sport keys", () => {
    expect(proplineSportKey("nba")).toBe("basketball_nba")
    expect(proplineSportKey("wnba")).toBe("basketball_wnba")
    expect(proplineSportKey("nfl")).toBe("football_nfl")
    expect(proplineSportKey("nhl")).toBe("hockey_nhl")
  })

  it("keeps the key out of the URL", () => {
    const url = proplineEventOddsUrl(4821, { markets: ["player_points"], league: "nba" })
    expect(url).toBe("https://api.prop-line.com/v1/sports/basketball_nba/events/4821/odds?markets=player_points")
    expect(proplineEventsUrl("nhl")).toBe("https://api.prop-line.com/v1/sports/hockey_nhl/events")
  })

  it("translates the goalie saves key and drops duplicates", () => {
    expect(proplineMarkets(["player_shots_on_goal", "player_total_saves", "goalie_saves"])).toEqual([
      "player_shots_on_goal",
      "goalie_saves",
    ])
  })

  it("narrows to the requested books when asked", () => {
    const url = proplineEventOddsUrl("9", { markets: ["player_points"], bookmakers: ["prizepicks", "underdog"] })
    expect(url).toContain("bookmakers=prizepicks%2Cunderdog")
  })

  it("still answers The Odds API key for saves", () => {
    expect(feedKeyFor("SAVES")).toBe("player_total_saves")
  })

  it("reads the daily quota headers", () => {
    const h = new Headers({ "X-Daily-Limit": "1000", "X-Daily-Used": "13", "X-Daily-Remaining": "987" })
    expect(proplineQuota(h)).toEqual({ limit: 1000, used: 13, remaining: 987 })
    expect(proplineQuota(new Headers())).toBeNull()
  })
})

describe("cleanPlayerName", () => {
  it("strips a trailing team tag", () => {
    expect(cleanPlayerName("Tarik Skubal (DET)")).toBe("Tarik Skubal")
    expect(cleanPlayerName("Shai Gilgeous-Alexander")).toBe("Shai Gilgeous-Alexander")
    expect(cleanPlayerName(undefined)).toBe("")
  })
})

describe("normalizeProplineEvent", () => {
  const r = normalizeProplineEvent(event, "basketball")

  it("never lets a pick'em app into the prices", () => {
    const books = new Set(r.quotes.map((q) => q.book))
    expect(books.has("prizepicks")).toBe(false)
    expect(books.has("underdog")).toBe(false)
  })

  it("matches a team-tagged name to the same player as an untagged one", () => {
    const edwards = r.quotes.filter((q) => q.playerKey === "anthony edwards")
    expect(edwards.map((q) => q.book).sort()).toEqual(["betonlineag", "fanduel", "prophetx"])
  })

  it("drops a pulled market and says why", () => {
    expect(r.quotes.some((q) => q.player === "Rudy Gobert")).toBe(false)
    expect(r.dropped.some((d) => d.reason === "market pulled by the book")).toBe(true)
  })

  it("drops a thin exchange side and keeps the deep one", () => {
    const px = r.quotes.find((q) => q.book === "prophetx")!
    expect(px.overOdds).toBeNull()
    expect(px.underOdds).toBe(-150)
    expect(r.dropped.some((d) => d.reason === "exchange offer too thin to bet")).toBe(true)
  })

  it("keeps the event id as a string", () => {
    expect(r.quotes.every((q) => q.gameId === "Minnesota Timberwolves@Oklahoma City Thunder")).toBe(true)
  })

  it("reads PrizePicks standard and demon lines apart", () => {
    const pp = r.pickemLines.filter((l) => l.app === "prizepicks")
    const standard = pp.find((l) => l.pickType === "standard")!
    expect(standard.line).toBe(24.5)
    expect(standard.over).toEqual({ multiplier: null })
    expect(standard.under).toEqual({ multiplier: null })
    const demon = pp.find((l) => l.pickType === "demon")!
    expect(demon.line).toBe(29.5)
    expect(demon.under).toBeNull()
  })

  it("keeps Underdog's per-side multiplier and reads Higher and Lower", () => {
    const ud = r.pickemLines.find((l) => l.app === "underdog")!
    expect(ud.line).toBe(25.5)
    expect(ud.over).toEqual({ multiplier: null })
    expect(ud.under).toEqual({ multiplier: 0.85 })
    expect(ud.market).toBe("PTS")
  })

  it("drops every price from a book frozen on a live game", () => {
    const frozen = normalizeProplineEvent(
      { ...event, bookmakers: [{ ...event.bookmakers[1], pregame_only: true }] },
      "basketball",
    )
    expect(frozen.quotes).toHaveLength(0)
    expect(frozen.dropped[0].reason).toBe("book frozen on a live game")
  })

  it("treats a book carrying a pick type as a pick'em app even if unlisted", () => {
    const r2 = normalizeProplineEvent(
      {
        ...event,
        bookmakers: [
          {
            key: "newpickem",
            title: "New Pickem",
            markets: [
              {
                key: "player_points",
                outcomes: [{ name: "Over", description: "Anthony Edwards", price: 100, point: 24.5, dfs_odds_type: "standard" }],
              },
            ],
          },
        ],
      },
      "basketball",
    )
    expect(r2.quotes).toHaveLength(0)
    expect(r2.pickemLines).toHaveLength(1)
  })

  it("maps PropLine's goalie saves key in hockey", () => {
    const r3 = normalizeProplineEvent(
      {
        id: 1,
        commence_time: "2026-01-16T00:10:00Z",
        home_team: "Boston Bruins",
        away_team: "Toronto Maple Leafs",
        bookmakers: [
          {
            key: "fanduel",
            title: "FanDuel",
            markets: [
              {
                key: "goalie_saves",
                outcomes: [
                  { name: "Over", description: "Jeremy Swayman", price: -115, point: 27.5 },
                  { name: "Under", description: "Jeremy Swayman", price: -105, point: 27.5 },
                ],
              },
            ],
          },
        ],
      },
      "hockey",
    )
    expect(r3.quotes[0].market).toBe("SAVES")
  })
})

describe("pullPropline", () => {
  function json(body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } })
  }

  const listing = [
    { id: 1, commence_time: "2026-01-16T00:10:00Z", home_team: "Oklahoma City Thunder", away_team: "Minnesota Timberwolves" },
    { id: 2, commence_time: "2026-01-16T02:30:00Z", home_team: "Los Angeles Lakers", away_team: "Boston Celtics" },
    { id: 3, commence_time: "2026-01-18T00:10:00Z", home_team: "New York Knicks", away_team: "Miami Heat" },
  ]

  it("prices the games in the window, sends the key as a header, and reports the next game", async () => {
    const seen: { url: string; key: string | null }[] = []
    const fetcher = async (url: string, init?: RequestInit) => {
      seen.push({ url, key: new Headers(init?.headers).get("X-API-Key") })
      if (url.endsWith("/events")) return json(listing, { "X-Daily-Limit": "1000", "X-Daily-Used": "1", "X-Daily-Remaining": "999" })
      if (url.includes("/events/2/")) return new Response(JSON.stringify({ detail: "boom" }), { status: 500 })
      return json({ ...event, id: 1 }, { "X-Daily-Limit": "1000", "X-Daily-Used": "2", "X-Daily-Remaining": "998" })
    }
    const pull = await pullPropline({
      apiKey: "secret",
      league: "nba",
      fromMs: Date.parse("2026-01-15T05:00:00Z"),
      toMs: Date.parse("2026-01-16T11:00:00Z"),
      markets: ["player_points"],
      maxGames: 10,
      fetcher,
    })
    expect(pull.selected.map((e) => e.id)).toEqual(["1", "2"])
    expect(pull.payloads).toHaveLength(1)
    expect(pull.failures).toEqual([
      { eventId: "2", matchup: "Boston Celtics at Los Angeles Lakers", error: "PropLine returned 500. boom" },
    ])
    expect(pull.nextEvent?.id).toBe("3")
    expect(pull.quota?.remaining).toBe(998)
    expect(pull.requests).toBe(3)
    expect(seen.every((s) => s.key === "secret" && !s.url.includes("secret"))).toBe(true)
  })

  it("throws a readable error when the listing is refused", async () => {
    const fetcher = async () =>
      new Response(JSON.stringify({ detail: "Invalid API key", error_code: "invalid_api_key" }), { status: 401 })
    await expect(
      pullPropline({ apiKey: "bad", league: "nba", fromMs: 0, toMs: Date.now(), markets: [], maxGames: 1, fetcher }),
    ).rejects.toThrow("PropLine rejected the API key. Invalid API key")
  })

  it("makes no odds requests for an events-only call", async () => {
    let calls = 0
    const fetcher = async () => {
      calls++
      return json(listing)
    }
    const pull = await pullPropline({
      apiKey: "k",
      league: "nba",
      fromMs: Date.parse("2026-01-15T05:00:00Z"),
      toMs: Date.parse("2026-01-16T11:00:00Z"),
      markets: ["player_points"],
      maxGames: 10,
      eventsOnly: true,
      fetcher,
    })
    expect(calls).toBe(1)
    expect(pull.selected).toHaveLength(2)
  })
})
