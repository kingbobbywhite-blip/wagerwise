import { describe, expect, it } from "vitest"
import { distributionFor, MARKETS, normalizeMarket } from "@/lib/nba/markets"

describe("normalizeMarket", () => {
  it("maps the obvious names", () => {
    expect(normalizeMarket("Points").key).toBe("PTS")
    expect(normalizeMarket("pts").key).toBe("PTS")
    expect(normalizeMarket("Rebounds").key).toBe("REB")
    expect(normalizeMarket("AST").key).toBe("AST")
    expect(normalizeMarket("3-Pointers Made").key).toBe("3PM")
    expect(normalizeMarket("Blocks").key).toBe("BLK")
  })

  it("does NOT collapse combo markets into points", () => {
    // The previous implementation matched the alias "pts" as a prefix of
    // "pts+reb+ast" and silently turned every combo prop into Points.
    expect(normalizeMarket("Pts+Reb+Ast").key).toBe("PRA")
    expect(normalizeMarket("pts+reb+ast").key).toBe("PRA")
    expect(normalizeMarket("Points+Rebounds+Assists").key).toBe("PRA")
    expect(normalizeMarket("P+R+A").key).toBe("PRA")
    expect(normalizeMarket("Pts+Reb").key).toBe("PR")
    expect(normalizeMarket("Pts+Ast").key).toBe("PA")
    expect(normalizeMarket("Reb+Ast").key).toBe("RA")
  })

  it("separates steals, blocks and their combination", () => {
    expect(normalizeMarket("Steals").key).toBe("STL")
    expect(normalizeMarket("Blocks").key).toBe("BLK")
    expect(normalizeMarket("Steals+Blocks").key).toBe("STL_BLK")
    expect(normalizeMarket("Stocks").key).toBe("STL_BLK")
  })

  it("strips over/under decoration and numbers", () => {
    expect(normalizeMarket("Player Points Over/Under 24.5").key).toBe("PTS")
    expect(normalizeMarket("NBA Rebounds O/U").key).toBe("REB")
  })

  it("returns null for genuinely unknown markets instead of guessing", () => {
    const r = normalizeMarket("First Basket Scorer")
    expect(r.key).toBeNull()
    expect(r.label).toBe("First Basket Scorer")
  })

  it("handles empty input", () => {
    expect(normalizeMarket("").key).toBeNull()
  })
})

describe("distributionFor", () => {
  it("gives points a realistic game-to-game spread", () => {
    // A 25 ppg NBA player has a standard deviation near 8.
    const d = distributionFor("PTS", 25)
    expect(d.sd).toBeGreaterThan(7)
    expect(d.sd).toBeLessThan(9)
  })

  it("gives rebounds a tighter spread than points at the same mean", () => {
    expect(distributionFor("REB", 10).sd).toBeLessThan(distributionFor("PTS", 10).sd)
  })

  it("widens outcomes toward a coin flip when dispersion is inflated", () => {
    const tight = distributionFor("PTS", 27, { global: 1 })
    const wide = distributionFor("PTS", 27, { global: 3 })
    const pTight = tight.pAtLeast(25)
    const pWide = wide.pAtLeast(25)
    expect(pTight).toBeGreaterThan(pWide)
    expect(pWide).toBeGreaterThan(0.5)
  })

  it("covers every declared market", () => {
    for (const key of Object.keys(MARKETS) as (keyof typeof MARKETS)[]) {
      const d = distributionFor(key, MARKETS[key].typicalMean)
      expect(Number.isFinite(d.sd)).toBe(true)
      expect(d.sd).toBeGreaterThan(0)
    }
  })
})
