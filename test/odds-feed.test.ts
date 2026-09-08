import { describe, expect, it } from "vitest"
import {
  attachQuotes,
  estimateCredits,
  eventOddsUrl,
  eventsUrl,
  FEED_MARKET_MAP,
  feedKeyFor,
  indexQuotes,
  normalizeEventOdds,
  normalizeMany,
} from "@/lib/odds-feed/theoddsapi"
import type { FeedEventOdds } from "@/lib/odds-feed/types"

const event: FeedEventOdds = {
  id: "evt1",
  commence_time: "2026-01-15T00:10:00Z",
  home_team: "Oklahoma City Thunder",
  away_team: "Minnesota Timberwolves",
  bookmakers: [
    {
      key: "pinnacle",
      title: "Pinnacle",
      last_update: "2026-01-14T22:00:00Z",
      markets: [
        {
          key: "player_points",
          last_update: "2026-01-14T22:01:00Z",
          outcomes: [
            { name: "Over", description: "Anthony Edwards", price: -112, point: 25.5 },
            { name: "Under", description: "Anthony Edwards", price: -108, point: 25.5 },
            { name: "Over", description: "Shai Gilgeous-Alexander", price: -110, point: 31.5 },
            { name: "Under", description: "Shai Gilgeous-Alexander", price: -110, point: 31.5 },
          ],
        },
        {
          key: "player_points_rebounds_assists",
          outcomes: [
            { name: "Over", description: "Shai Gilgeous-Alexander", price: -105, point: 40.5 },
            { name: "Under", description: "Shai Gilgeous-Alexander", price: -115, point: 40.5 },
          ],
        },
      ],
    },
    {
      key: "draftkings",
      title: "DraftKings",
      markets: [
        {
          key: "player_points",
          outcomes: [
            { name: "Over", description: "Anthony Edwards", price: -120, point: 25.5 },
            { name: "Under", description: "Anthony Edwards", price: 100, point: 25.5 },
          ],
        },
        { key: "player_double_double", outcomes: [{ name: "Yes", description: "Rudy Gobert", price: 150 }] },
      ],
    },
  ],
}

describe("market mapping", () => {
  it("maps the feed's player-prop markets onto our taxonomy", () => {
    expect(FEED_MARKET_MAP.player_points).toBe("PTS")
    expect(FEED_MARKET_MAP.player_threes).toBe("3PM")
    expect(FEED_MARKET_MAP.player_points_rebounds_assists).toBe("PRA")
  })
  it("reverses the lookup", () => {
    expect(feedKeyFor("PRA")).toBe("player_points_rebounds_assists")
    expect(feedKeyFor("MIN")).toBeNull()
  })
})

describe("normalizeEventOdds", () => {
  const r = normalizeEventOdds(event)

  it("pairs over and under into one quote per book, player and line", () => {
    const edwards = r.quotes.filter((q) => q.playerKey === "anthony edwards" && q.book === "pinnacle")
    expect(edwards).toHaveLength(1)
    expect(edwards[0].line).toBe(25.5)
    expect(edwards[0].overOdds).toBe(-112)
    expect(edwards[0].underOdds).toBe(-108)
    expect(edwards[0].market).toBe("PTS")
  })

  it("keeps books separate", () => {
    const edwards = r.quotes.filter((q) => q.playerKey === "anthony edwards")
    expect(new Set(edwards.map((q) => q.book))).toEqual(new Set(["pinnacle", "draftkings"]))
  })

  it("carries the last update through as the quote timestamp", () => {
    const q = r.quotes.find((x) => x.book === "pinnacle" && x.market === "PTS")!
    expect(q.fetchedAt).toBe("2026-01-14T22:01:00Z")
  })

  it("builds a stable game id", () => {
    expect(r.quotes[0].gameId).toBe("Minnesota Timberwolves@Oklahoma City Thunder")
  })

  it("reports markets it does not model instead of ignoring them", () => {
    expect(r.unknownMarkets).toContain("player_double_double")
  })

  it("handles a combo market", () => {
    const pra = r.quotes.find((q) => q.market === "PRA")!
    expect(pra.line).toBe(40.5)
    expect(pra.player).toBe("Shai Gilgeous-Alexander")
  })

  it("drops outcomes with missing fields and says why", () => {
    const broken: FeedEventOdds = {
      ...event,
      bookmakers: [
        {
          key: "pinnacle",
          title: "Pinnacle",
          markets: [
            {
              key: "player_points",
              outcomes: [
                { name: "Over", description: "", price: -110, point: 20.5 },
                { name: "Over", description: "A Player", price: -110 },
                { name: "Over", description: "B Player", price: Number.NaN, point: 20.5 },
                { name: "Yes", description: "C Player", price: -110, point: 20.5 },
              ],
            },
          ],
        },
      ],
    }
    const out = normalizeEventOdds(broken)
    expect(out.quotes).toHaveLength(0)
    expect(out.dropped.map((d) => d.reason)).toEqual([
      "no player on outcome",
      "no line on outcome",
      "no price on outcome",
      'unexpected outcome name "Yes"',
    ])
  })

  it("keeps a one-sided price rather than discarding it", () => {
    const oneSided: FeedEventOdds = {
      ...event,
      bookmakers: [
        {
          key: "pinnacle",
          title: "Pinnacle",
          markets: [{ key: "player_points", outcomes: [{ name: "Over", description: "A Player", price: -110, point: 20.5 }] }],
        },
      ],
    }
    const out = normalizeEventOdds(oneSided)
    expect(out.quotes).toHaveLength(1)
    expect(out.quotes[0].overOdds).toBe(-110)
    expect(out.quotes[0].underOdds).toBeNull()
  })

  it("survives an empty payload", () => {
    const empty = normalizeEventOdds({ ...event, bookmakers: [] })
    expect(empty.quotes).toHaveLength(0)
  })
})

