import { describe, expect, it } from "vitest"
import {
  bestPerSelection,
  DEFAULT_VALUE_SETTINGS,
  findValueBets,
  groupQuotes,
  referenceProjection,
  type FeedQuote,
} from "@/lib/quant/valuebets"

function q(book: string, line: number, over: number | null, under: number | null): FeedQuote {
  return {
    book,
    line,
    overOdds: over,
    underOdds: under,
    fetchedAt: null,
    player: "Anthony Edwards",
    market: "PTS",
    gameId: "MIN@OKC",
    commenceTime: "2026-01-15T00:10:00Z",
  }
}

describe("groupQuotes", () => {
  it("groups by player and market", () => {
    const groups = groupQuotes([
      q("pinnacle", 25.5, -110, -110),
      q("draftkings", 25.5, -105, -115),
      { ...q("pinnacle", 8.5, -110, -110), market: "REB" },
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0].quotes).toHaveLength(2)
  })
})

describe("referenceProjection", () => {
  const group = groupQuotes([q("pinnacle", 25.5, -110, -110)])[0]

  it("refuses a reference with no sharp book when required", () => {
    const retail = groupQuotes([q("draftkings", 25.5, -110, -110)])[0]
    expect(referenceProjection(retail, retail.quotes, DEFAULT_VALUE_SETTINGS, Date.now())).toBeNull()
  })

  it("allows a retail reference when the requirement is off", () => {
    const retail = groupQuotes([q("draftkings", 25.5, -110, -110)])[0]
    const ref = referenceProjection(
      retail,
      retail.quotes,
      { ...DEFAULT_VALUE_SETTINGS, requireSharpReference: false },
      Date.now(),
    )
    expect(ref?.status).toBe("priced")
  })

  it("builds a priced reference from a sharp book", () => {
    const ref = referenceProjection(group, group.quotes, DEFAULT_VALUE_SETTINGS, Date.now())!
    expect(ref.status).toBe("priced")
    expect(ref.mean).toBeGreaterThan(24)
    expect(ref.mean).toBeLessThan(28)
  })

  it("returns null on an empty set", () => {
    expect(referenceProjection(group, [], DEFAULT_VALUE_SETTINGS, Date.now())).toBeNull()
  })
})

