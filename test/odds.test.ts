import { describe, expect, it } from "vitest"
import {
  americanToDecimal,
  americanToProb,
  breakEvenProb,
  decimalToAmerican,
  devig,
  fairTwoWay,
  parlayAmerican,
  probToAmerican,
} from "@/lib/quant/odds"

describe("conversions", () => {
  it("converts American to decimal", () => {
    expect(americanToDecimal(100)).toBeCloseTo(2, 12)
    expect(americanToDecimal(-110)).toBeCloseTo(1.9090909, 6)
    expect(americanToDecimal(250)).toBeCloseTo(3.5, 12)
  })
  it("round-trips through decimal", () => {
    for (const a of [-500, -250, -110, -101, 100, 145, 900]) {
      expect(decimalToAmerican(americanToDecimal(a))).toBe(a)
    }
  })
  it("computes implied probability with the vig still in it", () => {
    expect(americanToProb(-110)).toBeCloseTo(0.5238095, 6)
    expect(americanToProb(100)).toBeCloseTo(0.5, 12)
  })
  it("round-trips probability to price", () => {
    for (const p of [0.35, 0.5, 0.62, 0.8]) {
      expect(americanToProb(probToAmerican(p))).toBeCloseTo(p, 2)
    }
  })
})

describe("devig", () => {
  const raw = [americanToProb(-110), americanToProb(-110)]

  it("always returns probabilities summing to one", () => {
    for (const m of ["multiplicative", "additive", "power", "shin"] as const) {
      const out = devig(raw, m)
      expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
    }
  })

  it("gives 50/50 on a symmetric market", () => {
    for (const m of ["multiplicative", "additive", "power", "shin"] as const) {
      const out = devig(raw, m)
      expect(out[0]).toBeCloseTo(0.5, 8)
    }
  })

  it("shades the favourite up and the longshot down relative to proportional", () => {
    const skewed = [americanToProb(-300), americanToProb(240)]
    const prop = devig(skewed, "multiplicative")
    const power = devig(skewed, "power")
    const shin = devig(skewed, "shin")
    // Power and Shin both take probability away from the longshot.
    expect(power[1]).toBeLessThan(prop[1])
    expect(shin[1]).toBeLessThan(prop[1])
  })

  it("leaves a fair market untouched", () => {
    const fair = [0.4, 0.6]
    expect(devig(fair, "power")[0]).toBeCloseTo(0.4, 9)
  })
})

describe("fairTwoWay", () => {
  it("measures the hold on a standard -110/-110 market", () => {
    const f = fairTwoWay(-110, -110, "power")!
    expect(f.pOver).toBeCloseTo(0.5, 8)
    expect(f.holdPct).toBeCloseTo(4.7619, 3)
  })

  it("removes the vig from an asymmetric market", () => {
    const f = fairTwoWay(-140, 120, "power")!
    expect(f.pOver + f.pUnder).toBeCloseTo(1, 10)
    // The raw implied over probability is 58.3%; fair must be lower.
    expect(f.pOver).toBeLessThan(americanToProb(-140))
    expect(f.pOver).toBeGreaterThan(0.5)
  })

  it("falls back to an assumed hold when only one side is priced", () => {
    const f = fairTwoWay(-110, null, "power", 4.5)!
    expect(f.pOver).toBeLessThan(americanToProb(-110))
    expect(f.pOver + f.pUnder).toBeCloseTo(1, 10)
  })

  it("returns null with no prices at all", () => {
    expect(fairTwoWay(null, null)).toBeNull()
  })
})

describe("parlay math", () => {
  it("prices a two-leg -110 parlay at about +264", () => {
    expect(parlayAmerican([-110, -110])).toBe(264)
  })
  it("break-even probability is the reciprocal of decimal odds", () => {
    expect(breakEvenProb(-110)).toBeCloseTo(0.5238095, 6)
    expect(breakEvenProb(100)).toBeCloseTo(0.5, 12)
  })
})
