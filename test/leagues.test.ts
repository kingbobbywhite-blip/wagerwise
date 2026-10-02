import { describe, it, expect } from "vitest"
import {
  DEFAULT_LEAGUE,
  LEAGUES,
  type LeagueId,
  LEAGUE_IDS,
  creditWarning,
  inSeason,
  isLeagueId,
  leagueFor,
  scaleMean,
  sportKeyFor,
} from "@/lib/leagues"
import { eventOddsUrl, eventsUrl } from "@/lib/odds-feed/theoddsapi"
import { projectProp } from "@/lib/quant/projection"
import { DEFAULT_PROJECTION_SETTINGS } from "@/lib/quant/projection"
import { migrate } from "@/lib/store/schema"
import { resolveLine } from "@/lib/quant/distributions"

describe("league config", () => {
  it("covers the NBA, the WNBA, the NFL and the NHL with distinct sport keys", () => {
    expect(LEAGUE_IDS).toEqual(["nba", "wnba", "nfl", "nhl"])
    const keys = LEAGUE_IDS.map((id) => LEAGUES[id].sportKey)
    expect(new Set(keys).size).toBe(4)
    expect(sportKeyFor("nhl")).toBe("icehockey_nhl")
    expect(LEAGUES.nhl.sport).toBe("hockey")
    expect(sportKeyFor("nba")).toBe("basketball_nba")
    expect(sportKeyFor("wnba")).toBe("basketball_wnba")
    expect(sportKeyFor("nfl")).toBe("americanfootball_nfl")
    expect(LEAGUES.nfl.sport).toBe("football")
    expect(LEAGUES.nba.sport).toBe("basketball")
  })

  it("no longer supports college basketball, and falls back rather than guessing", () => {
    expect(isLeagueId("ncaab")).toBe(false)
    expect(sportKeyFor("ncaab")).toBeNull()
    // leagueFor is the forgiving one, used where a fallback beats a crash.
    expect(leagueFor("ncaab").id).toBe(DEFAULT_LEAGUE)
  })

  it("scales basketball priors down for the shorter WNBA game and leaves the NFL alone", () => {
    // 40-minute games at lower pace must project fewer points than 48-minute
    // games, or every unpriced WNBA prop reads as a screaming over.
    expect(scaleMean("wnba", 20)).toBeLessThan(scaleMean("nba", 20))
    // NFL markets carry their own typical means; nothing is scaled across.
    expect(scaleMean("nfl", 235)).toBe(235)
    expect(LEAGUES.nfl.dispersionScale).toBe(1)
  })

  it("treats the WNBA as at least as volatile as the NBA", () => {
    expect(LEAGUES.wnba.dispersionScale).toBeGreaterThanOrEqual(LEAGUES.nba.dispersionScale)
  })

  it("pulls NFL markets by default for the NFL, never basketball ones", () => {
    expect(LEAGUES.nfl.markets.length).toBeGreaterThan(0)
    for (const m of LEAGUES.nfl.markets) expect(m).toMatch(/^player_(pass|rush|reception)/)
  })

  it("caps plausible output by league", () => {
    // A 55-point WNBA night would be an all-time record; a 55-point NBA night
    // happens most seasons. The warning threshold has to know the difference.
    expect(LEAGUES.wnba.caps.PTS!).toBeLessThan(LEAGUES.nba.caps.PTS!)
  })
})

describe("season awareness", () => {
  it("knows the WNBA does not play in January", () => {
    expect(inSeason("wnba", new Date("2026-01-15T00:00:00Z"))).toBe(false)
    expect(inSeason("wnba", new Date("2026-07-15T00:00:00Z"))).toBe(true)
  })

  it("knows the NFL does not play in July but does in October and January", () => {
    expect(inSeason("nfl", new Date("2026-07-15T00:00:00Z"))).toBe(false)
    expect(inSeason("nfl", new Date("2026-10-15T00:00:00Z"))).toBe(true)
    expect(inSeason("nfl", new Date("2027-01-15T00:00:00Z"))).toBe(true)
  })
})

