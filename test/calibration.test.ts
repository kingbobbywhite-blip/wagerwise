import { describe, expect, it } from "vitest"
import { brierScore, calibrationBias, calibrationBuckets, logLoss, summarise } from "@/lib/quant/calibration"

function obs(p: number, wins: number, total: number) {
  return Array.from({ length: total }, (_, i) => ({ p, win: i < wins }))
}

describe("calibrationBuckets", () => {
  it("reports predicted against actual per bucket", () => {
    const b = calibrationBuckets([...obs(0.62, 62, 100), ...obs(0.72, 50, 100)])
    const mid = b.find((x) => x.lo === 0.6 && x.hi === 0.65)!
    expect(mid.count).toBe(100)
    expect(mid.predicted).toBeCloseTo(0.62, 8)
    expect(mid.actual).toBeCloseTo(0.62, 8)

    const high = b.find((x) => x.lo === 0.7 && x.hi === 1.01)!
    expect(high.actual).toBeCloseTo(0.5, 8)
    expect(high.predicted).toBeCloseTo(0.72, 8)
  })

  it("returns empty buckets without dividing by zero", () => {
    const b = calibrationBuckets([])
    expect(b.every((x) => x.count === 0 && Number.isFinite(x.actual))).toBe(true)
  })

  it("gives a standard error that shrinks with sample size", () => {
    const small = calibrationBuckets(obs(0.6, 6, 10)).find((x) => x.count > 0)!
    const large = calibrationBuckets(obs(0.6, 600, 1000)).find((x) => x.count > 0)!
    expect(large.stderr).toBeLessThan(small.stderr)
  })
})

describe("scoring rules", () => {
  it("scores a perfect forecaster at zero", () => {
    expect(brierScore([{ p: 1, win: true }, { p: 0, win: false }])).toBeCloseTo(0, 10)
  })

  it("scores a coin flip at 0.25", () => {
    expect(brierScore([{ p: 0.5, win: true }, { p: 0.5, win: false }])).toBeCloseTo(0.25, 10)
  })

  it("punishes confident mistakes in log loss", () => {
    const confidentWrong = logLoss([{ p: 0.99, win: false }])!
    const unsureWrong = logLoss([{ p: 0.55, win: false }])!
    expect(confidentWrong).toBeGreaterThan(unsureWrong * 3)
  })

  it("returns null with no observations", () => {
    expect(brierScore([])).toBeNull()
    expect(logLoss([])).toBeNull()
    expect(calibrationBias([])).toBeNull()
  })
})

describe("calibrationBias", () => {
  it("is zero for a well-calibrated model", () => {
    expect(calibrationBias(obs(0.6, 60, 100))!).toBeCloseTo(0, 8)
  })
  it("is positive when the model is overconfident", () => {
    expect(calibrationBias(obs(0.7, 50, 100))!).toBeCloseTo(0.2, 8)
  })
  it("is negative when the model is underconfident", () => {
    expect(calibrationBias(obs(0.55, 70, 100))!).toBeCloseTo(-0.15, 8)
  })
})

describe("summarise", () => {
  it("ignores pending entries when computing return on investment", () => {
    const p = summarise([
      { stake: 10, actualMultiple: 5, evAtEntry: 0.1, status: "SETTLED" },
      { stake: 10, actualMultiple: 0, evAtEntry: 0.1, status: "SETTLED" },
      { stake: 10, actualMultiple: null, evAtEntry: 0.1, status: "PENDING" },
    ])
    expect(p.entries).toBe(3)
    expect(p.settled).toBe(2)
    expect(p.staked).toBe(20)
    expect(p.returned).toBe(50)
    expect(p.profit).toBe(30)
    expect(p.roi).toBeCloseTo(1.5, 8)
    expect(p.expectedRoi).toBeCloseTo(0.1, 8)
    expect(p.wins).toBe(1)
    expect(p.losses).toBe(1)
  })

  it("returns null return on investment before anything settles", () => {
    expect(summarise([{ stake: 10, actualMultiple: null, evAtEntry: 0.1, status: "PENDING" }]).roi).toBeNull()
  })
})
