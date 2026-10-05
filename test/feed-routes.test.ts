import { afterEach, describe, expect, it, vi } from "vitest"
import { feedErrorText, headerCount, noneCouldBePriced, notStarted, oddsApiErrorText } from "@/lib/odds-feed/http"
import { pullPropline } from "@/lib/odds-feed/propline"
import { upcomingQuotes } from "@/lib/today/build"

const HOUR = 3600 * 1000
const iso = (ms: number) => new Date(ms).toISOString()

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })
}

const QUOTA = { "x-requests-remaining": "400", "x-requests-used": "100" }

/** An odds payload with one player and two books, enough to normalise into quotes. */
function oddsFor(e: { id: string; commence_time: string; home_team: string; away_team: string }) {
  const book = (key: string) => ({
    key,
    title: key,
    last_update: e.commence_time,
    markets: [
      {
        key: "player_points",
        outcomes: [
          { name: "Over", description: "Some Player", price: -110, point: 20.5 },
          { name: "Under", description: "Some Player", price: -110, point: 20.5 },
        ],
      },
    ],
  })
  return { ...e, sport_key: "basketball_nba", bookmakers: [book("pinnacle"), book("fanduel")] }
}

function stubOddsApi(events: { id: string; commence_time: string }[], odds: (id: string) => Response) {
  const listing = events.map((e) => ({ ...e, sport_key: "basketball_nba", home_team: `H${e.id}`, away_team: `A${e.id}` }))
  const urls: string[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url)
      const m = url.match(/\/events\/([^/]+)\/odds/)
      if (m) return odds(m[1])
      return json(listing, 200, QUOTA)
    }),
  )
  return {
    urls,
    oddsCalls: () => urls.filter((u) => u.includes("/odds?")).map((u) => u.match(/\/events\/([^/]+)\//)![1]),
    listing,
  }
}

const today = async (body: object) => {
  const { POST } = await import("@/app/api/today/route")
  return POST(new Request("http://t/api/today", { method: "POST", body: JSON.stringify({ apiKey: "k", ...body }) }))
}

const odds = async (body: object) => {
  const { POST } = await import("@/app/api/odds/route")
  return POST(new Request("http://t/api/odds", { method: "POST", body: JSON.stringify({ apiKey: "k", ...body }) }))
}

describe("feed request helpers", () => {
  it("reads an absent quota header as unknown, not as zero left", () => {
    expect(headerCount(new Headers(), "x-requests-remaining")).toBeNull()
    expect(headerCount(new Headers({ "x-requests-remaining": "" }), "x-requests-remaining")).toBeNull()
    expect(headerCount(new Headers({ "x-requests-remaining": "0" }), "x-requests-remaining")).toBe(0)
    expect(headerCount(new Headers({ "x-requests-remaining": "412" }), "x-requests-remaining")).toBe(412)
  })

  it("names an exhausted Odds API quota rather than echoing the raw body", async () => {
    const quota = json({ message: "Usage quota has been reached.", error_code: "OUT_OF_USAGE_CREDITS" }, 401)
    expect(await oddsApiErrorText(quota)).toBe("The Odds API quota is used up for this period. Usage quota has been reached.")
    const badKey = json({ message: "API key is not valid.", error_code: "INVALID_KEY" }, 401)
    expect(await oddsApiErrorText(badKey)).toBe("The Odds API rejected the API key. API key is not valid.")
    expect(await oddsApiErrorText(new Response("Bad gateway", { status: 503 }))).toBe("The Odds API returned 503. Bad gateway")
  })

  it("says the feed could not be reached instead of 'fetch failed'", () => {
    expect(feedErrorText(new TypeError("fetch failed"), "The Odds API")).toBe(
      "Could not reach The Odds API. Check the internet connection and try again.",
    )
    expect(feedErrorText(new SyntaxError("Unexpected token '<'"), "PropLine")).toBe(
      "PropLine sent a response this app could not read. Try again in a minute.",
    )
    expect(feedErrorText(new Error("PropLine rejected the API key."), "PropLine")).toBe("PropLine rejected the API key.")
  })

  it("treats a game as started once its start time has passed, and keeps an unreadable one", () => {
    const now = Date.parse("2026-10-20T23:00:00Z")
    expect(notStarted("2026-10-20T23:30:00Z", now)).toBe(true)
    expect(notStarted("2026-10-20T23:00:00Z", now)).toBe(false)
    expect(notStarted("2026-10-20T22:00:00Z", now)).toBe(false)
    expect(notStarted(null, now)).toBe(true)
    expect(notStarted("not a date", now)).toBe(true)
  })

  it("calls a pull a failure only when it priced nothing and something failed", () => {
    const failures = [{ error: "The Odds API quota is used up for this period." }]
    expect(noneCouldBePriced(2, 0, [...failures, ...failures])).toBe(
      "None of the 2 games could be priced. The Odds API quota is used up for this period.",
    )
    expect(noneCouldBePriced(2, 1, failures)).toBeNull()
    expect(noneCouldBePriced(0, 0, [])).toBeNull()
    expect(noneCouldBePriced(1, 0, [])).toBeNull()
  })

  it("drops quotes from games that have started since the pull", () => {
    const now = Date.parse("2026-10-20T23:00:00Z")
    const quotes = [
      { gameId: "early", commenceTime: "2026-10-20T22:00:00Z" },
      { gameId: "late", commenceTime: "2026-10-21T01:00:00Z" },
      { gameId: "unknown" },
    ]
    expect(upcomingQuotes(quotes, now).map((q) => q.gameId)).toEqual(["late", "unknown"])
  })
})

describe("/api/today", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("skips games already under way before the cap, so they cost nothing and are never picked", async () => {
    // The window opens at the caller's midnight, which in the evening holds
    // games that tipped hours ago. Those used to be priced at live lines, take
    // cap slots ahead of later games, and land in the pick'em entry.
    const now = Date.now()
    const feed = stubOddsApi(
      [
        { id: "live", commence_time: iso(now - 1.5 * HOUR) },
        { id: "later", commence_time: iso(now + 3 * HOUR) },
      ],
      (id) => json(oddsFor({ ...feed.listing.find((e) => e.id === id)! }), 200, QUOTA),
    )
    const res = await today({ league: "nba", markets: ["player_points"], from: iso(now - 12 * HOUR), to: iso(now + 12 * HOUR), maxGames: 1 })
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(feed.oddsCalls()).toEqual(["later"])
    expect(data.events.map((e: { id: string }) => e.id)).toEqual(["later"])
    expect(data.startedCount).toBe(1)
    expect(data.cappedOut).toBe(0)
    expect(new Set(data.quotes.map((q: { gameId: string }) => q.gameId)).size).toBe(1)
  })

  it("says every game has started rather than that there are none today", async () => {
    const now = Date.now()
    const feed = stubOddsApi([{ id: "live", commence_time: iso(now - HOUR) }], () => json({}, 500))
    const data = await (await today({ league: "nba", from: iso(now - 12 * HOUR), to: iso(now + 12 * HOUR) })).json()
    expect(feed.oddsCalls()).toEqual([])
    expect(data.quotes).toEqual([])
    expect(data.startedCount).toBe(1)
    expect(data.note).toContain("already started")
  })

  it("answers an error naming the quota when every game fails, so the last good pull is kept", async () => {
    // A 200 with no quotes read as "no props posted yet" and replaced the
    // cached pull, whose prices cannot be re-pulled once the quota is gone.
    const now = Date.now()
    stubOddsApi(
      [
        { id: "a", commence_time: iso(now + HOUR) },
        { id: "b", commence_time: iso(now + 2 * HOUR) },
      ],
      () => json({ message: "Usage quota has been reached.", error_code: "OUT_OF_USAGE_CREDITS" }, 401),
    )
    const res = await today({ league: "nba", from: iso(now), to: iso(now + 12 * HOUR) })
    const data = await res.json()
    expect(res.status).toBe(502)
    expect(data.error).toBe(
      "None of the 2 games could be priced. The Odds API quota is used up for this period. Usage quota has been reached.",
    )
    expect(data.quotes).toBeUndefined()
  })

  it("still answers with the games that priced when only some fail", async () => {
    const now = Date.now()
    const feed = stubOddsApi(
      [
        { id: "a", commence_time: iso(now + HOUR) },
        { id: "b", commence_time: iso(now + 2 * HOUR) },
      ],
      (id) => (id === "a" ? json(oddsFor(feed.listing[0]), 200, QUOTA) : json({ message: "nope" }, 500)),
    )
    const res = await today({ league: "nba", from: iso(now), to: iso(now + 12 * HOUR) })
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.quotes.length).toBeGreaterThan(0)
    expect(data.failures).toEqual([{ eventId: "b", matchup: "Ab at Hb", error: "The Odds API returned 500. nope" }])
  })

  it("reports an unknown quota when the feed sends no quota headers", async () => {
    const now = Date.now()
    const listing = [{ id: "a", commence_time: iso(now + HOUR), home_team: "H", away_team: "A", sport_key: "basketball_nba" }]
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url.includes("/odds?") ? json(oddsFor(listing[0])) : json(listing))),
    )
    const data = await (await today({ league: "nba", from: iso(now), to: iso(now + 12 * HOUR) })).json()
    expect(data.requestsRemaining).toBeNull()
    expect(data.requestsUsed).toBeNull()
  })

  it("says the feed could not be reached when the network is down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed")
      }),
    )
    const res = await today({ league: "nba" })
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe("Could not reach The Odds API. Check the internet connection and try again.")
  })
})

