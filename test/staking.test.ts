import { describe, expect, it } from "vitest"
import { recommendStake } from "@/lib/quant/staking"
import { DEFAULT_BANKROLL } from "@/lib/store/schema"

const b = { ...DEFAULT_BANKROLL, bankroll: 1000, unitSize: 10, kellyFraction: 0.25, maxStakePct: 0.02 }

describe("recommendStake", () => {
  it("stakes nothing without an edge", () => {
    const a = recommendStake(0, b)
    expect(a.stake).toBe(0)
    expect(a.limitedBy).toBe("no-edge")
  })

  it("stakes nothing on a negative Kelly fraction", () => {
    expect(recommendStake(-0.1, b).stake).toBe(0)
  })

  it("applies the Kelly fraction", () => {
    // 4% full Kelly on a 1000 bankroll, quartered, is 10.
    const a = recommendStake(0.04, b)
    expect(a.stake).toBeCloseTo(10, 6)
    expect(a.units).toBeCloseTo(1, 6)
    expect(a.limitedBy).toBe("kelly")
  })

  it("respects the hard bankroll cap", () => {
    // 40% full Kelly quartered is 10% of bankroll, well over the 2% cap.
    const a = recommendStake(0.4, b)
    expect(a.stake).toBeCloseTo(20, 6)
    expect(a.limitedBy).toBe("bankroll-cap")
  })

  it("never exceeds the cap regardless of edge", () => {
    for (const k of [0.05, 0.5, 0.99]) {
      expect(recommendStake(k, b).stake).toBeLessThanOrEqual(b.bankroll * b.maxStakePct + 1e-9)
    }
  })
})
