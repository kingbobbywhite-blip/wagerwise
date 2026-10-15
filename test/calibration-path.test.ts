import { describe, expect, it } from "vitest"
import {
  DISPERSION_DIAL_RANGE,
  groupedCalibration,
  impliedDispersion,
  type Observation,
} from "@/lib/quant/calibration"
import { fitMovement, lineMoves, snapshotFor, snapshotRows, summariseHistory } from "@/lib/quant/lines"
import { DEFAULT_VALUE_SETTINGS, KICKOFF_VARIANCE_PER_DAY, type FeedQuote } from "@/lib/quant/valuebets"
import { DEFAULT_PROJECTION_SETTINGS } from "@/lib/quant/projection"
import { MAX_LINE_SNAPSHOTS, migrate, type LineSnapshot } from "@/lib/store/schema"

/**
 * The path to fitting the priors, not the fit.
 *
 * Two readouts, and the distinction between them is the whole point: the
 * calibration tables say whether the total correction was enough, and only the
 * line history is independent of the corrections themselves.
 */

const SETTINGS = { ...DEFAULT_VALUE_SETTINGS, projection: { ...DEFAULT_PROJECTION_SETTINGS, league: "nfl" as const } }

describe("the dispersion a result implies", () => {
  /** n legs each predicted at p, of which a fraction actually won. */
  const legs = (n: number, p: number, winRate: number): Observation[] =>
    Array.from({ length: n }, (_, i) => ({ p, win: i < Math.round(n * winRate) }))

  it("asks for a wider spread when the model was too confident", () => {
    // Said 62%, hit 57%: the distribution was too narrow.
    const k = impliedDispersion(legs(200, 0.62, 0.57))!
    expect(k).toBeGreaterThan(1)
    // And a narrower one when it was too timid.
    expect(impliedDispersion(legs(200, 0.57, 0.62))!).toBeLessThan(1)
    // Dead right asks for no change at all.
    expect(impliedDispersion(legs(200, 0.6, 0.6))!).toBeCloseTo(1, 2)
  })

  it("never names a multiplier the dial cannot be set to", () => {
    // The headline example in calibration.ts — says 70%, hits 55% — inverts to
    // about 17x. Printing that under prose telling the user to move a slider
    // that stops at 1.8 is advice nobody can take, so it reports the limit.
    const extreme = impliedDispersion(legs(200, 0.7, 0.55))!
    expect(extreme).toBe(DISPERSION_DIAL_RANGE.max)
    const timid = impliedDispersion(legs(200, 0.55, 0.85))!
    expect(timid).toBe(DISPERSION_DIAL_RANGE.min)
  })

  it("solves over the legs rather than inverting their average", () => {
    // Phi^-1 of a mean is not the mean of Phi^-1, so a group holding a 55% leg
    // and an 85% leg does not behave like two 70% legs. Same mean prediction,
    // same hit rate, different answer — and the spread-out group is the one
    // the averaging shortcut got wrong.
    const tight = Array.from({ length: 200 }, (_, i) => ({ p: 0.7, win: i < 132 }))
    const spread = Array.from({ length: 200 }, (_, i) => ({ p: i % 2 ? 0.55 : 0.85, win: i < 132 }))
    const a = impliedDispersion(tight)!
    const b = impliedDispersion(spread)!
    expect(a).not.toBeCloseTo(b, 3)
  })

  it("refuses to answer on a thin sample", () => {
    expect(impliedDispersion(legs(24, 0.62, 0.57))).toBeNull()
    expect(impliedDispersion(legs(25, 0.62, 0.57))).not.toBeNull()
  })

  it("refuses a group sitting on a coin flip, where width says nothing", () => {
    // Every width gives 50% at the line, so there is nothing to invert.
    expect(impliedDispersion(legs(500, 0.5, 0.56))).toBeNull()
    expect(impliedDispersion(legs(500, 0.52, 0.5))).toBeNull()
    // A realised rate on the coin flip needs an infinite width to explain.
    expect(impliedDispersion(legs(500, 0.62, 0.5))).toBeNull()
  })

  it("refuses when the model had the wrong side, not the wrong width", () => {
    // Predicted 65% and it lost more often than not: no amount of widening
    // explains that, and a multiplier would invite the wrong fix.
    expect(impliedDispersion(legs(500, 0.65, 0.4))).toBeNull()
  })
})