describe("findValueBets", () => {
  it("finds a retail book offering a better price than the sharp consensus", () => {
    // Pinnacle has the over at roughly even. DraftKings is offering +120 on it.
    const bets = findValueBets([q("pinnacle", 25.5, -110, -110), q("draftkings", 25.5, 120, -140)])
    const over = bets.find((b) => b.book === "draftkings" && b.side === "OVER")!
    expect(over).toBeDefined()
    expect(over.edge).toBeGreaterThan(0.05)
    expect(over.fairPrice).toBeLessThan(over.price)
    expect(over.kelly).toBeGreaterThan(0)
  })

  it("finds nothing when every book agrees", () => {
    const bets = findValueBets([
      q("pinnacle", 25.5, -110, -110),
      q("draftkings", 25.5, -110, -110),
      q("fanduel", 25.5, -110, -110),
    ])
    expect(bets).toHaveLength(0)
  })

  it("never judges a book against itself", () => {
    // A lone book cannot be compared to anything, so nothing is returned even
    // though its two sides are wildly mispriced relative to each other.
    expect(findValueBets([q("pinnacle", 25.5, 200, 200)])).toHaveLength(0)
  })

  it("excludes the offering book from the reference price", () => {
    // Two retail books share a stale number; Pinnacle has moved. Without
    // leave-one-out, each retail book would prop up the other's reference.
    const bets = findValueBets([
      q("pinnacle", 28.5, -110, -110),
      q("draftkings", 25.5, -110, -110),
      q("fanduel", 25.5, -110, -110),
    ])
    const dk = bets.find((b) => b.book === "draftkings" && b.side === "OVER")
    expect(dk).toBeDefined()
    expect(dk!.referenceBooks).not.toContain("draftkings")
    expect(dk!.referenceBooks).toContain("pinnacle")
  })

  it("requires a market-making book in the reference by default", () => {
    const bets = findValueBets([q("draftkings", 25.5, 150, -180), q("fanduel", 25.5, -110, -110)])
    expect(bets).toHaveLength(0)
  })

  it("works without a sharp book when the requirement is relaxed", () => {
    const bets = findValueBets([q("draftkings", 25.5, 150, -180), q("fanduel", 25.5, -110, -110)], {
      ...DEFAULT_VALUE_SETTINGS,
      requireSharpReference: false,
    })
    expect(bets.length).toBeGreaterThan(0)
  })

  it("respects the minimum edge", () => {
    // Against a fair 50/50, +105 is a 2.5% edge and -104 is a losing price.
    const quotes = [q("pinnacle", 25.5, -110, -110), q("draftkings", 25.5, 105, -125)]
    const loose = findValueBets(quotes, { ...DEFAULT_VALUE_SETTINGS, minEdge: 0 })
    const strict = findValueBets(quotes, { ...DEFAULT_VALUE_SETTINGS, minEdge: 0.2 })
    expect(loose.length).toBeGreaterThan(0)
    expect(strict).toHaveLength(0)
  })

  it("does not call a price below fair a bet", () => {
    // -104 against a fair 50/50 needs 51% to break even. It is not value.
    const bets = findValueBets([q("pinnacle", 25.5, -110, -110), q("draftkings", 25.5, -104, -116)], {
      ...DEFAULT_VALUE_SETTINGS,
      minEdge: 0,
    })
    expect(bets).toHaveLength(0)
  })

  it("flags an implausibly large edge", () => {
    const bets = findValueBets([q("pinnacle", 25.5, -110, -110), q("circa", 25.5, -110, -110), q("draftkings", 25.5, 400, -600)])
    const huge = bets.find((b) => b.book === "draftkings" && b.side === "OVER")!
    expect(huge.edge).toBeGreaterThan(0.5)
    expect(huge.warnings.join(" ")).toMatch(/larger than these markets normally offer/)
  })

  it("sorts a believable edge above a suspicious one", () => {
    // Two different players so neither reference pollutes the other.
    const other = (base: FeedQuote): FeedQuote => ({ ...base, player: "Jalen Brunson", gameId: "NYK@BOS" })
    const bets = findValueBets([
      q("pinnacle", 25.5, -110, -110),
      q("circa", 25.5, -110, -110),
      q("draftkings", 25.5, 400, -600),
      other(q("pinnacle", 25.5, -110, -110)),
      other(q("circa", 25.5, -110, -110)),
      other(q("fanduel", 25.5, 112, -132)),
    ])
    const huge = bets.find((b) => b.book === "draftkings")!
    const modest = bets.find((b) => b.book === "fanduel")!
    expect(huge.edge).toBeGreaterThan(modest.edge)
    // The smaller, believable edge is listed first anyway.
    expect(bets.indexOf(modest)).toBeLessThan(bets.indexOf(huge))
  })

  it("prices a line difference, not just a price difference", () => {
    // Same price, softer number: the over at 23.5 is worth more than at 25.5.
    const bets = findValueBets([q("pinnacle", 25.5, -110, -110), q("draftkings", 23.5, -110, -110)])
    const over = bets.find((b) => b.side === "OVER" && b.book === "draftkings")!
    expect(over).toBeDefined()
    expect(over.line).toBe(23.5)
    expect(over.fairProb).toBeGreaterThan(0.55)
  })

  it("skips a side the book has not priced", () => {
    const bets = findValueBets([q("pinnacle", 25.5, -110, -110), q("draftkings", 25.5, 150, null)])
    expect(bets.every((b) => b.side === "OVER" || b.book !== "draftkings")).toBe(true)
  })

  it("carries the reference mean and confidence through", () => {
    const bets = findValueBets([q("pinnacle", 25.5, -110, -110), q("draftkings", 25.5, 120, -140)])
    expect(bets[0].consensusMean).toBeGreaterThan(0)
    expect(bets[0].consensusSd).toBeGreaterThan(0)
    expect(bets[0].confidence).toBeGreaterThan(50)
  })

  it("returns nothing for an empty feed", () => {
    expect(findValueBets([])).toHaveLength(0)
  })
})

describe("bestPerSelection", () => {
  it("keeps only the best-priced book per selection", () => {
    const bets = findValueBets([
      q("pinnacle", 25.5, -110, -110),
      q("draftkings", 25.5, 120, -140),
      q("fanduel", 25.5, 135, -155),
    ])
    const best = bestPerSelection(bets)
    const overs = best.filter((b) => b.side === "OVER")
    expect(overs).toHaveLength(1)
    expect(overs[0].book).toBe("fanduel")
  })
})
