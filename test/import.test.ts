import { describe, expect, it } from "vitest"
import { parseSlate, SAMPLE_CSV, splitDelimited } from "@/lib/import/parse"

describe("splitDelimited", () => {
  it("splits a plain row", () => {
    expect(splitDelimited("a,b,c", ",")).toEqual(["a", "b", "c"])
  })
  it("respects quoted fields containing the delimiter", () => {
    expect(splitDelimited('a,"b,c",d', ",")).toEqual(["a", "b,c", "d"])
  })
  it("handles escaped quotes", () => {
    expect(splitDelimited('a,"say ""hi""",c', ",")).toEqual(["a", 'say "hi"', "c"])
  })
})

describe("parseSlate", () => {
  it("reads the bundled sample", () => {
    const r = parseSlate(SAMPLE_CSV)
    expect(r.format).toBe("csv")
    expect(r.rows).toHaveLength(12)
    expect(r.skipped).toHaveLength(0)
    const first = r.rows[0]
    expect(first.player).toBe("Anthony Edwards")
    expect(first.line).toBe(24.5)
    expect(first.bookLine).toBe(25.5)
    expect(first.overOdds).toBe(-112)
    expect(first.app).toBe("prizepicks")
    expect(first.hitRate).toBe("7/10")
  })

  it("reads a JSON array", () => {
    const r = parseSlate(JSON.stringify([{ player: "A Player", market: "Points", line: 20.5, projection: 22 }]))
    expect(r.format).toBe("json")
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].projection).toBe(22)
  })

  it("unwraps a JSON object around the array", () => {
    const r = parseSlate(JSON.stringify({ props: [{ player: "A", market: "Points", line: 20.5 }] }))
    expect(r.rows).toHaveLength(1)
  })

  it("reports rows it could not read instead of silently dropping them", () => {
    const r = parseSlate("player,market,line\nGood Player,Points,20.5\n,Points,20.5\nBad Player,Points,abc")
    expect(r.rows).toHaveLength(1)
    expect(r.skipped).toHaveLength(2)
    expect(r.skipped[0].reason).toMatch(/player/)
    expect(r.skipped[1].reason).toMatch(/line/)
  })

  it("recognises alternative column names", () => {
    const r = parseSlate("Name,Prop Type,Value,Over Price\nA Player,Points,20.5,-110")
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].overOdds).toBe(-110)
  })

  it("lists columns it did not understand", () => {
    const r = parseSlate("player,market,line,weather\nA Player,Points,20.5,sunny")
    expect(r.unmapped).toContain("weather")
  })

  it("converts decimal odds to American", () => {
    const r = parseSlate("player,market,line,over_odds\nA Player,Points,20.5,1.91")
    expect(r.rows[0].overOdds).toBe(-110)
  })

  it("parses tab-separated data", () => {
    const r = parseSlate("player\tmarket\tline\nA Player\tPoints\t20.5")
    expect(r.format).toBe("tsv")
    expect(r.rows).toHaveLength(1)
  })

  it("reports invalid JSON without throwing", () => {
    const r = parseSlate("{ not json")
    expect(r.rows).toHaveLength(0)
    expect(r.skipped).toHaveLength(1)
  })

  it("returns an empty result for empty input", () => {
    expect(parseSlate("   ").rows).toHaveLength(0)
  })
})
