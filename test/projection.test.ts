import { describe, expect, it } from "vitest"
import { collectQuotes, DEFAULT_PROJECTION_SETTINGS, parseHitRate, projectProp, projectSlate, type RawPropRow } from "@/lib/quant/projection"

const base: RawPropRow = { player: "Anthony Edwards", market: "Points", line: 24.5 }
const pinnacle = (line: number, over = -110, under = -110) => ({ book: "pinnacle", line, overOdds: over, underOdds: under })

describe("parseHitRate", () => {
  it("reads fractions and keeps the sample size", () => {
    expect(parseHitRate("7/10")).toEqual({ rate: 0.7, sample: 10 })
  })
  it("reads percentages", () => {
    expect(parseHitRate("70%")).toEqual({ rate: 0.7, sample: 0 })
    expect(parseHitRate(62)).toEqual({ rate: 0.62, sample: 0 })
  })
  it("rejects junk", () => {
    expect(parseHitRate(null)).toBeNull()
    expect(parseHitRate("n/a")).toBeNull()
  })
})

describe("collectQuotes", () => {
  it("folds the single-book convenience fields into a quote", () => {
    const q = collectQuotes({ ...base, book: "pinnacle", bookLine: 25.5, overOdds: -110, underOdds: -110 })
    expect(q).toHaveLength(1)
    expect(q[0].book).toBe("pinnacle")
    expect(q[0].line).toBe(25.5)
  })
  it("defaults the quote line to the prop line", () => {
    expect(collectQuotes({ ...base, overOdds: -110, underOdds: -110 })[0].line).toBe(24.5)
  })
  it("drops quotes with no odds on either side", () => {
    expect(collectQuotes({ ...base, quotes: [{ book: "pinnacle", line: 24.5, overOdds: null, underOdds: null }] })).toHaveLength(0)
  })
  it("returns nothing when there are no odds at all", () => {
    expect(collectQuotes(base)).toHaveLength(0)
  })
})

describe("pricing gate", () => {
  it("marks a prop with no odds as unpriced", () => {
    const p = projectProp({ ...base, seasonAvg: 26, l10Avg: 25, l5Avg: 27 })!
    expect(p.status).toBe("unpriced")
    expect(p.unpricedReason).toMatch(/No sportsbook price/)
  })

  it("marks a prop with a real price as priced", () => {
    const p = projectProp({ ...base, quotes: [pinnacle(25.5)] })!
    expect(p.status).toBe("priced")
    expect(p.unpricedReason).toBeNull()
    expect(p.sources).toEqual(["market"])
  })

  it("keeps a prop with nothing to work from, but gives it no projection", () => {
    // Dropping it silently would leave you staring at an empty board after a
    // capture. It is kept, marked, and given a confidence of zero so the UI
    // renders dashes instead of a manufactured coin flip.
    const p = projectProp(base)!
    expect(p.status).toBe("unpriced")
    expect(p.sources).toEqual(["none"])
    expect(p.confidence).toBe(0)
    expect(p.unpricedReason).toMatch(/nothing to project from/)
  })

  it("still returns null for a row that is not a prop at all", () => {
    expect(projectProp({ ...base, player: "" })).toBeNull()
    expect(projectProp({ ...base, line: Number.NaN })).toBeNull()
  })

  it("can be told to require a sharp book", () => {
    const settings = { ...DEFAULT_PROJECTION_SETTINGS, requireSharpBook: true }
    const retail = projectProp({ ...base, quotes: [{ book: "draftkings", line: 25.5, overOdds: -110, underOdds: -110 }] }, settings)!
    expect(retail.status).toBe("unpriced")
    expect(retail.unpricedReason).toMatch(/market-making/)

    const sharp = projectProp({ ...base, quotes: [pinnacle(25.5)] }, settings)!
    expect(sharp.status).toBe("priced")
  })

  it("never lets a projection column alone make a prop priced", () => {
    const p = projectProp({ ...base, projection: 28 })!
    expect(p.status).toBe("unpriced")
  })
})

