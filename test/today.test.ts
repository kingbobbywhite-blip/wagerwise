import { describe, expect, it } from "vitest"
import { buildDailyPicks, buildDfsTargets, dfsTargetsFor, summariseGames, valueBetsToCandidates } from "@/lib/today/build"
import { DEFAULT_VALUE_SETTINGS, findValueBets, type FeedQuote } from "@/lib/quant/valuebets"
import { DEFAULT_CORRELATION } from "@/lib/quant/correlation"
import { DEFAULT_CONSTRAINTS } from "@/lib/quant/optimizer"
import { distributionFor } from "@/lib/nba/markets"

const OPTS = {
  value: DEFAULT_VALUE_SETTINGS,
  correlation: DEFAULT_CORRELATION,
  constraints: { ...DEFAULT_CONSTRAINTS, picks: 3, maxPerGame: 3, maxPerTeam: 3 },
  dfsBreakEven: 0.562,
  now: Date.parse("2026-01-15T18:00:00Z"),
}

function q(
  player: string,
  market: FeedQuote["market"],
  book: string,
  line: number,
  over: number | null,
  under: number | null,
  gameId = "MIN@OKC",
): FeedQuote {
  return {
    book, line, overOdds: over, underOdds: under, fetchedAt: null,
    player, market, gameId,
    homeTeam: gameId.split("@")[1], awayTeam: gameId.split("@")[0],
    commenceTime: "2026-01-16T00:10:00Z",
  }
}

describe("summariseGames", () => {
  it("summarises the slate", () => {
    const games = summariseGames([
      q("A Player", "PTS", "pinnacle", 20.5, -110, -110),
      q("B Player", "PTS", "pinnacle", 20.5, -110, -110),
      q("C Player", "PTS", "pinnacle", 20.5, -110, -110, "NYK@BOS"),
    ])
    expect(games).toHaveLength(2)
    expect(games.find((g) => g.gameId === "MIN@OKC")!.propCount).toBe(2)
    expect(games[0].homeTeam).toBeTruthy()
    expect(games[0].awayTeam).toBeTruthy()
  })
})

describe("dfsTargetsFor", () => {
  const dist = distributionFor("PTS", 26)

  it("puts the fair line near the projection", () => {
    const t = dfsTargetsFor(26, dist, 0.562)
    expect(t.fairLine).toBeGreaterThan(24)
    expect(t.fairLine).toBeLessThan(28)
  })

  it("gives an over target below the fair line and an under target above it", () => {
    const t = dfsTargetsFor(26, dist, 0.562)
    expect(t.overAt).not.toBeNull()
    expect(t.underAt).not.toBeNull()
    expect(t.overAt!).toBeLessThan(t.fairLine)
    expect(t.underAt!).toBeGreaterThan(t.fairLine)
    expect(t.overProb!).toBeGreaterThanOrEqual(0.562)
    expect(t.underProb!).toBeGreaterThanOrEqual(0.562)
  })

  it("moves the targets further out as the bar rises", () => {
    const easy = dfsTargetsFor(26, dist, 0.52)
    const hard = dfsTargetsFor(26, dist, 0.62)
    expect(hard.overAt!).toBeLessThan(easy.overAt!)
    expect(hard.underAt!).toBeGreaterThan(easy.underAt!)
  })

  it("returns nothing when the bar cannot be cleared", () => {
    const t = dfsTargetsFor(26, dist, 0.999)
    expect(t.overAt).toBeNull()
    expect(t.underAt).toBeNull()
  })

  it("handles a low-mean stat without going below zero", () => {
    const blocks = distributionFor("BLK", 0.8)
    const t = dfsTargetsFor(0.8, blocks, 0.562)
    if (t.overAt != null) expect(t.overAt).toBeGreaterThan(0)
    if (t.underAt != null) expect(t.underAt).toBeGreaterThan(0)
  })
})

describe("buildDfsTargets", () => {
  it("produces a target from a sharp consensus", () => {
    const targets = buildDfsTargets([q("Anthony Edwards", "PTS", "pinnacle", 25.5, -110, -110)], OPTS)
    expect(targets).toHaveLength(1)
    expect(targets[0].hasSharpBook).toBe(true)
    expect(targets[0].overAt).not.toBeNull()
    expect(targets[0].marketLabel).toBe("Points")
  })

  it("skips props with no sharp reference", () => {
    expect(buildDfsTargets([q("A Player", "PTS", "espnbet", 25.5, -110, -110)], OPTS)).toHaveLength(0)
  })
})

