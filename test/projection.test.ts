import { describe, expect, it } from "vitest"
import { DEFAULT_PROJECTION_SETTINGS, parseHitRate, projectProp, projectSlate, type RawPropRow } from "@/lib/quant/projection"

const base: RawPropRow = { player: "Anthony Edwards", market: "Points", line: 24.5 }

describe("parseHitRate", () => {
  it("reads fractions and keeps the sample size", () => {
    expect(parseHitRate("7/10")).toEqual({ rate: 0.7, sample: 10 })
    expect(parseHitRate("13/20")).toEqual({ rate: 0.65, sample: 20 })
  })
  it("reads percentages with no sample size", () => {
    expect(parseHitRate("70%")).toEqual({ rate: 0.7, sample: 0 })
    expect(parseHitRate(0.62)).toEqual({ rate: 0.62, sample: 0 })
    expect(parseHitRate(62)).toEqual({ rate: 0.62, sample: 0 })
  })
  it("rejects junk", () => {
    expect(parseHitRate(null)).toBeNull()
    expect(parseHitRate("")).toBeNull()
    expect(parseHitRate("n/a")).toBeNull()
  })
})

describe("projectProp", () => {
  it("returns null when there is nothing to project from", () => {
    // A line on its own is not information. Manufacturing a 50/50 here would
    // hand the optimizer fake legs.
    expect(projectProp(base)).toBeNull()
  })

  it("prices a symmetric two-way market at about a coin flip", () => {
    const p = projectProp({ ...base, overOdds: -110, underOdds: -110 })!
    expect(p.pOver).toBeGreaterThan(0.45)
    expect(p.pOver).toBeLessThan(0.55)
    expect(p.holdPct).toBeCloseTo(4.7619, 3)
    expect(p.sources).toContain("market")
  })

  it("finds value when the DFS line is softer than the book line", () => {
    // The book has him at 25.5 as a coin flip; the app is offering 23.5.
    const p = projectProp({ ...base, line: 23.5, bookLine: 25.5, overOdds: -110, underOdds: -110 })!
    expect(p.side).toBe("OVER")
    expect(p.pWin).toBeGreaterThan(0.55)
    expect(p.lineEdge).toBeGreaterThan(1.5)
  })

  it("finds the under when the DFS line is inflated", () => {
    const p = projectProp({ ...base, line: 27.5, bookLine: 25.5, overOdds: -110, underOdds: -110 })!
    expect(p.side).toBe("UNDER")
    expect(p.pWin).toBeGreaterThan(0.55)
  })

  it("prices a whole-number line with a real push probability", () => {
    const p = projectProp({ player: "Rudy Gobert", market: "Blocks", line: 1, projection: 1.4 })!
    expect(p.pPush).toBeGreaterThan(0.15)
    expect(p.pOver + p.pUnder + p.pPush).toBeCloseTo(1, 6)
  })

  it("is less confident without a market price", () => {
    const withMarket = projectProp({ ...base, overOdds: -110, underOdds: -110 })!
    const formOnly = projectProp({ ...base, seasonAvg: 26, l10Avg: 25, l5Avg: 27 })!
    expect(withMarket.confidence).toBeGreaterThan(formOnly.confidence)
  })

  it("pulls probabilities toward a coin flip when evidence is thin", () => {
    // Same projected mean, but one is backed by a market and one by form alone.
    const strong = projectProp({ ...base, line: 22.5, bookLine: 22.5, overOdds: -160, underOdds: 135 })!
    const weak = projectProp({ ...base, line: 22.5, projection: strong.mean })!
    expect(weak.pOver).toBeLessThan(strong.pOver)
    expect(weak.meanUncertainty).toBeGreaterThan(strong.meanUncertainty)
  })

  it("scales form by a minutes change", () => {
    const flat = projectProp({ ...base, seasonAvg: 20, minutesAvg: 30, minutesProj: 30 })!
    const boosted = projectProp({ ...base, seasonAvg: 20, minutesAvg: 30, minutesProj: 38 })!
    expect(boosted.mean).toBeGreaterThan(flat.mean)
  })

  it("nudges the probability with a hit rate but does not surrender to it", () => {
    const noHr = projectProp({ ...base, overOdds: -110, underOdds: -110 })!
    const withHr = projectProp({ ...base, overOdds: -110, underOdds: -110, hitRate: "9/10" })!
    expect(withHr.pOver).toBeGreaterThan(noHr.pOver)
    // A 10-game sample must not drag a 50% market to 90%.
    expect(withHr.pOver).toBeLessThan(0.62)
  })

  it("warns when the projection is implausibly far from the line", () => {
    const p = projectProp({ ...base, line: 24.5, projection: 45 })!
    expect(p.warnings.join(" ")).toMatch(/standard deviations/)
  })

  it("keeps combo markets separate from points", () => {
    const p = projectProp({ player: "Nikola Jokic", market: "Pts+Reb+Ast", line: 44.5, projection: 47 })!
    expect(p.marketKey).toBe("PRA")
    expect(p.marketLabel).toBe("Pts + Reb + Ast")
  })
})

describe("projectSlate", () => {
  it("drops unusable rows and keeps the rest", () => {
    const rows: RawPropRow[] = [
      { player: "A Player", market: "Points", line: 20.5, projection: 22 },
      { player: "", market: "Points", line: 20.5, projection: 22 },
      { player: "B Player", market: "Rebounds", line: 8.5 },
    ]
    expect(projectSlate(rows)).toHaveLength(1)
  })

  it("gives every row a distinct id", () => {
    const rows: RawPropRow[] = [
      { player: "A Player", market: "Points", line: 20.5, projection: 22, app: "prizepicks" },
      { player: "A Player", market: "Points", line: 20.5, projection: 22, app: "underdog" },
    ]
    const out = projectSlate(rows, DEFAULT_PROJECTION_SETTINGS)
    expect(new Set(out.map((p) => p.id)).size).toBe(2)
  })
})
