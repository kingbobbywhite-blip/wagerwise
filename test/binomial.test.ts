import { describe, expect, it } from "vitest"
import { binomialDistribution, binomialPmf, choose, logChoose } from "@/lib/quant/binomial"
import { breakEvenLegProb, evAtLegProb, expectedMultipleAtLegProb, DEFAULT_APPS, findApp, findMode } from "@/lib/quant/payouts"

describe("binomial helpers", () => {
  it("computes choose correctly", () => {
    expect(choose(5, 0)).toBe(1)
    expect(choose(5, 2)).toBe(10)
    expect(choose(5, 5)).toBe(1)
    expect(choose(6, 3)).toBe(20)
    expect(choose(5, 6)).toBe(0)
  })

  it("has a pmf that sums to one", () => {
    for (const p of [0.1, 0.5, 0.62, 0.9]) {
      const d = binomialDistribution(6, p)
      expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
    }
  })

  it("matches hand-computed values", () => {
    // C(4,2) * 0.5^2 * 0.5^2 = 6/16
    expect(binomialPmf(4, 2, 0.5)).toBeCloseTo(0.375, 12)
    expect(binomialPmf(4, 4, 0.6)).toBeCloseTo(0.1296, 12)
  })

  it("handles degenerate probabilities", () => {
    expect(binomialPmf(3, 0, 0)).toBe(1)
    expect(binomialPmf(3, 3, 1)).toBe(1)
    expect(binomialPmf(3, 1, 0)).toBe(0)
    expect(logChoose(3, 4)).toBe(-Infinity)
  })
})

describe("expectedMultipleAtLegProb", () => {
  const power = findMode(findApp(DEFAULT_APPS, "prizepicks"), "power")!
  const flex = findMode(findApp(DEFAULT_APPS, "prizepicks"), "flex")!

  it("reduces to p^n * M on an all-or-nothing table", () => {
    expect(expectedMultipleAtLegProb(power, 4, 0.6)).toBeCloseTo(Math.pow(0.6, 4) * 10, 10)
  })

  it("sums every paying tier on a flex table", () => {
    // 5-pick flex: 10x / 2x / 0.4x at 5, 4 and 3 correct.
    const p = 0.5
    const expected =
      binomialPmf(5, 5, p) * 10 + binomialPmf(5, 4, p) * 2 + binomialPmf(5, 3, p) * 0.4
    expect(expectedMultipleAtLegProb(flex, 5, p)).toBeCloseTo(expected, 12)
    expect(expectedMultipleAtLegProb(flex, 5, 0.5)).toBeCloseTo(0.75, 10)
  })

  it("is monotone increasing in the leg probability", () => {
    let prev = -1
    for (const p of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const v = expectedMultipleAtLegProb(flex, 5, p)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })
})

describe("breakEvenLegProb", () => {
  const power = findMode(findApp(DEFAULT_APPS, "prizepicks"), "power")!
  const flex = findMode(findApp(DEFAULT_APPS, "prizepicks"), "flex")!

  it("still matches the closed form on all-or-nothing tables", () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const mult = power.table[n][n]
      expect(breakEvenLegProb(power, n)!).toBeCloseTo(Math.pow(1 / mult, 1 / n), 8)
    }
  })

  it("returns a far lower bar on a flex table than the all-hit shortcut", () => {
    const be = breakEvenLegProb(flex, 5)!
    // The naive all-hit shortcut would say 10^(-1/5) = 63.1%.
    expect(Math.pow(1 / 10, 1 / 5)).toBeCloseTo(0.631, 3)
    expect(be).toBeCloseTo(0.543, 2)
    expect(be).toBeLessThan(0.56)
  })

  it("is the probability at which expected value is exactly zero", () => {
    for (const [mode, picks] of [[power, 4], [flex, 4], [flex, 5], [flex, 6]] as const) {
      const be = breakEvenLegProb(mode, picks)
      if (be == null) continue
      expect(evAtLegProb(mode, picks, be)).toBeCloseTo(0, 8)
      expect(evAtLegProb(mode, picks, be + 0.02)).toBeGreaterThan(0)
      expect(evAtLegProb(mode, picks, be - 0.02)).toBeLessThan(0)
    }
  })

  it("returns null for an entry size the table does not offer", () => {
    expect(breakEvenLegProb(power, 7)).toBeNull()
  })

  it("returns null when even a perfect card cannot return the stake", () => {
    const broken = { id: "x", label: "x", blurb: "", table: { 3: { 3: 0.5 } } }
    expect(breakEvenLegProb(broken, 3)).toBeNull()
  })
})