describe("normalizeMany", () => {
  it("merges events and deduplicates unknown markets", () => {
    const r = normalizeMany([event, event])
    expect(r.quotes.length).toBe(normalizeEventOdds(event).quotes.length * 2)
    expect(r.unknownMarkets).toEqual(["player_double_double"])
  })
})

describe("indexQuotes and attachQuotes", () => {
  const index = indexQuotes(normalizeEventOdds(event).quotes)

  it("finds every book's quote for a player and market", () => {
    expect(index.get("Anthony Edwards", "PTS")).toHaveLength(2)
    expect(index.get("anthony edwards", "PTS")).toHaveLength(2)
  })

  it("returns nothing for a market the player has no price in", () => {
    expect(index.get("Anthony Edwards", "REB")).toHaveLength(0)
    expect(index.get("Anthony Edwards", null)).toHaveLength(0)
  })

  it("attaches quotes onto slate rows and reports what did not match", () => {
    const rows = [
      { player: "Anthony Edwards", marketKey: "PTS" as const, marketLabel: "Points" },
      { player: "Rudy Gobert", marketKey: "REB" as const, marketLabel: "Rebounds" },
    ]
    const r = attachQuotes(rows, index)
    expect(r.matched).toBe(1)
    expect(r.rows[0].quotes).toHaveLength(2)
    expect(r.rows[1].quotes).toHaveLength(0)
    expect(r.unmatched).toEqual([{ player: "Rudy Gobert", market: "Rebounds" }])
  })

  it("does not fuzzily match similar names", () => {
    // Attaching one Williams' price to another would be worse than no price.
    const r = attachQuotes([{ player: "Anthony Edward", marketKey: "PTS" as const }], index)
    expect(r.matched).toBe(0)
  })
})

describe("request builders", () => {
  it("builds an events url", () => {
    expect(eventsUrl("KEY")).toContain("/sports/basketball_nba/events?apiKey=KEY")
  })

  it("builds an event odds url with markets and bookmakers", () => {
    const u = eventOddsUrl("KEY", "evt1", { markets: ["player_points", "player_rebounds"], regions: "us", bookmakers: ["pinnacle"] })
    expect(u).toContain("/events/evt1/odds")
    expect(u).toContain("markets=player_points%2Cplayer_rebounds")
    expect(u).toContain("bookmakers=pinnacle")
    expect(u).toContain("oddsFormat=american")
  })

  it("escapes the api key", () => {
    expect(eventsUrl("a b&c")).toContain("apiKey=a%20b%26c")
  })

  it("estimates credit cost so a quota is not burned by accident", () => {
    expect(estimateCredits(12, 14)).toBe(168)
    expect(estimateCredits(12, 3)).toBe(36)
  })
})
