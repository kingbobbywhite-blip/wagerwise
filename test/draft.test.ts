import { describe, expect, it } from "vitest"
import { draftFromCandidate, draftFromRow, draftToRow, emptyDraft, summariseDrafts, validateDrafts } from "@/lib/import/draft"

const ok = () => ({ ...emptyDraft("prizepicks"), player: "Anthony Edwards", marketKey: "PTS" as const, line: 24.5, confirmed: true })

describe("draftFromCandidate", () => {
  it("carries OCR issues and confidence through", () => {
    const d = draftFromCandidate(
      { player: "A Player", marketKey: "PTS", marketLabel: "Points", rawMarket: "Points", line: 20.5, confidence: 0.6, sourceLines: [0], issues: ["check it"] },
      "prizepicks",
    )
    expect(d.origin).toBe("screenshot")
    expect(d.confirmed).toBe(false)
    expect(d.issues).toEqual(["check it"])
    expect(d.confidence).toBe(0.6)
  })
})

describe("draftFromRow", () => {
  it("treats pasted rows as already reviewed", () => {
    const d = draftFromRow({ player: "A Player", market: "Points", line: 20.5 })
    expect(d.confirmed).toBe(true)
    expect(d.origin).toBe("paste")
  })
  it("folds single-book odds into a quote", () => {
    const d = draftFromRow({ player: "A", market: "Points", line: 20.5, book: "pinnacle", bookLine: 21.5, overOdds: -110, underOdds: -110 })
    expect(d.quotes).toHaveLength(1)
    expect(d.quotes[0].line).toBe(21.5)
  })
  it("flags an unrecognised market", () => {
    expect(draftFromRow({ player: "A", market: "First Basket", line: 0.5 }).issues[0]).toMatch(/not recognised/)
  })
})

describe("validateDrafts", () => {
  it("passes a clean row", () => {
    expect(validateDrafts([ok()])).toHaveLength(0)
  })
  it("blocks an unreviewed row", () => {
    expect(validateDrafts([{ ...ok(), confirmed: false }])[0].message).toMatch(/Not reviewed/)
  })
  it("blocks an empty player", () => {
    expect(validateDrafts([{ ...ok(), player: "  " }])[0].message).toMatch(/empty/)
  })
  it("blocks a missing market", () => {
    expect(validateDrafts([{ ...ok(), marketKey: null }])[0].message).toMatch(/Pick a market/)
  })
  it("blocks a non-positive line", () => {
    expect(validateDrafts([{ ...ok(), line: 0 }])[0].message).toMatch(/positive/)
  })
  it("blocks an implausible line for the market", () => {
    expect(validateDrafts([{ ...ok(), marketKey: "BLK", line: 40 }]).some((p) => /implausible/.test(p.message))).toBe(true)
  })
  it("blocks a duplicate on the same app", () => {
    const a = ok()
    const b = { ...ok(), id: "other" }
    expect(validateDrafts([a, b]).some((p) => /Duplicate/.test(p.message))).toBe(true)
  })
  it("allows the same prop on two different apps", () => {
    const a = ok()
    const b = { ...ok(), id: "other", app: "underdog" }
    expect(validateDrafts([a, b])).toHaveLength(0)
  })
})

describe("summariseDrafts", () => {
  it("counts priced against unpriced", () => {
    const priced = { ...ok(), quotes: [{ book: "pinnacle", line: 25.5, overOdds: -110, underOdds: -110 }] }
    const s = summariseDrafts([priced, ok()])
    expect(s.total).toBe(2)
    expect(s.priced).toBe(1)
    expect(s.unpriced).toBe(1)
    expect(s.blocking).toBe(1) // the duplicate
  })
})

describe("draftToRow", () => {
  it("produces a row the projector understands", () => {
    const r = draftToRow(ok())
    expect(r.player).toBe("Anthony Edwards")
    expect(r.market).toBe("Points")
    expect(r.line).toBe(24.5)
  })
})