describe("valueBetsToCandidates", () => {
  it("carries the price and game through so parlays can be priced and correlated", () => {
    const bets = findValueBets([
      q("Anthony Edwards", "PTS", "pinnacle", 25.5, -110, -110),
      q("Anthony Edwards", "PTS", "draftkings", 25.5, 130, -150),
    ])
    const c = valueBetsToCandidates(bets)
    expect(c[0].american).toBe(130)
    expect(c[0].status).toBe("priced")
    expect(c[0].gameId).toBe("MIN@OKC")
    expect(c[0].pWin).toBeGreaterThan(0)
  })
})

describe("buildDailyPicks", () => {
  // Four players across two games. Pinnacle sets each number; DraftKings is
  // soft on all four, and FanDuel is soft on one, so a single-book parlay is
  // possible at DraftKings but not at FanDuel.
  const quotes: FeedQuote[] = [
    q("Anthony Edwards", "PTS", "pinnacle", 25.5, -110, -110),
    q("Anthony Edwards", "PTS", "draftkings", 25.5, 135, -155),
    q("Rudy Gobert", "REB", "pinnacle", 11.5, -110, -110),
    q("Rudy Gobert", "REB", "draftkings", 11.5, 130, -150),
    q("Rudy Gobert", "REB", "fanduel", 11.5, 128, -148),
    q("Jalen Brunson", "PTS", "pinnacle", 26.5, -110, -110, "NYK@BOS"),
    q("Jalen Brunson", "PTS", "draftkings", 26.5, 128, -148, "NYK@BOS"),
    q("Jayson Tatum", "REB", "pinnacle", 8.5, -110, -110, "NYK@BOS"),
    q("Jayson Tatum", "REB", "draftkings", 8.5, 132, -152, "NYK@BOS"),
  ]

  const picks = buildDailyPicks(quotes, OPTS)

  it("summarises the slate", () => {
    expect(picks.games).toHaveLength(2)
    expect(picks.stats.props).toBe(4)
    expect(picks.stats.pricedProps).toBe(4)
    expect(picks.stats.booksSeen).toContain("pinnacle")
  })

  it("finds the mispriced retail offers", () => {
    expect(picks.valueBets.length).toBeGreaterThanOrEqual(4)
    for (const b of picks.valueBets) {
      expect(b.edge).toBeGreaterThan(0)
      expect(b.bookTier).not.toBe("market-making")
    }
  })

  it("builds parlays out of the value legs", () => {
    expect(picks.parlays.length).toBeGreaterThan(0)
    for (const p of picks.parlays) {
      expect(p.legs).toHaveLength(3)
      expect(p.evaluation.breakEvenLegProb).not.toBeNull()
    }
  })

  it("keeps every parlay inside a single book", () => {
    // A leg at DraftKings cannot be combined with a leg at FanDuel onto one
    // ticket, so a parlay spanning books is one nobody can actually place.
    for (const p of picks.parlays) {
      expect(new Set(p.legs.map((l) => l.app)).size).toBe(1)
    }
  })

  it("builds no parlay when no single book has enough value legs", () => {
    const spread = buildDailyPicks(
      [
        q("Anthony Edwards", "PTS", "pinnacle", 25.5, -110, -110),
        q("Anthony Edwards", "PTS", "draftkings", 25.5, 135, -155),
        q("Rudy Gobert", "REB", "pinnacle", 11.5, -110, -110),
        q("Rudy Gobert", "REB", "fanduel", 11.5, 130, -150),
        q("Jalen Brunson", "PTS", "pinnacle", 26.5, -110, -110, "NYK@BOS"),
        q("Jalen Brunson", "PTS", "betmgm", 26.5, 128, -148, "NYK@BOS"),
      ],
      OPTS,
    )
    expect(spread.valueBets.length).toBeGreaterThanOrEqual(3)
    expect(spread.parlays).toHaveLength(0)
  })

  it("prices parlays from the legs' own odds", () => {
    const p = picks.parlays[0]
    // Three legs near +130 pay far more than a DFS 3-pick.
    expect(p.evaluation.topMultiple).toBeGreaterThan(8)
  })

  it("produces DFS targets alongside the sportsbook bets", () => {
    expect(picks.dfsTargets.length).toBeGreaterThan(0)
    for (const t of picks.dfsTargets) {
      expect(t.overAt != null || t.underAt != null).toBe(true)
    }
  })

  it("returns nothing rather than something when the feed is empty", () => {
    const empty = buildDailyPicks([], OPTS)
    expect(empty.games).toHaveLength(0)
    expect(empty.valueBets).toHaveLength(0)
    expect(empty.parlays).toHaveLength(0)
    expect(empty.dfsTargets).toHaveLength(0)
  })

  it("finds no bets when every book agrees", () => {
    const agreed: FeedQuote[] = [
      q("Anthony Edwards", "PTS", "pinnacle", 25.5, -110, -110),
      q("Anthony Edwards", "PTS", "draftkings", 25.5, -110, -110),
    ]
    const p = buildDailyPicks(agreed, OPTS)
    expect(p.valueBets).toHaveLength(0)
    expect(p.parlays).toHaveLength(0)
    // But the DFS target still exists, because the fair line is still useful.
    expect(p.dfsTargets.length).toBeGreaterThan(0)
  })
})

