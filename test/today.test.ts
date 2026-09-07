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
