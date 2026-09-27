import { describe, expect, it } from "vitest"
import { buildDailyPicks } from "@/lib/today/build"
import { DEFAULT_VALUE_SETTINGS, type FeedQuote } from "@/lib/quant/valuebets"
import { DEFAULT_CORRELATION } from "@/lib/quant/correlation"
import { DEFAULT_CONSTRAINTS } from "@/lib/quant/optimizer"
import { DEFAULT_SETTINGS } from "@/lib/store/schema"

/**
 * A bet must only ever be recommended at a book the user can place it at.
 *
 * Reported: the app named "Marine Johannès over 4.5" as the best bet and the
 * user could not find that line on FanDuel. Offshore reference books (Pinnacle,
 * BetOnline, LowVig) were eligible to be "the offer", and they are the books
 * whose lines most often differ from US retail. They still judge the price;
 * they are never offered as the bet.
 */

const OPTS = {
  value: DEFAULT_VALUE_SETTINGS,
  correlation: DEFAULT_CORRELATION,
  constraints: { ...DEFAULT_CONSTRAINTS, picks: 2, maxPerGame: 3, maxPerTeam: 3 },
  dfsBreakEven: 0.562,
  now: Date.parse("2026-09-27T12:00:00Z"),
}

function q(player: string, book: string, line: number, over: number, under: number): FeedQuote {
  return {
    book, line, overOdds: over, underOdds: under, fetchedAt: null,
    player, market: "AST", gameId: "MIN@NYL", homeTeam: "NYL", awayTeam: "MIN",
    commenceTime: "2026-09-27T15:00:00Z",
  }
}

// The market agrees on 4.5 at -110 both ways; BetOnline hangs a soft over.
const QUOTES: FeedQuote[] = [
  q("Marine Johannes", "pinnacle", 4.5, -110, -110),
  q("Marine Johannes", "draftkings", 4.5, -112, -108),
  q("Marine Johannes", "fanduel", 4.5, -110, -110),
  q("Marine Johannes", "betonlineag", 4.5, 115, -140),
]

describe("bettable books", () => {
  it("reproduces the report: without a list, the offshore price is the best bet", () => {
    const picks = buildDailyPicks(QUOTES, OPTS)
    expect(picks.valueBets.map((b) => b.book)).toContain("betonlineag")
  })

  it("never recommends a bet at a book outside the list", () => {
    const picks = buildDailyPicks(QUOTES, { ...OPTS, bettableBooks: ["fanduel", "draftkings"] })
    expect(picks.valueBets.every((b) => ["fanduel", "draftkings"].includes(b.book))).toBe(true)
    expect(picks.parlays.every((p) => p.legs.every((l) => ["FanDuel", "DraftKings"].includes(l.app ?? "")))).toBe(true)
  })

  it("counts the hidden edges so the screen can say so", () => {
    const picks = buildDailyPicks(QUOTES, { ...OPTS, bettableBooks: ["fanduel"] })
    expect(picks.stats.hiddenOffers).toBeGreaterThan(0)
  })

  it("still uses the offshore books to judge the price", () => {
    // Removing BetOnline from the bettable list must not remove it from the
    // reference: the priced-prop count is the same either way.
    const all = buildDailyPicks(QUOTES, OPTS)
    const mine = buildDailyPicks(QUOTES, { ...OPTS, bettableBooks: ["fanduel"] })
    expect(mine.stats.pricedProps).toBe(all.stats.pricedProps)
  })

  it("defaults to US retail books only", () => {
    const offshore = ["pinnacle", "betonlineag", "lowvig", "bookmaker", "circa"]
    expect(DEFAULT_SETTINGS.oddsFeed.bettable).toContain("fanduel")
    expect(DEFAULT_SETTINGS.oddsFeed.bettable.some((b) => offshore.includes(b))).toBe(false)
  })
})
