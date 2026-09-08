import { describe, expect, it } from "vitest"
import { estimateFromGameLog, parseGameLog, projectMinutes, type GameLogEntry } from "@/lib/quant/gamelog"

const steady: GameLogEntry[] = Array.from({ length: 20 }, () => ({ value: 20, minutes: 32 }))
const volatile: GameLogEntry[] = [8, 34, 12, 29, 9, 31, 14, 27, 11, 33, 15, 25, 10, 30, 13, 28, 16, 24, 18, 22].map(
  (v) => ({ value: v, minutes: 32 }),
)

describe("parseGameLog", () => {
  it("reads comma, space and pipe separated values", () => {
    expect(parseGameLog("24, 18, 31")).toEqual([24, 18, 31])
    expect(parseGameLog("24 18 31")).toEqual([24, 18, 31])
    expect(parseGameLog("[24,18,31]")).toEqual([24, 18, 31])
  })
  it("passes arrays through and drops junk", () => {
    expect(parseGameLog([1, 2, NaN, 3])).toEqual([1, 2, 3])
    expect(parseGameLog("")).toEqual([])
    expect(parseGameLog(null)).toEqual([])
  })
})

describe("projectMinutes", () => {
  const log: GameLogEntry[] = Array.from({ length: 12 }, () => ({ value: 20, minutes: 32 }))

  it("uses an explicit forecast when given", () => {
    expect(projectMinutes(log, { projectedMinutes: 38 }).minutes).toBe(38)
  })

  it("trims minutes on a back-to-back", () => {
    expect(projectMinutes(log, { restDays: 0 }).minutes!).toBeCloseTo(30.5, 6)
  })

  it("adds minutes on extended rest", () => {
    expect(projectMinutes(log, { restDays: 3 }).minutes!).toBeCloseTo(32.5, 6)
  })

  it("raises minutes when team-mates are out", () => {
    expect(projectMinutes(log, { teammatesOut: 2 }).minutes!).toBeCloseTo(36, 6)
  })

  it("caps the absence bump so it cannot run away", () => {
    expect(projectMinutes(log, { teammatesOut: 9 }).minutes!).toBeCloseTo(38, 6)
  })

  it("keeps minutes inside a plausible range", () => {
    expect(projectMinutes(log, { projectedMinutes: 55 }).minutes).toBe(55) // explicit wins
    expect(projectMinutes(log, { teammatesOut: 5, restDays: 3 }).minutes!).toBeLessThanOrEqual(42)
  })

  it("reports when there are no minutes to work from", () => {
    const r = projectMinutes([{ value: 10 }, { value: 12 }], {})
    expect(r.minutes).toBeNull()
    expect(r.notes.join(" ")).toMatch(/No minutes/)
  })
})

describe("estimateFromGameLog", () => {
  it("refuses to work from a log that is too short", () => {
    expect(estimateFromGameLog([{ value: 20 }, { value: 22 }])).toBeNull()
  })

  it("separates a steady player from a volatile one at the same average", () => {
    const a = estimateFromGameLog(steady, {}, 2.6)!
    const b = estimateFromGameLog(volatile, {}, 2.6)!
    expect(a.mean).toBeCloseTo(b.mean, 0)
    // This is the entire point: identical averages, very different bets.
    expect(b.sd).toBeGreaterThan(a.sd * 1.5)
  })

  it("floors an implausibly tight spread at the market prior", () => {
    // A perfectly flat log has zero observed variance, which would imply
    // certainty. It must be widened toward how the market actually behaves.
    const e = estimateFromGameLog(steady, {}, 2.6)!
    expect(e.variance).toBeGreaterThan(0)
    expect(e.sd).toBeGreaterThan(5)
    expect(e.notes.join(" ")).toMatch(/widened toward the prior/)
  })

  it("widens the spread further for a short log", () => {
    const short = estimateFromGameLog(volatile.slice(0, 5), {}, 2.6)!
    const long = estimateFromGameLog(volatile, {}, 2.6)!
    expect(short.dispersion).toBeGreaterThan(long.dispersion)
    expect(short.notes.join(" ")).toMatch(/5 games/)
  })

  it("rebuilds the projection from a per-minute rate", () => {
    const log: GameLogEntry[] = Array.from({ length: 15 }, () => ({ value: 20, minutes: 30 }))
    const e = estimateFromGameLog(log, { projectedMinutes: 36 }, 2.6)!
    expect(e.perMinute).toBeCloseTo(20 / 30, 6)
    // 0.667 per minute across 36 minutes is 24, not the 20 season average.
    expect(e.mean).toBeCloseTo(24, 4)
    expect(e.projectedMinutes).toBe(36)
  })

  it("scales the projection down when minutes are cut", () => {
    const log: GameLogEntry[] = Array.from({ length: 15 }, () => ({ value: 20, minutes: 34 }))
    const e = estimateFromGameLog(log, { projectedMinutes: 24 }, 2.6)!
    expect(e.mean).toBeLessThan(15)
  })

  it("weights recent games more heavily", () => {
    // Newest first: a player whose role just expanded.
    const rising: GameLogEntry[] = [30, 29, 31, 28, 12, 11, 13, 10, 12, 11].map((v) => ({ value: v, minutes: 30 }))
    const e = estimateFromGameLog(rising, {}, 2.6)!
    const flatAverage = rising.reduce((a, g) => a + g.value, 0) / rising.length
    expect(e.mean).toBeGreaterThan(flatAverage)
  })

  it("applies a manual usage bump", () => {
    const base = estimateFromGameLog(steady, {}, 2.6)!
    const bumped = estimateFromGameLog(steady, { usageBump: 0.1 }, 2.6)!
    expect(bumped.mean).toBeCloseTo(base.mean * 1.1, 6)
  })

  it("combines rest and absences into the minutes forecast", () => {
    const e = estimateFromGameLog(steady, { restDays: 0, teammatesOut: 2 }, 2.6)!
    // 32 minus 1.5 for the back-to-back, plus 4 for two players out.
    expect(e.projectedMinutes).toBeCloseTo(34.5, 6)
    expect(e.notes.join(" ")).toMatch(/Back-to-back/)
    expect(e.notes.join(" ")).toMatch(/out: minutes raised/)
  })
})
