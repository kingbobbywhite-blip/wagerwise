import { describe, it, expect } from "vitest"
import { distributionFor } from "@/lib/nba/markets"
import { DEFAULT_CORRELATION } from "@/lib/quant/correlation"
import { DEFAULT_CONSTRAINTS } from "@/lib/quant/optimizer"
import { DEFAULT_PROJECTION_SETTINGS } from "@/lib/quant/projection"
import { DEFAULT_VALUE_SETTINGS, kickoffVarianceFactor, type FeedQuote } from "@/lib/quant/valuebets"
import {
  PICKEM_MAX_PROB,
  boardLine,
  buildDailyPicks,
  buildDfsBoard,
  buildDfsTargets,
  buildPickemEntry,
  dfsTargetsFor,
  probAt,
  pushAt,
} from "@/lib/today/build"
import type { LeagueId } from "@/lib/leagues"

/**
 * The pick'em board: every number this section prints has to be a number you
 * can find on PrizePicks, Underdog or FanDuel.
 *
 * This failed hardest in two separate ways, and both are pinned here: ladders
 * printing thresholds no board has ever shown, and props whose favoured side
 * is so lopsided no pick'em app would offer the pick at all. The NHL was where
 * both were found, and these now pin them on the NBA, which is the league the
 * board is built for. Low-count basketball markets (blocks, steals, threes) hit
 * the same arithmetic the hockey ones did.
 *
 * The sportsbook side of the app is deliberately untouched by either: a
 * lopsided price is still a price, and still worth betting if it is wrong. It
 * is just not a pick'em pick.
 */

const NOW = Date.parse("2026-01-14T18:00:00Z")
const TIP = "2026-01-15T00:10:00Z"

function quote(
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
    commenceTime: TIP,
  }
}

/** Three books on the same line, which is how a real prop arrives. */
function priced(
  player: string,
  market: FeedQuote["market"],
  line: number,
  over: number,
  under: number,
  gameId?: string,
): FeedQuote[] {
  return [
    quote(player, market, "pinnacle", line, over, under, gameId),
    quote(player, market, "draftkings", line, over, under, gameId),
    quote(player, market, "fanduel", line, over, under, gameId),
  ]
}

function optsFor(league: LeagueId, breakEven = 0.577) {
  return {
    value: { ...DEFAULT_VALUE_SETTINGS, projection: { ...DEFAULT_PROJECTION_SETTINGS, league } },
    correlation: DEFAULT_CORRELATION,
    constraints: { ...DEFAULT_CONSTRAINTS, picks: 2, maxPerGame: 2, maxPerTeam: 2 },
    dfsBreakEven: breakEven,
    now: NOW,
  }
}