describe("/api/odds", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("answers an error when every game fails, so Capture keeps the prices it already attached", async () => {
    const now = Date.now()
    stubOddsApi([{ id: "a", commence_time: iso(now + HOUR) }], () =>
      json({ message: "Usage quota has been reached.", error_code: "OUT_OF_USAGE_CREDITS" }, 401),
    )
    const res = await odds({ league: "nba", markets: ["player_points"], from: iso(now), to: iso(now + 12 * HOUR) })
    expect(res.status).toBe(502)
    expect((await res.json()).error).toContain("quota is used up")
  })

  it("skips games already under way", async () => {
    const now = Date.now()
    const feed = stubOddsApi(
      [
        { id: "live", commence_time: iso(now - HOUR) },
        { id: "later", commence_time: iso(now + HOUR) },
      ],
      (id) => json(oddsFor(feed.listing.find((e) => e.id === id)!), 200, QUOTA),
    )
    const data = await (await odds({ league: "nba", markets: ["player_points"], from: iso(now - 12 * HOUR), to: iso(now + 12 * HOUR) })).json()
    expect(feed.oddsCalls()).toEqual(["later"])
    expect(data.startedCount).toBe(1)
  })
})

describe("pullPropline with a clock", () => {
  it("leaves out games that have started and counts them", async () => {
    const now = Date.parse("2026-01-16T01:00:00Z")
    const listing = [
      { id: 1, commence_time: "2026-01-16T00:10:00Z", home_team: "Oklahoma City Thunder", away_team: "Minnesota Timberwolves" },
      { id: 2, commence_time: "2026-01-16T02:30:00Z", home_team: "Los Angeles Lakers", away_team: "Boston Celtics" },
    ]
    const asked: string[] = []
    const fetcher = async (url: string) => {
      asked.push(url)
      return url.endsWith("/events") ? json(listing) : json({ ...listing[1], bookmakers: [] })
    }
    const pull = await pullPropline({
      apiKey: "k",
      league: "nba",
      fromMs: Date.parse("2026-01-15T05:00:00Z"),
      toMs: Date.parse("2026-01-16T11:00:00Z"),
      markets: ["player_points"],
      maxGames: 1,
      now,
      fetcher,
    })
    expect(pull.selected.map((e) => e.id)).toEqual(["2"])
    expect(pull.started).toBe(1)
    expect(pull.cappedOut).toBe(0)
    expect(asked.filter((u) => !u.endsWith("/events"))).toHaveLength(1)
  })
})
