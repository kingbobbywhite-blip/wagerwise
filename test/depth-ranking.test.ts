import { describe, it, expect } from "vitest"
import { BLOWOUT_MARGIN, DEPTH_REGION, rankByDepth, sportOddsUrl } from "@/lib/odds-feed/theoddsapi"
import type { FeedEventOdds } from "@/lib/odds-feed/types"

/**
 * Choosing which college games to spend the cap on.
 *
 * A Saturday lists fifty games and the cap is four, so start time is the wrong
 * order: the earliest kick-off is as likely to be a game no book prices as the
 * one everybody does. One sport-level call for spreads answers it for a single
 * credit, because that endpoint is billed per market per region rather than
 * per event.
 */

function game(
  id: string,
  books: number,
  margin: number | null,
  commence = "2026-11-07T17:00:00Z",
): FeedEventOdds {
  return {
    id,
    sport_key: "americanfootball_ncaaf",
    commence_time: commence,
    home_team: `${id} home`,
    away_team: `${id} away`,
    bookmakers: Array.from({ length: books }, (_, i) => ({
      key: `book${i}`,
      title: `Book ${i}`,
      markets:
        margin == null
          ? []
          : [
              {
                key: "spreads",
                outcomes: [
                  { name: `${id} home`, price: -110, point: -margin },
                  { name: `${id} away`, price: -110, point: margin },
                ],
              },
            ],
    })),
  }
}

describe("the ranking call", () => {
  it("pins one region, so it costs one credit rather than three", () => {
    // The app's own default is us,us2,eu. Billed per market per region, that
    // same call would be three credits for no extra information.
    const url = sportOddsUrl("KEY", "cfb", { markets: ["spreads"], fromMs: 0, toMs: 86_400_000 })
    expect(url).toContain("/sports/americanfootball_ncaaf/odds?")
    expect(url).toContain(`regions=${DEPTH_REGION}`)
    expect(url).not.toContain("us2")
    expect(url).toContain("markets=spreads")
  })

  it("asks only for the window, so a Saturday is not ranked against next week", () => {
    const url = sportOddsUrl("KEY", "cfb", {
      markets: ["spreads"],
      fromMs: Date.parse("2026-11-07T12:00:00Z"),
      toMs: Date.parse("2026-11-08T06:00:00Z"),
    })
    expect(url).toContain("commenceTimeFrom=2026-11-07T12%3A00%3A00Z")
    expect(url).toContain("commenceTimeTo=2026-11-08T06%3A00%3A00Z")
    // Whole seconds: the feed rejects milliseconds.
    expect(url).not.toContain(".000Z")
  })
})

describe("ranking by how deep the market is", () => {
  it("puts the games the books actually price first", () => {
    const ranked = rankByDepth([game("thin", 2, 7), game("deep", 9, 7), game("middling", 5, 7)])
    expect(ranked.ranked.map((g) => g.id)).toEqual(["deep", "middling", "thin"])
    expect(ranked.ranked[0].books).toBe(9)
  })

  it("breaks a tie on books with the closer game, then the earlier kick-off", () => {
    const ranked = rankByDepth([
      game("late-close", 6, 3, "2026-11-07T23:00:00Z"),
      game("blowout-ish", 6, 17),
      game("early-close", 6, 3, "2026-11-07T17:00:00Z"),
    ])
    expect(ranked.ranked.map((g) => g.id)).toEqual(["early-close", "late-close", "blowout-ish"])
  })

  it("skips a game the favourite will not finish", () => {
    const ranked = rankByDepth([game("competitive", 8, 6), game("rout", 8, 28)])
    expect(ranked.ranked.map((g) => g.id)).toEqual(["competitive"])
    expect(ranked.blowouts.map((g) => g.id)).toEqual(["rout"])
    // The margin is the dial, not a constant buried in the loop.
    expect(rankByDepth([game("rout", 8, 28)], { maxMargin: 40 }).ranked).toHaveLength(1)
    expect(BLOWOUT_MARGIN).toBe(21)
  })

  it("keeps a game exactly on the line, and drops the one past it", () => {
    expect(rankByDepth([game("on", 4, BLOWOUT_MARGIN)]).ranked).toHaveLength(1)
    expect(rankByDepth([game("past", 4, BLOWOUT_MARGIN + 0.5)]).blowouts).toHaveLength(1)
  })

  it("counts a game nobody priced apart from one skipped as a rout", () => {
    // Two different reasons to skip, and the screen gives both: a rout is a
    // bad bet, an unpriced game is one the books are ignoring. A bookmaker
    // listed with no spread counts as not pricing it, which is the point —
    // presence in the payload is not depth.
    const ranked = rankByDepth([game("silent", 0, null), game("listed-no-spread", 3, null), game("rout", 4, 30), game("fine", 3, 6)])
    expect(ranked.ranked.map((g) => g.id)).toEqual(["fine"])
    expect(ranked.blowouts.map((g) => g.id)).toEqual(["rout"])
    expect(ranked.unpriced.map((g) => g.id).sort()).toEqual(["listed-no-spread", "silent"])
  })

  it("takes the median spread rather than the widest book's", () => {
    const outlier: FeedEventOdds = {
      id: "g",
      commence_time: "2026-11-07T17:00:00Z",
      home_team: "h",
      away_team: "a",
      bookmakers: [
        { key: "a", title: "a", markets: [{ key: "spreads", outcomes: [{ name: "h", price: -110, point: -6.5 }] }] },
        { key: "b", title: "b", markets: [{ key: "spreads", outcomes: [{ name: "h", price: -110, point: -7 }] }] },
        { key: "c", title: "c", markets: [{ key: "spreads", outcomes: [{ name: "h", price: -110, point: -45 }] }] },
      ],
    }
    const [g] = rankByDepth([outlier]).ranked
    expect(g.spread).toBe(7)
    expect(g.books).toBe(3)
  })

  it("survives a payload with nothing in it", () => {
    expect(rankByDepth([])).toEqual({ ranked: [], blowouts: [], unpriced: [] })
  })
})