describe("reading the same legs by competition and by market", () => {
  const obs = (n: number, p: number, winRate: number, extra: Partial<Observation>): Observation[] =>
    Array.from({ length: n }, (_, i) => ({ p, win: i < Math.round(n * winRate), ...extra }))

  it("splits one axis at a time, never a grid of five-leg cells", () => {
    const all = [
      ...obs(60, 0.62, 0.6, { competition: "nfl", market: "PASS_YDS" }),
      ...obs(40, 0.62, 0.55, { competition: "cfb", market: "RUSH_YDS" }),
    ]
    const byComp = groupedCalibration(all, (o) => (o.competition ? { key: o.competition, label: o.competition } : null))
    expect(byComp.map((r) => [r.key, r.count])).toEqual([
      ["nfl", 60],
      ["cfb", 40],
    ])
    // College came in under what was predicted, so it wants a wider spread.
    const cfb = byComp.find((r) => r.key === "cfb")!
    expect(cfb.bias).toBeGreaterThan(0)
    expect(cfb.impliedDispersion!).toBeGreaterThan(1)
    expect(cfb.dispersionPegged).toBe(true)
    // The NFL rows landed where they were predicted to, so nothing to change.
    const nfl = byComp.find((r) => r.key === "nfl")!
    expect(Math.abs(nfl.bias)).toBeLessThan(0.05)
  })

  it("puts legs logged before this was recorded in their own row", () => {
    // They cannot be classified even by inference: a leg keeps no game and no
    // start time, and the stat's sport cannot separate the NFL from college.
    const all = [...obs(30, 0.6, 0.6, { competition: "nfl" }), ...obs(30, 0.6, 0.5, {})]
    const rows = groupedCalibration(all, (o) => (o.competition ? { key: o.competition, label: o.competition } : null))
    const unrecorded = rows.find((r) => r.key === "unrecorded")!
    expect(unrecorded.count).toBe(30)
    expect(unrecorded.label).toContain("Before")
  })

  it("keeps a gap unhighlighted until it beats two standard errors", () => {
    const noisy = groupedCalibration(obs(12, 0.6, 0.42, { competition: "nfl" }), () => ({ key: "nfl", label: "NFL" }))
    expect(noisy[0].significant).toBe(false)
    expect(noisy[0].impliedDispersion).toBeNull()
  })
})

describe("line history", () => {
  const quote = (player: string, line: number, book: string, hoursOut: number, now: number): FeedQuote => ({
    book,
    line,
    overOdds: -110,
    underOdds: -110,
    fetchedAt: null,
    player,
    market: "PASS_YDS",
    gameId: "Bills@Chiefs",
    homeTeam: "Chiefs",
    awayTeam: "Bills",
    commenceTime: new Date(now + hoursOut * 3_600_000).toISOString(),
  })

  const pull = (line: number, hoursOut: number, now: number): LineSnapshot =>
    snapshotFor(
      "nfl",
      ["pinnacle", "draftkings", "fanduel"].map((b) => quote("Josh Allen", line, b, hoursOut, now)),
      SETTINGS,
      now,
      new Date(now).toISOString(),
    )

  it("compacts a pull to one row per prop, not one per book", () => {
    const now = Date.parse("2026-11-04T18:00:00Z")
    const quotes = [
      ...["pinnacle", "draftkings", "fanduel"].map((b) => quote("Josh Allen", 245.5, b, 96, now)),
      ...["pinnacle", "draftkings"].map((b) => quote("Patrick Mahomes", 268.5, b, 96, now)),
    ]
    const rows = snapshotRows(quotes, SETTINGS, now)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.books)).toEqual([3, 2])
    expect(rows[0].line).toBe(245.5)
    expect(rows[0].mean).toBeGreaterThan(230)
    expect(rows[0].hoursToStart).toBeCloseTo(96, 5)
    // Small enough that a season of pulls fits where one verbatim copy would not.
    expect(JSON.stringify(rows[0]).length).toBeLessThan(260)
  })

  it("leaves out a game that has already started", () => {
    // Its line now moves with the score, and pairing a pregame look against a
    // live one would measure the game rather than the market's revision.
    const now = Date.parse("2026-11-04T18:00:00Z")
    expect(pull(245.5, -2, now).rows).toEqual([])
    expect(pull(245.5, 0, now).rows).toEqual([])
    expect(pull(245.5, 1, now).rows).toHaveLength(1)
  })

  it("pairs the same prop seen days out and again near kick-off", () => {
    const now = Date.parse("2026-11-04T18:00:00Z")
    const moves = lineMoves([pull(245.5, 96, now), pull(258.5, 2, now + 94 * 3_600_000)])
    expect(moves).toHaveLength(1)
    expect(moves[0].delta).toBeCloseTo(13, 5)
    expect(moves[0].days).toBeCloseTo((96 - 2) / 24, 3)
  })

  it("will not pair the same two teams meeting again later in the season", () => {
    // A game id is two team names with no date, so a rematch shares the key.
    // Pairing them would report a season's drift as one game's final-day move.
    const now = Date.parse("2026-11-04T18:00:00Z")
    const rematch = Date.parse("2026-12-11T18:00:00Z")
    const moves = lineMoves([pull(245.5, 96, now), pull(268.5, 96, rematch)])
    expect(moves).toEqual([])
  })

  it("will not pair two looks taken minutes apart", () => {
    const now = Date.parse("2026-11-04T18:00:00Z")
    expect(lineMoves([pull(245.5, 96, now), pull(246.5, 95.99, now)])).toHaveLength(0)
  })

  it("measures variance per day in the same units as the prior it would replace", () => {
    const now = Date.parse("2026-11-04T18:00:00Z")
    // Ten props, each moving a different amount over four days.
    const snaps: LineSnapshot[] = []
    const early: FeedQuote[] = []
    const late: FeedQuote[] = []
    for (let i = 0; i < 10; i++) {
      const move = (i - 4.5) * 6
      for (const b of ["pinnacle", "draftkings", "fanduel"]) {
        early.push({ ...quote(`Passer ${i}`, 245.5, b, 96, now), gameId: `Away${i}@Home${i}` })
        late.push({ ...quote(`Passer ${i}`, 245.5 + move, b, 2, now + 94 * 3_600_000), gameId: `Away${i}@Home${i}` })
      }
    }
    snaps.push(snapshotFor("nfl", early, SETTINGS, now, new Date(now).toISOString()))
    snaps.push(snapshotFor("nfl", late, SETTINGS, now + 94 * 3_600_000, new Date(now + 94 * 3_600_000).toISOString()))

    const fits = fitMovement(lineMoves(snaps))
    expect(fits).toHaveLength(1)
    const [fit] = fits
    expect(fit.market).toBe("PASS_YDS")
    expect(fit.pairs).toBe(10)
    expect(fit.sd).toBeGreaterThan(10)
    // Comparable with the 4%/day prior: a plain fraction of the outcome's own
    // variance, per day.
    expect(fit.variancePerDay).not.toBeNull()
    expect(fit.variancePerDay!).toBeGreaterThan(0)
    expect(KICKOFF_VARIANCE_PER_DAY).toBe(0.04)
  })

  it("says nothing on a sample too thin to say anything with", () => {
    const now = Date.parse("2026-11-04T18:00:00Z")
    expect(fitMovement(lineMoves([pull(245.5, 96, now), pull(258.5, 2, now)]))).toEqual([])
  })

  it("counts what it has, so an empty readout reads as empty rather than broken", () => {
    const now = Date.parse("2026-11-04T18:00:00Z")
    expect(summariseHistory([])).toEqual({ snapshots: 0, props: 0, paired: 0, widestDays: 0 })
    const one = summariseHistory([pull(245.5, 96, now)])
    expect(one).toMatchObject({ snapshots: 1, props: 1, paired: 0 })
  })
})