describe("dfsTargetsFor line granularity", () => {
  it("only ever suggests half-point lines", () => {
    for (const [market, mean] of [["PTS", 26.4], ["REB", 8.1], ["3PM", 2.8], ["BLK", 0.9], ["AST", 6.2]] as const) {
      const t = dfsTargetsFor(mean, distributionFor(market, mean), 0.56)
      for (const v of [t.fairLine, t.overAt, t.underAt]) {
        if (v == null) continue
        // A whole-number line can push, which these targets do not account for.
        expect(Math.abs(v - Math.floor(v) - 0.5)).toBeLessThan(1e-9)
      }
    }
  })
})

import { dfsVerdict } from "@/lib/today/build"

describe("one verdict per pick'em target", () => {
  // Judkins receiving yards: over worth it at 9.5 or lower, under at 16.5 or
  // higher. Shown as two columns, that read as take both.
  const t = { overAt: 9.5, underAt: 16.5, fairLine: 12.5 }

  it("names the over below its threshold, the under above its own, and passes between", () => {
    expect(dfsVerdict(t, 8.5)).toBe("OVER")
    expect(dfsVerdict(t, 9.5)).toBe("OVER")
    expect(dfsVerdict(t, 12.5)).toBe("PASS")
    expect(dfsVerdict(t, 16.5)).toBe("UNDER")
    expect(dfsVerdict(t, 20.5)).toBe("UNDER")
  })

  it("never returns both sides for any line", () => {
    for (let line = 0.5; line < 30; line += 1) {
      expect(["OVER", "UNDER", "PASS"]).toContain(dfsVerdict(t, line))
    }
    expect(dfsVerdict({ overAt: null, underAt: 16.5, fairLine: 12.5 }, 8.5)).toBe("PASS")
  })
})

import { marketLineOf, probAt } from "@/lib/today/build"

describe("sorting picks by probability", () => {
  // Sharp prices from a coin flip to a heavy favourite, each with a soft book
  // beside it, so both lists have several rows at different probabilities.
  const slateForSort = (): FeedQuote[] => [
    q("Coin Flip", "PTS", "pinnacle", 20.5, -110, -110),
    q("Coin Flip", "PTS", "draftkings", 20.5, 135, -155),
    q("Lean Under", "REB", "pinnacle", 8.5, 115, -135),
    q("Lean Under", "REB", "lowvig", 8.5, 112, -132),
    q("Lean Under", "REB", "fanduel", 8.5, 140, -105),
    q("Big Under", "AST", "pinnacle", 6.5, 140, -165, "NYK@BOS"),
    q("Big Under", "AST", "lowvig", 6.5, 135, -160, "NYK@BOS"),
    q("Big Under", "AST", "draftkings", 6.5, 155, -120, "NYK@BOS"),
    q("Slight Over", "PTS", "pinnacle", 18.5, -125, 105, "NYK@BOS"),
    q("Slight Over", "PTS", "betmgm", 18.5, 110, -135, "NYK@BOS"),
  ]

  it("lists value bets and pick'em targets most likely to hit first", () => {
    const picks = buildDailyPicks(slateForSort(), OPTS)
    const probs = picks.valueBets.map((b) => b.fairProb)
    expect(probs.length).toBeGreaterThan(1)
    expect(probs).toEqual([...probs].sort((a, b) => b - a))
    const chances = picks.dfsTargets.map((t) => t.marketProb)
    expect(chances.length).toBeGreaterThan(1)
    expect(chances).toEqual([...chances].sort((a, b) => b - a))
    for (const t of picks.dfsTargets) expect(t.marketProb).toBeGreaterThanOrEqual(0.5)
  })

  it("takes the line most books hang, and prices any half-point line on the ladder", () => {
    expect(marketLineOf([24.5, 24.5, 25.5, 23.5], 24.9)).toBe(24.5)
    expect(marketLineOf([24.5, 25.5], 25.4)).toBe(25.5)
    const t = { ladder: [{ line: 2.5, over: 0.42, under: 0.58 }] }
    expect(probAt(t, 2.5, "UNDER")).toBe(0.58)
    expect(probAt(t, 3, "UNDER")).toBeNull()
  })
})