describe("market pricing", () => {
  it("prices a symmetric market at about a coin flip", () => {
    const p = projectProp({ ...base, line: 25.5, quotes: [pinnacle(25.5)] })!
    expect(p.pOver).toBeGreaterThan(0.45)
    expect(p.pOver).toBeLessThan(0.55)
    expect(p.holdPct).toBeCloseTo(4.7619, 3)
  })

  it("finds value when the DFS line is softer than the book line", () => {
    const p = projectProp({ ...base, line: 23.5, quotes: [pinnacle(25.5)] })!
    expect(p.side).toBe("OVER")
    expect(p.pWin).toBeGreaterThan(0.55)
    expect(p.lineEdge).toBeGreaterThan(1.5)
  })

  it("finds the under when the DFS line is inflated", () => {
    const p = projectProp({ ...base, line: 27.5, quotes: [pinnacle(25.5)] })!
    expect(p.side).toBe("UNDER")
    expect(p.pWin).toBeGreaterThan(0.55)
  })

  it("lets Pinnacle outweigh a crowd of retail books", () => {
    const retailOnly = projectProp({
      ...base,
      quotes: [
        { book: "draftkings", line: 27.5, overOdds: -110, underOdds: -110 },
        { book: "fanduel", line: 27.5, overOdds: -110, underOdds: -110 },
        { book: "betmgm", line: 27.5, overOdds: -110, underOdds: -110 },
      ],
    })!
    const withPinnacle = projectProp({
      ...base,
      quotes: [
        pinnacle(25.5),
        { book: "draftkings", line: 27.5, overOdds: -110, underOdds: -110 },
        { book: "fanduel", line: 27.5, overOdds: -110, underOdds: -110 },
        { book: "betmgm", line: 27.5, overOdds: -110, underOdds: -110 },
      ],
    })!
    const pinnacleOnly = projectProp({ ...base, quotes: [pinnacle(25.5)] })!
    expect(retailOnly.mean).toBeGreaterThan(27)
    // One sharp price outweighs three retail copies, so the consensus lands
    // much nearer Pinnacle than the retail crowd.
    const toPinnacle = Math.abs(withPinnacle.mean - pinnacleOnly.mean)
    const toRetail = Math.abs(withPinnacle.mean - retailOnly.mean)
    expect(toPinnacle).toBeLessThan(toRetail)
    expect(withPinnacle.books[0].book).toBe("pinnacle")
  })

  it("warns when no market-making book is present", () => {
    const p = projectProp({ ...base, quotes: [{ book: "espnbet", line: 25.5, overOdds: -110, underOdds: -110 }] })!
    expect(p.hasSharpBook).toBe(false)
    expect(p.warnings.join(" ")).toMatch(/No market-making book/)
  })

  it("is more confident with a sharp book than a retail one", () => {
    const sharp = projectProp({ ...base, quotes: [pinnacle(25.5)] })!
    const retail = projectProp({ ...base, quotes: [{ book: "espnbet", line: 25.5, overOdds: -110, underOdds: -110 }] })!
    expect(sharp.confidence).toBeGreaterThan(retail.confidence)
  })

  it("flags a stale quote and discards an ancient one", () => {
    const now = Date.parse("2026-01-01T12:00:00Z")
    const stale = projectProp(
      { ...base, quotes: [{ ...pinnacle(25.5), fetchedAt: "2026-01-01T11:00:00Z" }] },
      DEFAULT_PROJECTION_SETTINGS,
      "",
      now,
    )!
    expect(stale.isStale).toBe(true)
    expect(stale.warnings.join(" ")).toMatch(/minutes old/)

    const ancient = projectProp(
      { ...base, quotes: [{ ...pinnacle(25.5), fetchedAt: "2025-12-31T00:00:00Z" }], seasonAvg: 26 },
      DEFAULT_PROJECTION_SETTINGS,
      "",
      now,
    )!
    expect(ancient.status).toBe("unpriced")
  })

  it("reports book disagreement", () => {
    const p = projectProp({
      ...base,
      quotes: [pinnacle(24.5), { book: "circa", line: 27.5, overOdds: -110, underOdds: -110 }],
    })!
    expect(p.bookDisagreement).toBeGreaterThan(2)
    expect(p.warnings.join(" ")).toMatch(/disagree/)
  })

  it("notes when only one side was priced", () => {
    const p = projectProp({ ...base, quotes: [{ book: "pinnacle", line: 25.5, overOdds: -110, underOdds: null }] })!
    expect(p.status).toBe("priced")
    expect(p.warnings.join(" ")).toMatch(/one side/)
  })
})

