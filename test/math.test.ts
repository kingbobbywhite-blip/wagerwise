import { describe, expect, it } from "vitest"
import { bisect, logGamma, normalCdf, normalInvCdf, makeRng } from "@/lib/quant/math"

describe("normalCdf", () => {
  it("matches known values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 12)
    expect(normalCdf(1)).toBeCloseTo(0.8413447460685429, 10)
    expect(normalCdf(-1)).toBeCloseTo(0.15865525393145707, 10)
    expect(normalCdf(1.959963984540054)).toBeCloseTo(0.975, 9)
    expect(normalCdf(-3)).toBeCloseTo(0.0013498980316301, 10)
  })

  it("stays accurate deep in the tail", () => {
    // Assert RELATIVE accuracy: the absolute value is ~1e-9, so an absolute
    // tolerance would be meaningless here.
    const expected = 9.865876450376946e-10
    const relErr = Math.abs(normalCdf(-6) - expected) / expected
    expect(relErr).toBeLessThan(1e-8)
    // At z=8 the true value is 1 - 6.2e-16, which is at the edge of double
    // precision, so we assert it is indistinguishable from 1 rather than equal.
    expect(1 - normalCdf(8)).toBeLessThan(1e-14)
    expect(normalCdf(-40)).toBe(0)
  })
})

describe("normalInvCdf", () => {
  it("inverts normalCdf", () => {
    for (const p of [0.001, 0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 0.999]) {
      expect(normalCdf(normalInvCdf(p))).toBeCloseTo(p, 12)
    }
  })
  it("matches standard quantiles", () => {
    expect(normalInvCdf(0.975)).toBeCloseTo(1.959963984540054, 9)
    expect(normalInvCdf(0.5)).toBeCloseTo(0, 12)
  })
})

describe("logGamma", () => {
  it("reproduces factorials", () => {
    expect(Math.exp(logGamma(5))).toBeCloseTo(24, 8)
    expect(Math.exp(logGamma(11))).toBeCloseTo(3628800, 2)
  })
})

describe("bisect", () => {
  it("finds a root of a monotone function", () => {
    expect(bisect((x) => x * x - 2, 0, 5)).toBeCloseTo(Math.SQRT2, 9)
  })
  it("returns the closer endpoint when the bracket does not straddle zero", () => {
    expect(bisect((x) => x + 10, 0, 5)).toBe(0)
  })
})

describe("makeRng", () => {
  it("is deterministic for a fixed seed", () => {
    const a = makeRng(42)
    const b = makeRng(42)
    for (let i = 0; i < 20; i++) expect(a()).toBe(b())
  })
  it("produces values in [0,1)", () => {
    const r = makeRng(7)
    for (let i = 0; i < 5000; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
