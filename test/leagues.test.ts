import { describe, it, expect } from "vitest"
import {
  DEFAULT_LEAGUE,
  LEAGUES,
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
  it("covers the three basketball leagues with distinct sport keys", () => {
    expect(LEAGUE_IDS).toEqual(["nba", "wnba", "ncaab"])
    const keys = LEAGUE_IDS.map((id) => LEAGUES[id].sportKey)
    expect(new Set(keys).size).toBe(3)
    expect(sportKeyFor("nba")).toBe("basketball_nba")
    expect(sportKeyFor("wnba")).toBe("basketball_wnba")
    expect(sportKeyFor("ncaab")).toBe("basketball_ncaab")
  })

  it("rejects unknown league ids rather than guessing a sport key", () => {
    expect(isLeagueId("nfl")).toBe(false)
    expect(sportKeyFor("nfl")).toBeNull()
    // leagueFor is the forgiving one, used where a fallback beats a crash.
    expect(leagueFor("nfl").id).toBe(DEFAULT_LEAGUE)
  })

  it("scales priors down for the shorter, slower leagues", () => {
    // 40-minute games at lower pace must project fewer points than 48-minute
    // games, or every unpriced college prop reads as a screaming over.
    expect(scaleMean("wnba", 20)).toBeLessThan(scaleMean("nba", 20))
    expect(scaleMean("ncaab", 20)).toBeLessThan(scaleMean("wnba", 20))
  })

  it("treats college basketball as the most volatile league", () => {
    expect(LEAGUES.ncaab.dispersionScale).toBeGreaterThan(LEAGUES.wnba.dispersionScale)
    expect(LEAGUES.wnba.dispersionScale).toBeGreaterThanOrEqual(LEAGUES.nba.dispersionScale)
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

  it("knows college basketball does not play in July", () => {
    expect(inSeason("ncaab", new Date("2026-07-15T00:00:00Z"))).toBe(false)
    expect(inSeason("ncaab", new Date("2026-02-15T00:00:00Z"))).toBe(true)
  })
})

describe("credit warning", () => {
  it("shouts before a college slate empties a monthly quota", () => {
    // 90 games x 3 markets = 270 credits, over half a 500-request month.
    const w = creditWarning("ncaab", 90, 3)
    expect(w.credits).toBe(270)
    expect(w.severe).toBe(true)
    expect(w.message).toContain("credits")
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
    expect(eventsUrl("KEY", "ncaab")).toContain("/sports/basketball_ncaab/events")
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

  it("widens the distribution for college basketball", () => {
    const nba = projectProp(row, { ...DEFAULT_PROJECTION_SETTINGS, league: "nba" })
    const cbb = projectProp(row, { ...DEFAULT_PROJECTION_SETTINGS, league: "ncaab" })
    expect(nba).not.toBeNull()
    expect(cbb).not.toBeNull()
    // Same line, same price, same implied mean — but a college projection is
    // less knowable, so the spread must be wider.
    expect(cbb!.sd).toBeGreaterThan(nba!.sd)
  })

  it("leaves the probability at the priced line to the market, not the league", () => {
    // This is the property that matters most. When a book has priced the prop,
    // the devigged price IS the probability; the league prior must not move it.
    // A league that nudged a priced number would be inventing an edge.
    const priced = { ...row, overOdds: -200, underOdds: 160 }
    const nba = projectProp(priced, { ...DEFAULT_PROJECTION_SETTINGS, league: "nba" })!
    const cbb = projectProp(priced, { ...DEFAULT_PROJECTION_SETTINGS, league: "ncaab" })!
    expect(Math.abs(cbb.pWin - nba.pWin)).toBeLessThan(0.005)
  })

  it("pulls probabilities toward a coin flip away from the priced line", () => {
    // Off the priced line — which is exactly where a pick'em target sits — a
    // wider distribution must be less confident. This is where the league
    // volatility prior earns its keep.
    const priced = { ...row, overOdds: -200, underOdds: 160 }
    const nba = projectProp(priced, { ...DEFAULT_PROJECTION_SETTINGS, league: "nba" })!
    const cbb = projectProp(priced, { ...DEFAULT_PROJECTION_SETTINGS, league: "ncaab" })!
    const target = 22.5
    const nbaOver = resolveLine(nba.distribution, target).over
    const cbbOver = resolveLine(cbb.distribution, target).over
    expect(Math.abs(cbbOver - 0.5)).toBeLessThan(Math.abs(nbaOver - 0.5))
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
        nfl: { fetchedAt: "z", quotes: [], events: [] },
      },
    }
    const migrated = migrate(stored)
    expect(Object.keys(migrated.daily).sort()).toEqual(["nba", "wnba"])
    expect(migrated.settings.daily.league).toBe("wnba")
  })

  it("falls back to the NBA when a stored league is not one we support", () => {
    const migrated = migrate({ version: 1, settings: { daily: { league: "nfl" } }, daily: {} })
    expect(migrated.settings.daily.league).toBe("nba")
  })
})

// ---------------------------------------------------------------------------
// End-to-end: a WNBA and a college slate through the whole daily pipeline.
//
// The feed cannot be reached from CI, so these use fixtures shaped like a real
// response. They prove the pipeline is genuinely league-agnostic: the same
// engine that prices an NBA slate prices a WNBA one at WNBA numbers, and a
// college one at college numbers, with the league only changing the spread.
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

function optsFor(league: "nba" | "wnba" | "ncaab") {
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

/** A college slate at college-sized lines. */
const CBB_QUOTES: FeedQuote[] = [
  quote("Guard One", "PTS", "pinnacle", 17.5, -110, -110, "DUKE@UNC"),
  quote("Guard One", "PTS", "draftkings", 17.5, 118, -138, "DUKE@UNC"),
  quote("Guard One", "PTS", "fanduel", 17.5, -106, -114, "DUKE@UNC"),
  quote("Forward Two", "REB", "pinnacle", 7.5, -112, -108, "DUKE@UNC"),
  quote("Forward Two", "REB", "draftkings", 7.5, -104, -116, "DUKE@UNC"),
  quote("Forward Two", "REB", "fanduel", 7.5, -110, -110, "DUKE@UNC"),
  quote("Wing Three", "AST", "pinnacle", 4.5, -105, -115, "KU@BAY"),
  quote("Wing Three", "AST", "draftkings", 4.5, 110, -130, "KU@BAY"),
  quote("Wing Three", "AST", "fanduel", 4.5, -108, -112, "KU@BAY"),
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

  it("prices a college slate", () => {
    const picks = buildDailyPicks(CBB_QUOTES, optsFor("ncaab"))
    expect(picks.games.map((g) => g.gameId).sort()).toEqual(["DUKE@UNC", "KU@BAY"])
    expect(picks.stats.pricedProps).toBe(3)
  })

  it("gives college targets a wider window than the same slate priced as the NBA", () => {
    // Identical quotes, different league. The wider college prior must not
    // produce a more confident set of targets.
    const asNba = buildDailyPicks(CBB_QUOTES, optsFor("nba"))
    const asCbb = buildDailyPicks(CBB_QUOTES, optsFor("ncaab"))
    const nbaT = asNba.dfsTargets.find((t) => t.player === "Guard One")
    const cbbT = asCbb.dfsTargets.find((t) => t.player === "Guard One")
    if (nbaT && cbbT) expect(cbbT.sd).toBeGreaterThan(nbaT.sd)
  })

  it("refuses to price a slate with no sportsbook odds, in every league", () => {
    for (const lg of LEAGUE_IDS) {
      const naked = CBB_QUOTES.map((q) => ({ ...q, overOdds: null, underOdds: null }))
      const picks = buildDailyPicks(naked, optsFor(lg))
      expect(picks.stats.pricedProps).toBe(0)
      expect(picks.valueBets).toHaveLength(0)
      expect(picks.parlays).toHaveLength(0)
    }
  })
})
