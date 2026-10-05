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

// Before the fixture's tip-off, so its pick'em lines are still open.
const BEFORE = { now: Date.parse("2026-01-15T18:00:00Z") }

describe("normalizeProplineEvent", () => {
  const r = normalizeProplineEvent(event, "basketball", BEFORE)

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
      BEFORE,
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
      BEFORE,
    )
    expect(r2.quotes).toHaveLength(0)
    expect(r2.pickemLines).toHaveLength(1)
  })

  it("closes every pick'em line once the game has started, and keeps the prices", () => {
    const live = normalizeProplineEvent(event, "basketball", { now: Date.parse("2026-01-16T01:00:00Z") })
    expect(live.pickemLines).toHaveLength(0)
    expect(live.quotes.length).toBe(r.quotes.length)
    expect(live.dropped.filter((d) => d.reason === "pick'em lines closed: the game has started")).toHaveLength(2)
  })

  it("drops a pick'em app frozen on a live game and a pick'em line the app pulled", () => {
    const pp = event.bookmakers[3]
    const frozen = normalizeProplineEvent({ ...event, bookmakers: [{ ...pp, pregame_only: true }] }, "basketball", BEFORE)
    expect(frozen.pickemLines).toHaveLength(0)
    const pulled = normalizeProplineEvent(
      { ...event, bookmakers: [{ ...pp, markets: [{ ...pp.markets[0], suspended_at: "2026-01-15T17:00:00Z" }, pp.markets[1]] }] },
      "basketball",
      BEFORE,
    )
    expect(pulled.pickemLines.map((l) => l.pickType)).toEqual(["demon"])
    expect(pulled.dropped.some((d) => d.reason === "pick'em line pulled by the app")).toBe(true)
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

import { pickemNoteFor } from "@/lib/odds-feed/propline"

describe("pickemNoteFor", () => {
  it("names a failed request before blaming the apps for not posting", () => {
    const limit = { error: "PropLine's daily request limit is used up." }
    expect(pickemNoteFor(0, [limit, limit])).toBe(
      "Pick'em lines for 2 games could not be read: PropLine's daily request limit is used up.",
    )
    expect(pickemNoteFor(12, [limit])).toContain("1 game could not be read")
  })

  it("says the apps have not posted only when every request succeeded", () => {
    expect(pickemNoteFor(0, [])).toContain("no pick'em lines for these games yet")
    expect(pickemNoteFor(5, [])).toBeNull()
  })
})

describe("pullPropline cap accounting", () => {
  const listing = [1, 2, 3, 4].map((id) => ({
    id,
    commence_time: `2026-01-16T0${id}:00:00Z`,
    home_team: `Home ${id}`,
    away_team: `Away ${id}`,
  }))
  const fetcher = async () => new Response(JSON.stringify(listing), { status: 200 })
  const window = { fromMs: Date.parse("2026-01-15T00:00:00Z"), toMs: Date.parse("2026-01-17T00:00:00Z") }

  it("counts only games asked for when an event list narrows the pull", async () => {
    const pull = await pullPropline({ apiKey: "k", league: "nba", ...window, markets: [], maxGames: 10, eventIds: ["2", "3"], eventsOnly: true, fetcher })
    expect(pull.selected.map((e) => e.id)).toEqual(["2", "3"])
    expect(pull.cappedOut).toBe(0)
  })

  it("counts the games the cap left out", async () => {
    const pull = await pullPropline({ apiKey: "k", league: "nba", ...window, markets: [], maxGames: 3, eventsOnly: true, fetcher })
    expect(pull.cappedOut).toBe(1)
  })
})

import { sameGame, teamNickname } from "@/lib/odds-feed/propline"

describe("matching games across feeds", () => {
  it("reads the nickname, which survives LA against Los Angeles", () => {
    expect(teamNickname("LA Clippers")).toBe(teamNickname("Los Angeles Clippers"))
    expect(teamNickname("Portland Trail Blazers")).toBe("blazers")
    expect(teamNickname("Philadelphia 76ers")).toBe(teamNickname("Philadelphia 76ers"))
  })

  const odds = { home_team: "Los Angeles Clippers", away_team: "Denver Nuggets", commence_time: "2026-01-16T03:30:00Z" }

  it("matches the same game and refuses a swapped home team or a later rematch", () => {
    expect(sameGame({ ...odds, home_team: "LA Clippers", commence_time: "2026-01-16T03:40:00Z" }, odds)).toBe(true)
    expect(sameGame({ ...odds, home_team: "Denver Nuggets", away_team: "LA Clippers" }, odds)).toBe(false)
    expect(sameGame({ ...odds, commence_time: "2026-01-18T03:30:00Z" }, odds)).toBe(false)
  })

  it("pulls exactly the games another feed priced, whatever the cap and window", async () => {
    const listing = [
      { id: 7, commence_time: "2026-01-16T03:40:00Z", home_team: "LA Clippers", away_team: "Denver Nuggets" },
      { id: 8, commence_time: "2026-01-16T00:10:00Z", home_team: "Boston Celtics", away_team: "New York Knicks" },
    ]
    const fetcher = async () => new Response(JSON.stringify(listing), { status: 200 })
    const pull = await pullPropline({
      apiKey: "k",
      league: "nba",
      fromMs: Date.parse("2026-01-16T04:00:00Z"),
      toMs: Date.parse("2026-01-16T05:00:00Z"),
      markets: [],
      maxGames: 1,
      games: [odds],
      eventsOnly: true,
      fetcher,
    })
    expect(pull.selected.map((e) => e.id)).toEqual(["7"])
  })
})

describe("games the apps answered for", () => {
  const GAME = "Minnesota Timberwolves@Oklahoma City Thunder"

  it("records the game for each app even when every line was closed because it started", () => {
    const live = normalizeProplineEvent(event, "basketball", { now: Date.parse("2026-01-16T01:00:00Z") })
    expect(live.pickemLines).toHaveLength(0)
    expect(live.pickemGames).toEqual([
      { app: "prizepicks", gameId: GAME },
      { app: "underdog", gameId: GAME },
    ])
    expect(live.startedGames).toEqual([GAME])
  })

  it("records the game when the app pulled every market, without calling it started", () => {
    const pp = event.bookmakers[3]
    const pulled = normalizeProplineEvent(
      { ...event, bookmakers: [{ ...pp, markets: pp.markets.map((m) => ({ ...m, suspended_at: "2026-01-15T17:00:00Z" })) }] },
      "basketball",
      BEFORE,
    )
    expect(pulled.pickemLines).toHaveLength(0)
    expect(pulled.pickemGames).toEqual([{ app: "prizepicks", gameId: GAME }])
    expect(pulled.startedGames).toEqual([])
  })

  it("records nothing for a game no app answered for", () => {
    const books = normalizeProplineEvent({ ...event, bookmakers: event.bookmakers.slice(0, 3) }, "basketball", BEFORE)
    expect(books.pickemGames).toEqual([])
    expect(books.startedGames).toEqual([])
  })

  it("counts a started game as started even when PropLine no longer lists the apps for it", () => {
    const live = normalizeProplineEvent({ ...event, bookmakers: event.bookmakers.slice(0, 3) }, "basketball", {
      now: Date.parse("2026-01-16T01:00:00Z"),
    })
    expect(live.pickemGames).toEqual([])
    expect(live.startedGames).toEqual([GAME])
  })
})

describe("pickemNoteFor over the priced slate", () => {
  it("says every game has started instead of telling the user to wait for lines", () => {
    const note = pickemNoteFor(0, [], { games: 3, started: 3 })!
    expect(note).toBe("Every game on this slate has started, and the pick'em apps stop taking picks at the start.")
  })

  it("counts started games against the whole slate, and only the rest as not posted", () => {
    const note = pickemNoteFor(0, [], { games: 3, started: 1 })!
    expect(note).toContain("1 of the 3 games has started")
    expect(note).toContain("no open pick'em lines for the other 2 games yet")
  })

  it("names games PropLine did not list, and never calls the slate fully started when it is not", () => {
    expect(pickemNoteFor(0, [], { games: 4, started: 0, unlisted: 4 })).toBe(
      "PropLine did not list 4 of the games still to start, so props there are at the books' line.",
    )
    // Three priced games: PropLine lists two, both under way, and not a third still to start.
    const mixed = pickemNoteFor(0, [], { games: 3, started: 2, unlisted: 1 })!
    expect(mixed).toContain("did not list 1 of the games still to start")
    expect(mixed).toContain("2 of the 3 games have started")
    expect(mixed).not.toContain("Every game")
    expect(mixed).not.toContain("no open pick'em lines")
  })

  it("keeps the unlisted count when a request also failed", () => {
    const note = pickemNoteFor(0, [{ error: "limit" }], { games: 3, started: 0, unlisted: 1 })!
    expect(note.startsWith("Pick'em lines for 1 game could not be read: limit")).toBe(true)
    expect(note).toContain("did not list 1 of the games still to start")
  })

  it("says nothing more when lines arrived for a slate that is still to start", () => {
    expect(pickemNoteFor(8, [], { games: 3, started: 0, unlisted: 0 })).toBeNull()
  })

  it("allows that a missing line may have been pulled, not only not posted yet", () => {
    expect(pickemNoteFor(0, [], { games: 2, started: 0 })).toContain("pull a line when news breaks")
  })
})

import { pickemSlate } from "@/lib/odds-feed/propline"

describe("pickemSlate", () => {
  const NOW = Date.parse("2026-01-16T01:00:00Z")
  const game = (away: string, home: string, commence_time: string) => ({ away_team: away, home_team: home, commence_time })
  const minOkc = game("Minnesota Timberwolves", "Oklahoma City Thunder", "2026-01-16T00:10:00Z")
  const denLac = game("Denver Nuggets", "Los Angeles Clippers", "2026-01-16T03:00:00Z")
  const bosNyk = game("Boston Celtics", "New York Knicks", "2026-01-16T06:00:00Z")

  it("counts a started game as started even when PropLine no longer lists it", () => {
    expect(pickemSlate([minOkc, denLac], [denLac], [], NOW)).toEqual({ games: 2, started: 1, unlisted: 0 })
  })

  it("counts a game PropLine says has started, though the pricing feed lists a later start", () => {
    const later = { ...minOkc, commence_time: "2026-01-16T01:30:00Z" }
    const listed = { ...minOkc, home_team: "OKC Thunder" }
    expect(pickemSlate([later], [listed], ["Minnesota Timberwolves@OKC Thunder"], NOW)).toEqual({
      games: 1,
      started: 1,
      unlisted: 0,
    })
  })

  it("counts only games still to start as unlisted", () => {
    expect(pickemSlate([minOkc, denLac, bosNyk], [minOkc], [], NOW)).toEqual({ games: 3, started: 1, unlisted: 2 })
  })
})

import { normalizeProplineMany } from "@/lib/odds-feed/propline"
import { buildDfsTargets as targetsFor, buildPickemEntry as entryFor } from "@/lib/today/build"
import { DEFAULT_VALUE_SETTINGS } from "@/lib/quant/valuebets"
import { DEFAULT_CORRELATION } from "@/lib/quant/correlation"
import { DEFAULT_CONSTRAINTS } from "@/lib/quant/optimizer"

describe("a closed or pulled game never comes back into the entry at the books' line", () => {
  // Two games: MIN@OKC tips at 00:10Z, DEN@LAC at 03:00Z. The books make
  // Edwards' over a strong favourite; PrizePicks posts both players.
  const side = (player: string, point: number, over: number, under: number) => [
    { name: "Over", description: player, price: over, point },
    { name: "Under", description: player, price: under, point },
  ]
  const books = (player: string, point: number) => [
    { key: "pinnacle", title: "Pinnacle", markets: [{ key: "player_points", outcomes: side(player, point, -220, 175) }] },
    { key: "betonlineag", title: "BetOnline", markets: [{ key: "player_points", outcomes: side(player, point, -230, 180) }] },
  ]
  const prizepicks = (player: string, point: number, extra: { suspended_at?: string } = {}) => ({
    key: "prizepicks",
    title: "PrizePicks",
    markets: [
      {
        key: "player_points",
        ...extra,
        outcomes: [
          { name: "Over", description: player, price: 100, point, dfs_odds_type: "standard" as const },
          { name: "Under", description: player, price: 100, point, dfs_odds_type: "standard" as const },
        ],
      },
    ],
  })
  const minOkc = (pp: object): ProplineEventOdds => ({
    id: 1,
    sport_key: "basketball_nba",
    commence_time: "2026-01-16T00:10:00Z",
    home_team: "Oklahoma City Thunder",
    away_team: "Minnesota Timberwolves",
    bookmakers: [...books("Anthony Edwards", 31.5), pp as ProplineEventOdds["bookmakers"][number]],
  })
  const denLac: ProplineEventOdds = {
    id: 2,
    sport_key: "basketball_nba",
    commence_time: "2026-01-16T03:00:00Z",
    home_team: "LA Clippers",
    away_team: "Denver Nuggets",
    bookmakers: [
      { key: "pinnacle", title: "Pinnacle", markets: [{ key: "player_points", outcomes: side("Nikola Jokic", 27.5, -200, 165) }] },
      { key: "betonlineag", title: "BetOnline", markets: [{ key: "player_points", outcomes: side("Nikola Jokic", 27.5, -205, 170) }] },
      prizepicks("Nikola Jokic", 27.5),
    ],
  }
  const entryAt = (events: ProplineEventOdds[], now: number) => {
    const n = normalizeProplineMany(events, "basketball", { now })
    const targets = targetsFor(n.quotes, {
      value: DEFAULT_VALUE_SETTINGS,
      correlation: DEFAULT_CORRELATION,
      constraints: DEFAULT_CONSTRAINTS,
      dfsBreakEven: 0.562,
      pickemLines: n.pickemLines,
      pickemGames: n.pickemGames,
      now,
    })
    return { targets, entry: entryFor(targets, 1, 0.562, 2, "prizepicks", now) }
  }

  it("leaves out a game that has started, though its live prices still price the slate", () => {
    const { targets, entry } = entryAt([minOkc(prizepicks("Anthony Edwards", 25.5)), denLac], Date.parse("2026-01-16T01:00:00Z"))
    const edwards = targets.find((t) => t.player === "Anthony Edwards")!
    expect(edwards.appCoverage).toEqual(["prizepicks"])
    expect(entry!.map((l) => [l.target.player, l.source])).toEqual([["Nikola Jokic", "app"]])
  })

  it("leaves out a game whose every market the app pulled before the start", () => {
    const { targets, entry } = entryAt(
      [minOkc(prizepicks("Anthony Edwards", 31.5, { suspended_at: "2026-01-15T23:00:00Z" })), denLac],
      Date.parse("2026-01-15T23:30:00Z"),
    )
    expect(targets.find((t) => t.player === "Anthony Edwards")!.appCoverage).toEqual(["prizepicks"])
    expect(entry!.map((l) => [l.target.player, l.source])).toEqual([["Nikola Jokic", "app"]])
  })

  it("still plays the game at the app's line when nothing was closed", () => {
    const { entry } = entryAt([minOkc(prizepicks("Anthony Edwards", 31.5)), denLac], Date.parse("2026-01-15T23:30:00Z"))
    expect(entry!.map((l) => [l.target.player, l.line, l.source])).toEqual([["Anthony Edwards", 31.5, "app"]])
  })
})