describe("unpriced estimation", () => {
  const log = [22, 31, 18, 27, 24, 19, 29, 25, 21, 26, 23, 28]

  it("uses game-log variance rather than a season mean", () => {
    const p = projectProp({ ...base, gameLog: log })!
    expect(p.status).toBe("unpriced")
    expect(p.sources).toEqual(["gamelog"])
    expect(p.sd).toBeGreaterThan(0)
  })

  it("separates a steady player from a volatile one", () => {
    const steadyLog = Array(14).fill(24)
    const wildLog = [8, 40, 10, 38, 9, 39, 11, 37, 12, 36, 13, 35, 14, 34]
    const steady = projectProp({ ...base, gameLog: steadyLog })!
    const wild = projectProp({ ...base, gameLog: wildLog })!
    expect(wild.sd).toBeGreaterThan(steady.sd * 1.3)

    // Held the same distance below each player's own centre, the volatile one
    // sits closer to a coin flip. Identical averages, different bets.
    const steadyAt = projectProp({ ...base, line: steady.mean - 4, gameLog: steadyLog })!
    const wildAt = projectProp({ ...base, line: wild.mean - 4, gameLog: wildLog })!
    expect(wildAt.pOver).toBeLessThan(steadyAt.pOver)
  })

  it("adjusts minutes for rest and absences before projecting", () => {
    const flat = projectProp({ ...base, gameLog: Array(12).fill(20), minutesLog: Array(12).fill(30) })!
    const boosted = projectProp({
      ...base,
      gameLog: Array(12).fill(20),
      minutesLog: Array(12).fill(30),
      teammatesOut: 2,
    })!
    expect(boosted.mean).toBeGreaterThan(flat.mean)

    const b2b = projectProp({
      ...base,
      gameLog: Array(12).fill(20),
      minutesLog: Array(12).fill(30),
      restDays: 0,
    })!
    expect(b2b.mean).toBeLessThan(flat.mean)
  })

  it("is far less confident than a priced prop", () => {
    const priced = projectProp({ ...base, quotes: [pinnacle(25.5)] })!
    const gamelog = projectProp({ ...base, gameLog: log })!
    const form = projectProp({ ...base, seasonAvg: 24 })!
    expect(priced.confidence).toBeGreaterThan(gamelog.confidence)
    expect(gamelog.confidence).toBeGreaterThan(form.confidence)
  })

  it("pulls an averages-only estimate hard toward a coin flip", () => {
    const p = projectProp({ ...base, line: 20.5, seasonAvg: 24 })!
    // A four-point gap on a season average must not read as a lock.
    expect(p.pWin).toBeLessThan(0.68)
    expect(p.warnings.join(" ")).toMatch(/weakest estimate/)
  })
})

describe("warnings", () => {
  it("warns when the projection is implausibly far from the line", () => {
    const p = projectProp({ ...base, line: 24.5, gameLog: Array(12).fill(45) })!
    expect(p.warnings.join(" ")).toMatch(/standard deviations from the line/)
  })

  it("warns on an out-of-range projection", () => {
    const p = projectProp({ ...base, gameLog: Array(12).fill(80) })!
    expect(p.warnings.join(" ")).toMatch(/outside a plausible NBA range/)
  })

  it("prices a whole-number line with a real push probability", () => {
    const p = projectProp({ player: "Rudy Gobert", market: "Blocks", line: 1, gameLog: [1, 2, 0, 1, 3, 1, 2, 0, 1, 2] })!
    expect(p.pPush).toBeGreaterThan(0.1)
    expect(p.pOver + p.pUnder + p.pPush).toBeCloseTo(1, 6)
  })

  it("keeps combo markets separate from points", () => {
    const p = projectProp({ player: "Nikola Jokic", market: "Pts+Reb+Ast", line: 44.5, quotes: [{ book: "pinnacle", line: 44.5, overOdds: -110, underOdds: -110 }] })!
    expect(p.marketKey).toBe("PRA")
  })
})

describe("projectSlate", () => {
  it("drops malformed rows but keeps unprojectable ones", () => {
    const rows: RawPropRow[] = [
      { player: "A Player", market: "Points", line: 20.5, projection: 22 },
      { player: "", market: "Points", line: 20.5, projection: 22 },
      { player: "B Player", market: "Rebounds", line: 8.5 },
    ]
    const out = projectSlate(rows)
    expect(out).toHaveLength(2)
    expect(out.map((p) => p.sources[0])).toEqual(["projection", "none"])
  })

  it("gives every row a distinct id", () => {
    const rows: RawPropRow[] = [
      { player: "A Player", market: "Points", line: 20.5, projection: 22, app: "prizepicks" },
      { player: "A Player", market: "Points", line: 20.5, projection: 22, app: "underdog" },
    ]
    expect(new Set(projectSlate(rows).map((p) => p.id)).size).toBe(2)
  })
})