describe("targets sit on lines the books are actually hanging", () => {
  it("keeps a low-count ladder inside the board", () => {
    // Blocked shots 1.5. Before this, the ladder swept fifteen either side of
    // the projection and printed thresholds up at 16.5 blocks.
    const targets = buildDfsTargets(priced("Rim Protector", "BLK", 1.5, -115, -105), optsFor("nba"))
    expect(targets).toHaveLength(1)
    const t = targets[0]
    expect(t.ladder.length).toBeLessThanOrEqual(4)
    for (const step of t.ladder) {
      // Every row is a blocks line a board really posts.
      expect(step.line).toBeGreaterThanOrEqual(0.5)
      expect(step.line).toBeLessThanOrEqual(2.5)
    }
    // And the thresholds are inside it, so the rule on the row names a real line.
    for (const line of [t.overAt, t.underAt].filter((l): l is number => l != null)) {
      expect(line).toBeGreaterThanOrEqual(0.5)
      expect(line).toBeLessThanOrEqual(2.5)
    }
  })

  it("keeps a high-count ladder near the posted line, not down in single figures", () => {
    const targets = buildDfsTargets(priced("Scorer", "PTS", 27.5, -110, -110), optsFor("nba"))
    const t = targets[0]
    expect(Math.min(...t.ladder.map((s) => s.line))).toBeGreaterThan(20)
    expect(Math.max(...t.ladder.map((s) => s.line))).toBeLessThan(35)
  })

  it("cuts a passing-yards ladder from two hundred rows to a readable one", () => {
    const targets = buildDfsTargets(priced("Josh Allen", "PASS_YDS", 245.5, -110, -110, "BUF@KC"), optsFor("nfl"))
    const t = targets[0]
    expect(t.ladder.length).toBeLessThan(60)
    // Still wide enough to hold the break-even line, which is the whole point
    // of searching past a fixed window on a yardage market.
    expect(t.overAt).not.toBeNull()
    expect(t.underAt).not.toBeNull()
  })

  it("prices a whole number the books post, and the push that can void it", () => {
    // A real settled entry held "under 7 rebounds" and landed on exactly 7.
    // That is not a win and not a loss: the leg is voided, which on an
    // all-or-nothing entry shrinks the entry and the multiplier with it. The
    // ladder used to walk half-points only, so this line could not appear on
    // it at all, and nothing could warn about it.
    const targets = buildDfsTargets(priced("Josh Giddey", "REB", 7, -115, -105), optsFor("nba"))
    expect(targets).toHaveLength(1)
    const t = targets[0]
    const step = t.ladder.find((r) => r.line === 7)!
    expect(step).toBeDefined()
    expect(step.push).toBeGreaterThan(0.05)
    expect(pushAt(t, 7)).toBeCloseTo(step.push, 12)
    // Over, under and push are the whole of it, and a half-point neighbour
    // cannot land on itself.
    expect(step.over + step.under + step.push).toBeCloseTo(1, 9)
    expect(pushAt(t, 7.5)).toBe(0)
  })

  it("makes a whole number clear the bar on beating it, not on tying it", () => {
    // The push belongs to neither side, so a whole number is strictly harder
    // than the half-point below it. Reporting the tie as a win would be the
    // app telling someone a voided leg had cashed.
    const t = buildDfsTargets(priced("Josh Giddey", "REB", 7, -115, -105), optsFor("nba"))[0]
    const whole = t.ladder.find((r) => r.line === 7)!
    expect(whole.under).toBeLessThan(1 - whole.over)
    for (const line of [t.overAt, t.underAt].filter((l): l is number => l != null)) {
      const step = t.ladder.find((r) => Math.abs(r.line - line) < 1e-9)!
      expect(Math.max(step.over, step.under)).toBeGreaterThanOrEqual(0.577 - 1e-9)
    }
  })

  it("falls back to a fixed window when no posted lines are given", () => {
    // A caller pricing a hypothetical has no board to stay inside.
    const dist = distributionFor("BLK", 0.6)
    const free = dfsTargetsFor(0.6, dist, 0.577)
    const onBoard = dfsTargetsFor(0.6, dist, 0.577, { postedLines: [0.5] })
    expect(Math.max(...free.ladder.map((s) => s.line))).toBeGreaterThan(10)
    expect(Math.max(...onBoard.ladder.map((s) => s.line))).toBeLessThanOrEqual(2.5)
  })
})

