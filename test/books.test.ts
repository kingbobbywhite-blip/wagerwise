import { describe, expect, it } from "vitest"
import { bookConsensus, bookProfile, consensusQuality, isSharp, RETAIL_WEIGHT_CAP } from "@/lib/quant/books"

describe("bookProfile", () => {
  it("knows the market makers", () => {
    expect(bookProfile("pinnacle").tier).toBe("market-making")
    expect(bookProfile("pinnacle").weight).toBe(1)
    expect(isSharp("pinnacle")).toBe(true)
    expect(isSharp("draftkings")).toBe(false)
  })

  it("is case insensitive", () => {
    expect(bookProfile("Pinnacle").id).toBe("pinnacle")
  })

  it("weights unknown books low rather than rejecting them", () => {
    const p = bookProfile("some_new_book")
    expect(p.tier).toBe("unknown")
    expect(p.weight).toBeLessThanOrEqual(0.1)
  })
})

describe("bookConsensus", () => {
  it("returns null with nothing usable", () => {
    expect(bookConsensus([])).toBeNull()
    expect(bookConsensus([{ book: "pinnacle", value: NaN }])).toBeNull()
  })

  it("returns the single value when only one book is present", () => {
    expect(bookConsensus([{ book: "pinnacle", value: 26.2 }])!.value).toBeCloseTo(26.2, 10)
  })

  it("lets Pinnacle dominate a crowd of retail books", () => {
    const c = bookConsensus([
      { book: "pinnacle", value: 26 },
      { book: "draftkings", value: 28 },
      { book: "fanduel", value: 28 },
      { book: "betmgm", value: 28 },
      { book: "caesars", value: 28 },
      { book: "espnbet", value: 28 },
    ])!
    // A naive average would sit at 27.67. Pinnacle pulls it far closer to 26.
    expect(c.value).toBeLessThan(26.7)
    expect(c.hasSharp).toBe(true)
  })

  it("caps the combined retail weight", () => {
    const c = bookConsensus([
      { book: "draftkings", value: 28 },
      { book: "fanduel", value: 28 },
      { book: "betmgm", value: 28 },
      { book: "caesars", value: 28 },
      { book: "espnbet", value: 28 },
    ])!
    expect(c.totalWeight).toBeCloseTo(RETAIL_WEIGHT_CAP, 8)
    expect(c.hasSharp).toBe(false)
  })

  it("reports disagreement between books", () => {
    const c = bookConsensus([
      { book: "pinnacle", value: 25 },
      { book: "draftkings", value: 27.5 },
    ])!
    expect(c.disagreement).toBeCloseTo(2.5, 8)
  })

  it("ranks contributors by weight", () => {
    const c = bookConsensus([
      { book: "draftkings", value: 27 },
      { book: "pinnacle", value: 25 },
    ])!
    expect(c.contributors[0].book).toBe("pinnacle")
  })
})

describe("consensusQuality", () => {
  it("rates a sharp consensus above a retail-only one", () => {
    const sharp = consensusQuality(bookConsensus([{ book: "pinnacle", value: 26 }])!)
    const retail = consensusQuality(bookConsensus([{ book: "espnbet", value: 26 }])!)
    expect(sharp).toBeGreaterThan(retail)
    expect(retail).toBeLessThan(0.5)
  })

  it("stays within zero and one", () => {
    const many = bookConsensus([
      { book: "pinnacle", value: 26 },
      { book: "circa", value: 26 },
      { book: "betonlineag", value: 26 },
      { book: "draftkings", value: 26 },
    ])!
    expect(consensusQuality(many)).toBeLessThanOrEqual(1)
    expect(consensusQuality(many)).toBeGreaterThan(0.8)
  })
})