describe("credit warning", () => {
  it("shouts before an NFL pull with every market empties a monthly quota", () => {
    // 14 games x 10 markets = 140 credits, over a quarter of a 500-request month.
    const w = creditWarning("nfl", 14, 10)
    expect(w.credits).toBe(140)
    expect(w.severe).toBe(true)
    expect(w.message).toContain("NFL")
  })

  it("mentions but does not shout about a default full NFL Sunday", () => {
    const w = creditWarning("nfl", LEAGUES.nfl.maxGames, LEAGUES.nfl.markets.length)
    expect(w.credits).toBe(56)
    expect(w.severe).toBe(false)
    expect(w.message).toContain("56")
  })

  it("stays quiet about an ordinary NBA pull", () => {
    const w = creditWarning("nba", 8, 4)
    expect(w.credits).toBe(32)
    expect(w.severe).toBe(false)
    expect(w.message).toBeNull()
  })

  it("reports nothing for an empty slate", () => {
    expect(creditWarning("nba", 0, 4).message).toBeNull()
  })
})

describe("feed urls", () => {
  it("targets the right sport per league", () => {
    expect(eventsUrl("KEY", "wnba")).toContain("/sports/basketball_wnba/events")
    expect(eventsUrl("KEY", "nfl")).toContain("/sports/americanfootball_nfl/events")
    // Default stays the NBA so existing callers are unaffected.
    expect(eventsUrl("KEY")).toContain("/sports/basketball_nba/events")
  })

  it("targets the right sport on the odds endpoint too", () => {
    const url = eventOddsUrl("KEY", "evt1", { markets: ["player_points"], regions: "us", league: "wnba" })
    expect(url).toContain("/sports/basketball_wnba/events/evt1/odds")
    expect(url).toContain("markets=player_points")
  })
})

describe("league-aware pricing", () => {
  const row = {
    player: "Test Player",
    market: "Points",
    line: 18.5,
    overOdds: -110,
    underOdds: -110,
  }

  it("widens the distribution for the WNBA", () => {
    const nba = projectProp(row, { ...DEFAULT_PROJECTION_SETTINGS, league: "nba" })
    const wnba = projectProp(row, { ...DEFAULT_PROJECTION_SETTINGS, league: "wnba" })
    expect(nba).not.toBeNull()
    expect(wnba).not.toBeNull()
    // Same line, same price, same implied mean, but a WNBA projection is a
    // little less knowable, so the spread must be wider.
    expect(wnba!.sd).toBeGreaterThan(nba!.sd)
  })

  it("leaves the probability at the priced line to the market, not the league", () => {
    // This is the property that matters most. When a book has priced the prop,
    // the devigged price IS the probability; the league prior must not move it.
    // A league that nudged a priced number would be inventing an edge.
    const priced = { ...row, overOdds: -200, underOdds: 160 }
    const nba = projectProp(priced, { ...DEFAULT_PROJECTION_SETTINGS, league: "nba" })!
    const wnba = projectProp(priced, { ...DEFAULT_PROJECTION_SETTINGS, league: "wnba" })!
    expect(Math.abs(wnba.pWin - nba.pWin)).toBeLessThan(0.005)
  })

  it("pulls probabilities toward a coin flip away from the priced line", () => {
    // Off the priced line — which is exactly where a pick'em target sits — a
    // wider distribution must be less confident. This is where the league
    // volatility prior earns its keep.
    const priced = { ...row, overOdds: -200, underOdds: 160 }
    const nba = projectProp(priced, { ...DEFAULT_PROJECTION_SETTINGS, league: "nba" })!
    const wnba = projectProp(priced, { ...DEFAULT_PROJECTION_SETTINGS, league: "wnba" })!
    const target = 22.5
    const nbaOver = resolveLine(nba.distribution, target).over
    const wnbaOver = resolveLine(wnba.distribution, target).over
    expect(Math.abs(wnbaOver - 0.5)).toBeLessThan(Math.abs(nbaOver - 0.5))
  })

  it("names the league in an implausible-projection warning", () => {
    const huge = { player: "X", market: "Points", line: 48.5, overOdds: -110, underOdds: -110 }
    const p = projectProp(huge, { ...DEFAULT_PROJECTION_SETTINGS, league: "wnba" })!
    const warning = p.warnings.find((w) => w.includes("plausible"))
    expect(warning).toBeDefined()
    expect(warning).toContain("WNBA")
  })
})

