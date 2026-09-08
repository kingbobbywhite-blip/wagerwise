import { describe, expect, it } from "vitest"
import { extractProps, linesFromText, parseLineValue } from "@/lib/ocr/extract"

// A PrizePicks-style card layout: name, meta row, line, stat.
const PRIZEPICKS = `Anthony Edwards
MIN - SG vs OKC
24.5
Points
Shai Gilgeous-Alexander
OKC - PG vs MIN
30.5
Points
Chet Holmgren
OKC - C vs MIN
1.5
Blocks
Rudy Gobert
MIN - C vs OKC
11.5
Rebounds`

// An Underdog-style layout: line and stat on one row.
const UNDERDOG = `Jalen Brunson
NYK vs BOS
26.5 Points
Higher
Lower
Jayson Tatum
BOS vs NYK
8.5 Rebounds
Higher
Lower`

describe("parseLineValue", () => {
  it("reads clean numbers", () => {
    expect(parseLineValue("24.5")).toEqual({ value: 24.5, repaired: false })
    expect(parseLineValue("8")).toEqual({ value: 8, repaired: false })
    expect(parseLineValue("1.5")).toEqual({ value: 1.5, repaired: false })
  })

  it("repairs common OCR character confusions", () => {
    expect(parseLineValue("2O.5")).toEqual({ value: 20.5, repaired: true })
    expect(parseLineValue("l1.5")).toEqual({ value: 11.5, repaired: true })
    expect(parseLineValue("24,5")).toEqual({ value: 24.5, repaired: true })
  })

  it("rejects things that are not lines", () => {
    expect(parseLineValue("Points")).toBeNull()
    expect(parseLineValue("")).toBeNull()
    expect(parseLineValue("1234")).toBeNull()
    expect(parseLineValue("Anthony Edwards")).toBeNull()
  })
})

describe("extractProps", () => {
  it("reads a stacked card layout", () => {
    const r = extractProps(linesFromText(PRIZEPICKS))
    expect(r.candidates).toHaveLength(4)
    const edwards = r.candidates.find((c) => c.player === "Anthony Edwards")!
    expect(edwards.line).toBe(24.5)
    expect(edwards.marketKey).toBe("PTS")
    expect(edwards.confidence).toBeGreaterThan(0.5)

    const holmgren = r.candidates.find((c) => c.player === "Chet Holmgren")!
    expect(holmgren.marketKey).toBe("BLK")
    expect(holmgren.line).toBe(1.5)
  })

  it("reads a layout with the line and stat on one row", () => {
    const r = extractProps(linesFromText(UNDERDOG))
    expect(r.candidates).toHaveLength(2)
    const brunson = r.candidates.find((c) => c.player === "Jalen Brunson")!
    expect(brunson.line).toBe(26.5)
    expect(brunson.marketKey).toBe("PTS")
    const tatum = r.candidates.find((c) => c.player === "Jayson Tatum")!
    expect(tatum.marketKey).toBe("REB")
    expect(tatum.line).toBe(8.5)
  })

  it("does not mistake Higher and Lower for player names", () => {
    const r = extractProps(linesFromText(UNDERDOG))
    expect(r.candidates.some((c) => /higher|lower/i.test(c.player))).toBe(false)
  })

  it("does not mistake a team and position row for a name", () => {
    const r = extractProps(linesFromText(PRIZEPICKS))
    expect(r.candidates.some((c) => /MIN|OKC|vs/.test(c.player))).toBe(false)
  })

  it("handles combo markets", () => {
    const r = extractProps(linesFromText("Nikola Jokic\nDEN vs PHX\n44.5\nPts+Rebs+Asts"))
    expect(r.candidates[0].marketKey).toBe("PRA")
    expect(r.candidates[0].line).toBe(44.5)
  })

  it("flags a repaired line value so it gets checked", () => {
    const r = extractProps(linesFromText("Devin Booker\nPHX vs DEN\n2O.5\nPoints"))
    expect(r.candidates[0].line).toBe(20.5)
    expect(r.candidates[0].issues.join(" ")).toMatch(/character repair/)
    expect(r.candidates[0].confidence).toBeLessThan(0.85)
  })

  it("skips a stat with no line near it", () => {
    const r = extractProps(linesFromText("Devin Booker\nPHX vs DEN\nPoints\nSomething else entirely"))
    expect(r.candidates).toHaveLength(0)
  })

  it("skips a stat with no name near it", () => {
    const r = extractProps(linesFromText("24.5\nPoints"))
    expect(r.candidates).toHaveLength(0)
  })

  it("does not reuse one number for two stats", () => {
    const r = extractProps(linesFromText("Devin Booker\n24.5\nPoints\nRebounds"))
    expect(r.candidates).toHaveLength(1)
  })

  it("deduplicates a prop repeated across a carousel", () => {
    const doubled = linesFromText(PRIZEPICKS + "\n" + PRIZEPICKS)
    const r = extractProps(doubled)
    expect(r.candidates).toHaveLength(4)
  })

  it("reports lines it could not place", () => {
    const r = extractProps(linesFromText("Anthony Edwards\n24.5\nPoints\nSome Stray Name"))
    expect(r.leftover.some((l) => l.text === "Some Stray Name")).toBe(true)
  })

  it("carries OCR confidence into the candidate", () => {
    const low = extractProps([
      { text: "Anthony Edwards", confidence: 40 },
      { text: "24.5", confidence: 40 },
      { text: "Points", confidence: 40 },
    ])
    const high = extractProps([
      { text: "Anthony Edwards", confidence: 96 },
      { text: "24.5", confidence: 96 },
      { text: "Points", confidence: 96 },
    ])
    expect(low.candidates[0].confidence).toBeLessThan(high.candidates[0].confidence)
  })

  it("returns nothing for empty input", () => {
    expect(extractProps([]).candidates).toHaveLength(0)
    expect(extractProps(linesFromText("")).candidates).toHaveLength(0)
  })

  it("marks an unrecognised stat rather than guessing", () => {
    const r = extractProps(linesFromText("Anthony Edwards\n0.5\nFirst Basket"))
    expect(r.candidates).toHaveLength(0)
  })
})