import { buildPickemEntry, type DfsTarget } from "@/lib/today/build"

describe("a pick'em entry to play", () => {
  const t = (player: string, gameId: string, marketProb: number, marketSide: "OVER" | "UNDER" = "UNDER"): DfsTarget =>
    ({ key: `${player}|${gameId}`, player, gameId, marketProb, marketSide, marketLine: 1.5, marketLabel: "Shots On Goal" }) as DfsTarget

  it("takes the likeliest legs that clear the bar, one per player, two per game", () => {
    const entry = buildPickemEntry(
      [t("A", "g1", 0.7), t("B", "g1", 0.68), t("C", "g1", 0.66), t("D", "g2", 0.6), t("A", "g2", 0.65, "OVER"), t("E", "g3", 0.5)],
      3,
      0.55,
    )!
    // C is a third leg in g1; A's second prop would be the same player twice; E is below the bar.
    expect(entry.map((l) => l.target.player)).toEqual(["A", "B", "D"])
  })

  it("refuses to pad an entry with legs below the bar", () => {
    expect(buildPickemEntry([t("A", "g1", 0.7), t("B", "g2", 0.52)], 2, 0.577)).toBeNull()
  })
})

import { appPlay, hasAppLines, type AppLine } from "@/lib/today/build"
import type { PickemLine } from "@/lib/odds-feed/propline"