describe("a pick'em app does not post a pick it cannot lose", () => {
  it("drops a prop whose every posted line is more lopsided than the ceiling", () => {
    // Blocked shots 0.5 for a guard who does not block: the books price the
    // under near -900, an 89% leg. Correct arithmetic, and not a pick you can
    // place on PrizePicks, Underdog or FanDuel.
    const targets = buildDfsTargets(priced("Never Blocks", "BLK", 0.5, 600, -900), optsFor("nba"))
    expect(targets).toHaveLength(0)
  })

  it("still takes a lopsided-but-plausible line, which is where the edge lives", () => {
    // Blocked shots 0.5 at -175: a 62% under on a line the apps really post.
    // This is the trade the board exists for and it must survive the ceiling.
    const targets = buildDfsTargets(priced("Sometimes Blocks", "BLK", 0.5, 145, -175), optsFor("nba"))
    expect(targets).toHaveLength(1)
    expect(targets[0].marketProb).toBeLessThan(PICKEM_MAX_PROB)
    expect(targets[0].marketLine).toBe(0.5)
  })

  it("counts and names what the ceiling removed instead of just dropping it", () => {
    const slate = [
      ...priced("Shooter", "3PM", 2.5, -125, 105),
      ...priced("Never Blocks", "BLK", 0.5, 600, -900),
    ]
    const board = buildDfsBoard(slate, optsFor("nba"))
    expect(board.targets.map((t) => t.player)).toEqual(["Shooter"])
    expect(board.lopsided).toHaveLength(1)
    const [out] = board.lopsided
    expect(out.player).toBe("Never Blocks")
    expect(out.marketLabel).toBe("Blocks")
    expect(out.line).toBe(0.5)
    expect(out.prob).toBeGreaterThan(PICKEM_MAX_PROB)
    // And buildDailyPicks carries it to the screen.
    const picks = buildDailyPicks(slate, optsFor("nba"))
    expect(picks.lopsided.map((l) => l.player)).toEqual(["Never Blocks"])
  })

  it("keeps everything when the dial is opened all the way", () => {
    const slate = priced("Never Blocks", "BLK", 0.5, 600, -900)
    expect(buildDfsBoard(slate, { ...optsFor("nba"), pickemMaxProb: 1 }).lopsided).toHaveLength(0)
    expect(buildDfsBoard(slate, { ...optsFor("nba"), pickemMaxProb: 1 }).targets).toHaveLength(1)
    // And tightening it removes a prop the default keeps.
    const ordinary = priced("Sometimes Blocks", "BLK", 0.5, 145, -175)
    expect(buildDfsBoard(ordinary, optsFor("nba")).targets).toHaveLength(1)
    expect(buildDfsBoard(ordinary, { ...optsFor("nba"), pickemMaxProb: 0.55 }).lopsided).toHaveLength(1)
  })

  it("keeps a prop an app is really posting, whatever the prior says", () => {
    // The ceiling is a prior about what a board offers. When PropLine has told
    // us the board's actual line, the prior has nothing left to say.
    const quotes = priced("Never Blocks", "BLK", 0.5, 600, -900)
    expect(buildDfsTargets(quotes, optsFor("nba"))).toHaveLength(0)
    const withLine = buildDfsTargets(quotes, {
      ...optsFor("nba"),
      pickemLines: [
        {
          app: "prizepicks",
          player: "Never Blocks",
          playerKey: "never blocks",
          market: "BLK",
          gameId: "MIN@OKC",
          line: 0.5,
          pickType: "standard",
          over: { multiplier: null },
          under: { multiplier: null },
          fetchedAt: null,
        },
      ],
    })
    expect(withLine).toHaveLength(1)
    expect(withLine[0].appLines?.[0].line).toBe(0.5)
  })

  it("prefers the balanced posted line when the most-posted one is unplayable", () => {
    const dist = distributionFor("3PM", 3.2)
    // Two books hang 0.5 (a near-certain over) and one hangs 3.5.
    const chosen = boardLine([0.5, 0.5, 3.5], 3.2, dist)
    expect(chosen!.line).toBe(3.5)
    expect(chosen!.prob).toBeLessThan(PICKEM_MAX_PROB)
    expect(chosen!.overCeiling).toBe(false)
    // When nothing on offer is playable it still reports the closest line it
    // found, flagged, so the prop can be named rather than silently dropped.
    const unplayable = boardLine([0.5, 0.5], 3.2, dist)!
    expect(unplayable.overCeiling).toBe(true)
    expect(unplayable.prob).toBeGreaterThan(PICKEM_MAX_PROB)
    // A dial of 1 keeps everything.
    expect(boardLine([0.5], 3.2, dist, 1)!.overCeiling).toBe(false)
    expect(boardLine([], 3.2, dist)).toBeNull()
  })

  it("builds an entry only from props the apps post", () => {
    const slate = [
      ...priced("Shooter", "3PM", 2.5, -125, 105),
      ...priced("Sometimes Blocks", "BLK", 0.5, 145, -175),
      ...priced("Never Blocks", "BLK", 0.5, 600, -900),
      ...priced("Never Steals", "STL", 0.5, 900, -1400, "NYK@BOS"),
    ]
    const targets = buildDfsTargets(slate, optsFor("nba"))
    expect(targets.map((t) => t.player).sort()).toEqual(["Shooter", "Sometimes Blocks"])
    const entry = buildPickemEntry(targets, 2, 0.5, 2, null, NOW)
    expect(entry).not.toBeNull()
    for (const leg of entry!) {
      expect(leg.prob).toBeLessThan(PICKEM_MAX_PROB)
      expect([0.5, 1.5, 2.5, 3.5, 4.5]).toContain(leg.line)
    }
  })
})