describe("store migration", () => {
  it("keeps a pre-league NBA cache instead of discarding a paid-for slate", () => {
    const legacy = {
      version: 1,
      settings: {},
      slate: null,
      slips: [],
      daily: { fetchedAt: "2026-01-01T00:00:00Z", quotes: [{ book: "pinnacle" }], events: [], requestsRemaining: 400, creditsSpent: 44 },
    }
    const migrated = migrate(legacy)
    expect(migrated.daily.nba).toBeDefined()
    expect(migrated.daily.nba!.league).toBe("nba")
    expect(migrated.daily.nba!.quotes).toHaveLength(1)
  })

  it("keeps per-league caches and drops junk keys", () => {
    const stored = {
      version: 1,
      settings: { daily: { league: "wnba" } },
      slate: null,
      slips: [],
      daily: {
        nba: { fetchedAt: "x", quotes: [], events: [], requestsRemaining: null, creditsSpent: 0 },
        wnba: { fetchedAt: "y", quotes: [], events: [], requestsRemaining: null, creditsSpent: 0 },
        nfl: { fetchedAt: "z", quotes: [], events: [], requestsRemaining: null, creditsSpent: 0 },
        ncaab: { fetchedAt: "w", quotes: [], events: [] },
        mlb: { fetchedAt: "v", quotes: [], events: [] },
      },
    }
    const migrated = migrate(stored)
    expect(Object.keys(migrated.daily).sort()).toEqual(["nba", "nfl", "wnba"])
    expect(migrated.settings.daily.league).toBe("wnba")
  })

  it("moves someone who had college basketball selected back to the NBA", () => {
    // College basketball was removed. A phone that still has it stored must
    // open on a working league, not a blank or broken one.
    const migrated = migrate({
      version: 1,
      settings: { daily: { league: "ncaab" }, projection: { league: "ncaab" } },
      slate: { id: "s", createdAt: "x", league: "ncaab", props: [] },
      daily: { ncaab: { fetchedAt: "w", quotes: [], events: [] } },
    })
    expect(migrated.settings.daily.league).toBe("nba")
    expect(migrated.settings.projection.league).toBe("nba")
    expect(migrated.slate?.league).toBeUndefined()
    expect(migrated.daily).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// End-to-end: a WNBA and an NFL slate through the whole daily pipeline.
//
// The feed cannot be reached from CI, so these use fixtures shaped like a real
// response. They prove the pipeline is genuinely league-agnostic: the same
// engine that prices an NBA slate prices a WNBA one at WNBA numbers, and an
// NFL one at NFL numbers with its own markets and spreads.
// ---------------------------------------------------------------------------

import { buildDailyPicks } from "@/lib/today/build"
import { DEFAULT_VALUE_SETTINGS, type FeedQuote } from "@/lib/quant/valuebets"
import { DEFAULT_CORRELATION } from "@/lib/quant/correlation"
import { DEFAULT_CONSTRAINTS } from "@/lib/quant/optimizer"

function quote(
  player: string,
  market: FeedQuote["market"],
  book: string,
  line: number,
  over: number | null,
  under: number | null,
  gameId: string,
): FeedQuote {
  return {
    book, line, overOdds: over, underOdds: under, fetchedAt: null,
    player, market, gameId,
    homeTeam: gameId.split("@")[1], awayTeam: gameId.split("@")[0],
    commenceTime: "2026-02-16T00:10:00Z",
  }
}

function optsFor(league: LeagueId) {
  return {
    value: { ...DEFAULT_VALUE_SETTINGS, projection: { ...DEFAULT_PROJECTION_SETTINGS, league } },
    correlation: DEFAULT_CORRELATION,
    constraints: { ...DEFAULT_CONSTRAINTS, picks: 2, maxPerGame: 2, maxPerTeam: 2 },
    dfsBreakEven: 0.577,
    now: Date.parse("2026-02-15T18:00:00Z"),
  }
}

/** A WNBA slate at WNBA-sized lines: ~20 point scorers, not ~30. */
const WNBA_QUOTES: FeedQuote[] = [
  quote("Arike Ogunbowale", "PTS", "pinnacle", 21.5, -108, -112, "DAL@LVA"),
  quote("Arike Ogunbowale", "PTS", "draftkings", 21.5, 120, -140, "DAL@LVA"),
  quote("Arike Ogunbowale", "PTS", "fanduel", 21.5, -105, -115, "DAL@LVA"),
  quote("Aja Wilson", "PTS", "pinnacle", 24.5, -110, -110, "DAL@LVA"),
  quote("Aja Wilson", "PTS", "draftkings", 24.5, -102, -118, "DAL@LVA"),
  quote("Aja Wilson", "PTS", "fanduel", 24.5, -108, -112, "DAL@LVA"),
  quote("Breanna Stewart", "REB", "pinnacle", 8.5, -115, -105, "NYL@SEA"),
  quote("Breanna Stewart", "REB", "draftkings", 8.5, 105, -125, "NYL@SEA"),
  quote("Breanna Stewart", "REB", "fanduel", 8.5, -112, -108, "NYL@SEA"),
]

/** An NFL slate at NFL-sized lines, Pinnacle plus two retail books. */
const NFL_QUOTES: FeedQuote[] = [
  quote("Josh Allen", "PASS_YDS", "pinnacle", 245.5, -112, -108, "BUF@KC"),
  quote("Josh Allen", "PASS_YDS", "draftkings", 244.5, -110, -110, "BUF@KC"),
  quote("Josh Allen", "PASS_YDS", "fanduel", 245.5, 105, -125, "BUF@KC"),
  quote("Isiah Pacheco", "RUSH_YDS", "pinnacle", 62.5, -110, -110, "BUF@KC"),
  quote("Isiah Pacheco", "RUSH_YDS", "draftkings", 62.5, -115, -105, "BUF@KC"),
  quote("Isiah Pacheco", "RUSH_YDS", "fanduel", 61.5, -110, -110, "BUF@KC"),
  quote("Travis Kelce", "REC_YDS", "pinnacle", 58.5, -108, -112, "BUF@KC"),
  quote("Travis Kelce", "REC_YDS", "draftkings", 58.5, 110, -130, "BUF@KC"),
  quote("Travis Kelce", "REC_YDS", "fanduel", 58.5, -110, -110, "BUF@KC"),
  quote("Travis Kelce", "REC", "pinnacle", 5.5, -125, 105, "BUF@KC"),
  quote("Travis Kelce", "REC", "draftkings", 5.5, -120, 100, "BUF@KC"),
  quote("Travis Kelce", "REC", "fanduel", 5.5, -118, -102, "BUF@KC"),
  quote("Justin Jefferson", "REC_YDS", "pinnacle", 82.5, -110, -110, "MIN@DET"),
  quote("Justin Jefferson", "REC_YDS", "draftkings", 82.5, -105, -115, "MIN@DET"),
  quote("Justin Jefferson", "REC_YDS", "fanduel", 81.5, -110, -110, "MIN@DET"),
]

describe("end-to-end daily pipeline per league", () => {
  it("prices a WNBA slate", () => {
    const picks = buildDailyPicks(WNBA_QUOTES, optsFor("wnba"))
    expect(picks.games.map((g) => g.gameId).sort()).toEqual(["DAL@LVA", "NYL@SEA"])
    expect(picks.stats.props).toBe(3)
    expect(picks.stats.pricedProps).toBe(3)
    expect(picks.stats.booksSeen).toContain("pinnacle")
    // Projections must land near the WNBA lines, not NBA ones.
    const arike = picks.dfsTargets.find((t) => t.player === "Arike Ogunbowale")
    if (arike) expect(arike.mean).toBeGreaterThan(15), expect(arike.mean).toBeLessThan(28)
  })

  it("prices an NFL slate at NFL numbers", () => {
    const picks = buildDailyPicks(NFL_QUOTES, optsFor("nfl"))
    expect(picks.games.map((g) => g.gameId).sort()).toEqual(["BUF@KC", "MIN@DET"])
    expect(picks.stats.props).toBe(5)
    expect(picks.stats.pricedProps).toBe(5)
    // Projections land on the posted lines, with football-sized spreads: a
    // quarterback's yards swing by tens of yards, not a handful.
    const allen = picks.dfsTargets.find((t) => t.player === "Josh Allen")
    expect(allen).toBeDefined()
    expect(allen!.mean).toBeGreaterThan(225)
    expect(allen!.mean).toBeLessThan(270)
    expect(allen!.sd).toBeGreaterThan(40)
    expect(allen!.sd).toBeLessThan(100)
  })

  it("finds pick'em targets on yardage props, well away from the posted line", () => {
    // The target walk used to stop 15 either side of the projection. With a
    // passing-yards spread near 70 the break-even line sits further out than
    // that, and every yardage prop came back as a pass.
    const picks = buildDailyPicks(NFL_QUOTES, optsFor("nfl"))
    const allen = picks.dfsTargets.find((t) => t.player === "Josh Allen")!
    expect(allen.overAt).not.toBeNull()
    expect(allen.underAt).not.toBeNull()
    expect(allen.overAt!).toBeLessThan(allen.fairLine)
    expect(allen.underAt!).toBeGreaterThan(allen.fairLine)
    // A 57.7% hit rate on a 70-yard spread is roughly 14 yards off fair, not 1.
    expect(allen.fairLine - allen.overAt!).toBeGreaterThan(5)
  })

  it("refuses to price a slate with no sportsbook odds, in every league", () => {
    for (const lg of LEAGUE_IDS) {
      const naked = [...WNBA_QUOTES, ...NFL_QUOTES].map((q) => ({ ...q, overOdds: null, underOdds: null }))
      const picks = buildDailyPicks(naked, optsFor(lg))
      expect(picks.stats.pricedProps).toBe(0)
      expect(picks.valueBets).toHaveLength(0)
      expect(picks.parlays).toHaveLength(0)
    }
  })
})

// ---------------------------------------------------------------------------
// NFL market plumbing
// ---------------------------------------------------------------------------

import { normalizeMarket, distributionFor } from "@/lib/nba/markets"
import { FEED_MARKET_MAP, marketsForLeague } from "@/lib/odds-feed/theoddsapi"

describe("NFL markets", () => {
  it("reads the ways boards and books write football stats", () => {
    const cases: [string, string][] = [
      ["Pass Yards", "PASS_YDS"],
      ["Passing Yards", "PASS_YDS"],
      ["Pass TDs", "PASS_TDS"],
      ["Pass Completions", "PASS_COMP"],
      ["Pass Attempts", "PASS_ATT"],
      ["Interceptions", "PASS_INT"],
      ["Rush Yards", "RUSH_YDS"],
      ["Rushing Yards", "RUSH_YDS"],
      ["Rush Attempts", "RUSH_ATT"],
      ["Receptions", "REC"],
      ["Receiving Yards", "REC_YDS"],
      ["Rec Yds", "REC_YDS"],
      ["Rush + Rec Yds", "RUSH_REC_YDS"],
      ["NFL Passing Yards O/U", "PASS_YDS"],
    ]
    for (const [raw, key] of cases) expect(normalizeMarket(raw).key, raw).toBe(key)
  })

  it("leaves every basketball market where it was", () => {
    const cases: [string, string][] = [
      ["Points", "PTS"],
      ["Rebounds", "REB"],
      ["Assists", "AST"],
      ["3-Pointers Made", "3PM"],
      ["Pts+Rebs+Asts", "PRA"],
      ["FG Attempted", "FGA"],
      ["3PT Attempted", "3PA"],
      ["Blocked Shots", "BLK"],
      ["Turnovers", "TOV"],
      ["Free Throws Made", "FTM"],
    ]
    for (const [raw, key] of cases) expect(normalizeMarket(raw).key, raw).toBe(key)
  })

  it("maps every default NFL feed market", () => {
    for (const k of LEAGUES.nfl.markets) expect(FEED_MARKET_MAP[k], k).toBeDefined()
  })

  it("never bills a basketball market list against an NFL slate", () => {
    expect(marketsForLeague("nfl", ["player_points", "player_rebounds"])).toEqual(LEAGUES.nfl.markets)
    expect(marketsForLeague("nfl", ["player_points", "player_pass_tds"])).toEqual(["player_pass_tds"])
    expect(marketsForLeague("nba", ["player_pass_yds"])).toEqual(LEAGUES.nba.markets)
    expect(marketsForLeague("nba", null)).toEqual(LEAGUES.nba.markets)
    expect(marketsForLeague("wnba", ["player_points"])).toEqual(["player_points"])
  })

  it("holds the whole of a passing-yards distribution, not a truncated one", () => {
    // The support used to stop at 400. A 265-yard projection with a 70-yard
    // spread has real mass out there, and cutting it off shifted every
    // probability toward the under.
    const d = distributionFor("PASS_YDS", 265)
    expect(d.support).toBeGreaterThan(265 + 6 * d.sd)
    let total = 0
    let mean = 0
    for (let k = 0; k <= d.support; k++) {
      total += d.pmf(k)
      mean += k * d.pmf(k)
    }
    expect(total).toBeCloseTo(1, 6)
    expect(mean).toBeCloseTo(265, 0)
  })

  it("models passing touchdowns as under-dispersed", () => {
    const d = distributionFor("PASS_TDS", 1.6)
    expect(d.family).toBe("binomial")
    expect(d.variance).toBeLessThan(1.6)
  })
})

// ---------------------------------------------------------------------------
// NHL
// ---------------------------------------------------------------------------

import { marketForSport } from "@/lib/nba/markets"
import { normalizeEventOdds } from "@/lib/odds-feed/theoddsapi"
import type { FeedEventOdds } from "@/lib/odds-feed/types"

describe("NHL markets", () => {
  it("reads hockey labels as hockey markets, and keeps basketball's own", () => {
    expect(normalizeMarket("Shots On Goal").key).toBe("SOG")
    expect(normalizeMarket("Goalie Saves").key).toBe("SAVES")
    expect(normalizeMarket("Hockey Points").key).toBe("HKY_PTS")
    expect(normalizeMarket("Power Play Points").key).toBe("HKY_PPP")
    expect(normalizeMarket("Goals").key).toBe("HKY_GOALS")
    // Unchanged for basketball: the bare words stay basketball, and
    // "field goals" never becomes hockey goals.
    expect(normalizeMarket("Points").key).toBe("PTS")
    expect(normalizeMarket("Field Goals").key).toBe("FGM")
    expect(normalizeMarket("Field Goals Made").key).toBe("FGM")
  })

  it("swaps points, assists and blocked shots between the sports", () => {
    expect(marketForSport("PTS", "hockey")).toBe("HKY_PTS")
    expect(marketForSport("AST", "hockey")).toBe("HKY_AST")
    expect(marketForSport("BLK", "hockey")).toBe("HKY_BLK")
    expect(marketForSport("SOG", "hockey")).toBe("SOG")
    expect(marketForSport("HKY_PTS", "basketball")).toBe("PTS")
    expect(marketForSport("REB", "hockey")).toBe("REB")
  })

  it("maps the feed's player_points to hockey points on an NHL game, and basketball points otherwise", () => {
    const event = (sport_key?: string): FeedEventOdds => ({
      id: "e1",
      sport_key,
      commence_time: "2026-10-08T23:00:00Z",
      home_team: "Toronto Maple Leafs",
      away_team: "Montreal Canadiens",
      bookmakers: [
        {
          key: "pinnacle",
          title: "Pinnacle",
          markets: [
            { key: "player_points", outcomes: [
              { name: "Over", description: "Auston Matthews", price: 105, point: 0.5 },
              { name: "Under", description: "Auston Matthews", price: -125, point: 0.5 },
            ] },
            { key: "player_shots_on_goal", outcomes: [
              { name: "Over", description: "Auston Matthews", price: -160, point: 3.5 },
              { name: "Under", description: "Auston Matthews", price: 130, point: 3.5 },
            ] },
          ],
        },
      ],
    })
    const asked = normalizeEventOdds(event(), "hockey").quotes.map((q) => q.market).sort()
    expect(asked).toEqual(["HKY_PTS", "SOG"])
    const fromPayload = normalizeEventOdds(event("icehockey_nhl")).quotes.map((q) => q.market).sort()
    expect(fromPayload).toEqual(["HKY_PTS", "SOG"])
    // A basketball payload: player_points is basketball, and shots on goal is not a market there.
    const nba = normalizeEventOdds(event("basketball_nba"))
    expect(nba.quotes.map((q) => q.market)).toEqual(["PTS"])
    expect(nba.unknownMarkets).toEqual(["player_shots_on_goal"])
  })

  it("keeps only hockey markets on an NHL pull, and hockey markets off a basketball one", () => {
    expect(marketsForLeague("nhl", ["player_points", "player_rebounds"])).toEqual(["player_points"])
    expect(marketsForLeague("nhl", null)).toEqual(LEAGUES.nhl.markets)
    expect(marketsForLeague("nba", ["player_shots_on_goal"])).toEqual(LEAGUES.nba.markets)
  })
})

const NHL_QUOTES: FeedQuote[] = [
  // A shooter the books make a clear over at 2.5.
  quote("Auston Matthews", "SOG", "pinnacle", 3.5, -150, 122, "MTL@TOR"),
  quote("Auston Matthews", "SOG", "lowvig", 3.5, -148, 120, "MTL@TOR"),
  quote("Auston Matthews", "SOG", "draftkings", 3.5, -140, 110, "MTL@TOR"),
  // A depth player the books make a clear under at 0.5 points.
  quote("Jake Evans", "HKY_PTS", "pinnacle", 0.5, 210, -270, "MTL@TOR"),
  quote("Jake Evans", "HKY_PTS", "lowvig", 0.5, 205, -265, "MTL@TOR"),
  quote("Jake Evans", "HKY_PTS", "fanduel", 0.5, 220, -290, "MTL@TOR"),
  // A goalie near a coin flip.
  quote("Joseph Woll", "SAVES", "pinnacle", 26.5, -112, -108, "MTL@TOR"),
  quote("Joseph Woll", "SAVES", "draftkings", 26.5, -110, -110, "MTL@TOR"),
]

describe("the NHL through the daily pipeline", () => {
  const picks = buildDailyPicks(NHL_QUOTES, optsFor("nhl"))

  it("prices every prop at hockey-sized numbers", () => {
    expect(picks.stats.pricedProps).toBe(3)
    const matthews = picks.dfsTargets.find((t) => t.player === "Auston Matthews")!
    const woll = picks.dfsTargets.find((t) => t.player === "Joseph Woll")!
    // Over 3.5 shots at -150: a mean near 4, spread close to Poisson.
    expect(matthews.mean).toBeGreaterThan(3.5)
    expect(matthews.mean).toBeLessThan(4.6)
    expect(matthews.marketSide).toBe("OVER")
    expect(matthews.marketProb).toBeGreaterThan(0.55)
    expect(matthews.marketProb).toBeLessThan(0.6)
    // Saves at a coin flip: a 27-save goalie with a spread of about six and a half.
    expect(woll.mean).toBeGreaterThan(26)
    expect(woll.mean).toBeLessThan(28)
    expect(woll.sd).toBeGreaterThan(5)
    expect(woll.sd).toBeLessThan(8)
    expect(woll.marketProb).toBeLessThan(0.53)
  })

  it("puts the most lopsided half-point line first: a depth player's under 0.5 points", () => {
    const evans = picks.dfsTargets.find((t) => t.player === "Jake Evans")!
    expect(evans).toBeDefined()
    expect(evans.marketLine).toBe(0.5)
    expect(evans.marketSide).toBe("UNDER")
    expect(evans.marketProb).toBeGreaterThan(0.68)
    expect(picks.dfsTargets[0].player).toBe("Jake Evans")
  })
})