describe("pick'em lines from the apps", () => {
  const pp = (player: string, line: number, extra: Partial<PickemLine> = {}): PickemLine => ({
    app: "prizepicks",
    player,
    playerKey: player.toLowerCase(),
    market: "PTS",
    gameId: "MIN@OKC",
    line,
    pickType: "standard",
    over: { multiplier: null },
    under: { multiplier: null },
    fetchedAt: null,
    ...extra,
  })

  // Pinnacle and BetOnline both hang 25.5 with the over juiced: a projection above 25.5.
  const quotes = [
    q("Anthony Edwards", "PTS", "pinnacle", 25.5, -135, 115),
    q("Anthony Edwards", "PTS", "betonlineag", 25.5, -140, 118),
  ]

  it("prices each app line off the books' distribution, not the app", () => {
    const [t] = buildDfsTargets(quotes, {
      ...OPTS,
      pickemLines: [pp("Anthony Edwards", 23.5), pp("Anthony Edwards", 29.5, { pickType: "demon", under: null })],
    })
    expect(t.appLines).toHaveLength(2)
    const standard = t.appLines!.find((l) => l.pickType === "standard")!
    const demon = t.appLines!.find((l) => l.pickType === "demon")!
    // Two points below the books' line, the over is likelier than at the books' line.
    const atBooks = t.ladder.find((r) => r.line === 25.5)!.over
    expect(standard.over).toBeGreaterThan(atBooks)
    expect(standard.over + standard.under).toBeCloseTo(1, 9)
    expect(demon.over).toBeLessThan(atBooks)
    expect(demon.underOffered).toBe(false)
  })

  it("matches lines on player and market even when the game is spelled differently", () => {
    const [t] = buildDfsTargets(quotes, { ...OPTS, pickemLines: [pp("Anthony Edwards", 24.5, { gameId: "Wolves@Thunder" })] })
    expect(t.appLines).toHaveLength(1)
  })

  it("never matches another market or player", () => {
    const [t] = buildDfsTargets(quotes, {
      ...OPTS,
      pickemLines: [pp("Anthony Edwards", 6.5, { market: "REB" }), pp("Rudy Gobert", 12.5)],
    })
    expect(t.appLines).toEqual([])
  })

  const line = (over: number, extra: Partial<AppLine> = {}): AppLine => ({
    app: "prizepicks",
    line: 24.5,
    pickType: "standard",
    over,
    under: 1 - over,
    push: 0,
    overMultiplier: null,
    underMultiplier: null,
    overOffered: true,
    underOffered: true,
    ...extra,
  })

  it("plays the likelier side of the app's standard line", () => {
    expect(appPlay({ appLines: [line(0.62)] }, "prizepicks")).toEqual({ line: 24.5, side: "OVER", prob: 0.62 })
    expect(appPlay({ appLines: [line(0.3)] }, "prizepicks")).toEqual({ line: 24.5, side: "UNDER", prob: 0.7 })
  })

  it("never plays a goblin, a demon, a boosted side, or another app's line", () => {
    expect(appPlay({ appLines: [line(0.8, { pickType: "goblin" })] }, "prizepicks")).toBeNull()
    expect(appPlay({ appLines: [line(0.8, { app: "underdog" })] }, "prizepicks")).toBeNull()
    // Underdog discounts the over: only the under is a standard pick.
    expect(appPlay({ appLines: [line(0.8, { app: "underdog", overMultiplier: 0.85 })] }, "underdog")).toEqual({
      line: 24.5,
      side: "UNDER",
      prob: expect.closeTo(0.2, 9),
    })
  })

  const target = (
    player: string,
    gameId: string,
    marketProb: number,
    appLines?: AppLine[],
    appCoverage: string[] = appLines?.length ? ["prizepicks"] : [],
  ): DfsTarget =>
    ({ key: player, player, gameId, marketProb, marketSide: "OVER", marketLine: 24.5, marketLabel: "Points", appLines, appCoverage }) as DfsTarget

  it("builds the entry at the app's real lines and leaves out props it is not offering", () => {
    const targets = [
      target("A", "g1", 0.7, [line(0.58, { line: 26.5 })]),
      // PrizePicks posted lines for B's game, but none for B.
      target("B", "g2", 0.68, undefined, ["prizepicks"]),
      target("C", "g3", 0.6, [line(0.64, { line: 22.5 })]),
    ]
    expect(hasAppLines(targets, "prizepicks")).toBe(true)
    const entry = buildPickemEntry(targets, 2, 0.55, 2, "prizepicks")!
    expect(entry.map((l) => [l.target.player, l.line, l.source])).toEqual([
      ["C", 22.5, "app"],
      ["A", 26.5, "app"],
    ])
  })

  it("re-checks the bar at the app's line, which can be harder than the books'", () => {
    const targets = [target("A", "g1", 0.7, [line(0.52)]), target("C", "g3", 0.66, [line(0.6)])]
    expect(buildPickemEntry(targets, 2, 0.55, 2, "prizepicks")).toBeNull()
  })

  it("keeps a prop from a game the app's lines never arrived for, at the books' line", () => {
    const targets = [
      target("A", "g1", 0.7, [line(0.58, { line: 26.5 })]),
      // No PrizePicks line came through for g2 at all: unknown, not absent.
      target("B", "g2", 0.68),
    ]
    const entry = buildPickemEntry(targets, 2, 0.55, 2, "prizepicks")!
    expect(entry.map((l) => [l.target.player, l.line, l.source])).toEqual([
      ["B", 24.5, "books"],
      ["A", 26.5, "app"],
    ])
  })

  it("marks a game covered when the app posted any player in it", () => {
    const targets = buildDfsTargets(
      [...quotes, q("Rudy Gobert", "PTS", "pinnacle", 12.5, -135, 115), q("Rudy Gobert", "PTS", "betonlineag", 12.5, -140, 118)],
      { ...OPTS, pickemLines: [pp("Anthony Edwards", 24.5)] },
    )
    const gobert = targets.find((t) => t.player === "Rudy Gobert")!
    expect(gobert.appLines).toEqual([])
    expect(gobert.appCoverage).toEqual(["prizepicks"])
  })

  it("falls back to the books' line when the pull had nothing from that app", () => {
    const entry = buildPickemEntry([target("A", "g1", 0.7), target("B", "g2", 0.68)], 2, 0.55, 2, "prizepicks")!
    expect(entry.every((l) => l.source === "books" && l.line === 24.5)).toBe(true)
    expect(hasAppLines([target("A", "g1", 0.7)], "prizepicks")).toBe(false)
  })
})