describe("yardage keeps its relative spread at the top of the range", () => {
  it("floors the spread at the stat's own coefficient of variation", () => {
    // The ratio prior alone gave a 340-yard line a spread of 80 yards, 24% of
    // the mean, where a real passing line sits near 28%. Every probability
    // built on that was too confident.
    const big = distributionFor("PASS_YDS", 340)
    expect(big.sd / 340).toBeGreaterThanOrEqual(0.27)
    expect(big.sd / 340).toBeLessThan(0.3)
  })

  it("leaves the ratio in charge below the crossover", () => {
    // At the typical mean the ratio was already right, so nothing moves: a
    // low-volume receiver really is more erratic than a proportional spread.
    const typical = distributionFor("PASS_YDS", 235)
    expect(typical.variance).toBeCloseTo(19 * 235, 6)
    const thin = distributionFor("REC_YDS", 20)
    expect(thin.variance).toBeCloseTo(16 * 20, 6)
  })

  it("still answers the outcome-spread dial", () => {
    const base = distributionFor("PASS_YDS", 340)
    const wider = distributionFor("PASS_YDS", 340, { global: 1.3 })
    expect(wider.variance).toBeCloseTo(base.variance * 1.3, 4)
  })

  it("leaves basketball exactly where it was", () => {
    expect(distributionFor("PTS", 25).variance).toBeCloseTo(2.6 * 25, 6)
    expect(distributionFor("REB", 10).variance).toBeCloseTo(1.25 * 10, 6)
  })
})

describe("a line priced days before kickoff is less certain than one priced at kickoff", () => {
  it("widens by the days in between, and caps", () => {
    const day = 86_400_000
    expect(kickoffVarianceFactor(new Date(NOW + 4 * day).toISOString(), NOW)).toBeCloseTo(1.12, 6)
    expect(kickoffVarianceFactor(new Date(NOW + 2 * day).toISOString(), NOW)).toBeCloseTo(1.08, 6)
    expect(kickoffVarianceFactor(new Date(NOW + 6 * 3600_000).toISOString(), NOW)).toBeCloseTo(1.01, 6)
  })

  it("does nothing without a start time, or once the game is under way", () => {
    expect(kickoffVarianceFactor(null, NOW)).toBe(1)
    expect(kickoffVarianceFactor("not a date", NOW)).toBe(1)
    expect(kickoffVarianceFactor(new Date(NOW - 3600_000).toISOString(), NOW)).toBe(1)
  })

  it("shows up as a wider projection on a midweek NFL pull", () => {
    const sunday = priced("Josh Allen", "PASS_YDS", 245.5, -110, -110, "BUF@KC")
    const midweek = sunday.map((q) => ({ ...q, commenceTime: new Date(NOW + 4 * 86_400_000).toISOString() }))
    const atKickoff = buildDfsTargets(sunday, optsFor("nfl"))[0]
    const daysOut = buildDfsTargets(midweek, optsFor("nfl"))[0]
    expect(daysOut.sd).toBeGreaterThan(atKickoff.sd)
    // What the market said at the line it priced is preserved: the devigged
    // price is still the probability there. Only the certainty away from the
    // posted line changes, which is where a pick'em target sits.
    expect(probAt(daysOut, 245.5, "OVER")!).toBeCloseTo(probAt(atKickoff, 245.5, "OVER")!, 2)
    const far = 265.5
    expect(Math.abs(probAt(daysOut, far, "OVER")! - 0.5)).toBeLessThan(
      Math.abs(probAt(atKickoff, far, "OVER")! - 0.5),
    )
  })
})
