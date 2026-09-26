import { describe, expect, it } from "vitest"
import {
  countDistribution,
  meanImpliedByLine,
  normalDistribution,
  resolveLine,
} from "@/lib/quant/distributions"
import { distributionFor } from "@/lib/nba/markets"

describe("countDistribution", () => {
  it("chooses Poisson when variance equals the mean", () => {
    const d = countDistribution(3, 3)
    expect(d.family).toBe("poisson")
    // Poisson(3): P(X=0) = e^-3
    expect(d.pmf(0)).toBeCloseTo(Math.exp(-3), 8)
    expect(d.pmf(3)).toBeCloseTo((Math.exp(-3) * 27) / 6, 8)
  })

  it("chooses a negative binomial when overdispersed", () => {
    const d = countDistribution(25, 65)
    expect(d.family).toBe("negbin")
    expect(d.sd).toBeCloseTo(Math.sqrt(65), 6)
  })

  it("chooses a binomial when underdispersed", () => {
    const d = countDistribution(4, 2)
    expect(d.family).toBe("binomial")
  })

  it("has a pmf that sums to one and a matching mean", () => {
    for (const [m, v] of [[1, 1], [3, 3.5], [25, 65], [8, 10]]) {
      const d = countDistribution(m, v)
      let total = 0
      let em = 0
      for (let k = 0; k <= d.support; k++) {
        total += d.pmf(k)
        em += k * d.pmf(k)
      }
      expect(total).toBeCloseTo(1, 8)
      expect(em).toBeCloseTo(m, 3)
    }
  })

  it("keeps cdf and pAtLeast complementary", () => {
    const d = countDistribution(10, 14)
    for (const k of [0, 3, 10, 18]) {
      expect(d.cdf(k) + d.pAtLeast(k + 1)).toBeCloseTo(1, 8)
    }
  })
})

describe("resolveLine", () => {
  it("never pushes on a half-point line", () => {
    const d = countDistribution(24, 60)
    const r = resolveLine(d, 24.5)
    expect(r.push).toBe(0)
    expect(r.over + r.under).toBeCloseTo(1, 10)
    expect(r.over).toBeCloseTo(d.pAtLeast(25), 12)
  })

  it("prices the push on a whole-number line", () => {
    const d = countDistribution(6, 7)
    const r = resolveLine(d, 6)
    expect(r.push).toBeCloseTo(d.pmf(6), 12)
    expect(r.push).toBeGreaterThan(0.05)
    expect(r.over + r.under + r.push).toBeCloseTo(1, 10)
    // Over 6 means 7 or more, not 6 or more.
    expect(r.over).toBeCloseTo(d.pAtLeast(7), 12)
  })

  it("treats a low-mean line the way a Poisson should", () => {
    // Blocks projected at 0.8 against a 0.5 line: over needs at least one block.
    const d = countDistribution(0.8, 0.92)
    const r = resolveLine(d, 0.5)
    expect(r.over).toBeCloseTo(1 - d.pmf(0), 10)
    expect(r.over).toBeGreaterThan(0.5)
    expect(r.over).toBeLessThan(0.62)
  })
})

describe("meanImpliedByLine", () => {
  it("recovers the mean that produced a probability", () => {
    const build = (m: number) => countDistribution(m, m * 2.6)
    const trueMean = 26.4
    const p = resolveLine(build(trueMean), 24.5).over
    expect(meanImpliedByLine(24.5, p, build)).toBeCloseTo(trueMean, 2)
  })

  it("returns roughly the line when the market is a coin flip", () => {
    const build = (m: number) => distributionFor("PTS", m)
    const m = meanImpliedByLine(24.5, 0.5, build)
    expect(m).toBeGreaterThan(23.5)
    expect(m).toBeLessThan(25.5)
  })

  it("moves the implied mean up when the over is favoured", () => {
    const build = (m: number) => distributionFor("PTS", m)
    const low = meanImpliedByLine(24.5, 0.45, build)
    const high = meanImpliedByLine(24.5, 0.62, build)
    expect(high).toBeGreaterThan(low)
  })
})

describe("normalDistribution", () => {
  it("integrates to one over its support", () => {
    const d = normalDistribution(30, 36)
    let total = 0
    for (let k = 0; k <= d.support; k++) total += d.pmf(k)
    expect(total).toBeCloseTo(1, 6)
  })
})