describe("the line history cannot grow without bound", () => {
  it("prunes to the cap on load, where it cannot be skipped", () => {
    const many = Array.from({ length: MAX_LINE_SNAPSHOTS + 10 }, (_, i) => ({
      pulledAt: `2026-11-${String(i + 1).padStart(2, "0")}T18:00:00Z`,
      league: "nfl",
      rows: [],
    }))
    const migrated = migrate({ version: 1, settings: {}, slips: [], daily: {}, lines: many })
    expect(migrated.lines).toHaveLength(MAX_LINE_SNAPSHOTS)
    // Newest kept.
    expect(migrated.lines[0].pulledAt > migrated.lines[1].pulledAt).toBe(true)
  })

  it("drops a row the readouts would crash on, because an import is arbitrary JSON", () => {
    // fitMovement indexes the market table by the row's market, and importState
    // runs a hand-edited file straight through migrate.
    const migrated = migrate({
      version: 1,
      lines: [
        {
          pulledAt: "2026-11-03T18:00:00Z",
          league: "nfl",
          rows: [
            { key: "a|PASS_YDS", player: "A", market: "PASS_YDS", line: 245.5, hoursToStart: 96, mean: 245, books: 3 },
            { key: "b|NOPE", player: "B", market: "NOT_A_MARKET", line: 10, hoursToStart: 2, mean: null, books: 1 },
            { key: "", player: "C", market: "PASS_YDS", line: 10, hoursToStart: 2, mean: null, books: 1 },
            { player: "D", market: "PASS_YDS", line: 10 },
            { key: "e|PASS_YDS", player: "E", market: "PASS_YDS", line: "245.5" },
            null,
          ],
        },
      ],
    })
    expect(migrated.lines[0].rows.map((r) => r.key)).toEqual(["a|PASS_YDS"])
  })

  it("drops junk rather than trusting stored shapes", () => {
    const migrated = migrate({
      version: 1,
      lines: [
        { pulledAt: "nope", league: "nfl", rows: [] },
        { pulledAt: "2026-11-01T18:00:00Z", league: "wnba", rows: [] },
        { pulledAt: "2026-11-02T18:00:00Z", league: "nfl", rows: "not an array" },
        { pulledAt: "2026-11-03T18:00:00Z", league: "nfl", rows: [] },
      ],
    })
    expect(migrated.lines.map((l) => l.pulledAt)).toEqual(["2026-11-03T18:00:00Z"])
    expect(migrate({ version: 1 }).lines).toEqual([])
  })
})
