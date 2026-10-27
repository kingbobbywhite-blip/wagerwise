import { describe, expect, it } from "vitest"
import { bookConsensus, sourceOf } from "@/lib/quant/books"
import { DEFAULT_VALUE_SETTINGS, findValueBets, type FeedQuote } from "@/lib/quant/valuebets"
import { DEFAULT_PROJECTION_SETTINGS } from "@/lib/quant/projection"
import { DEFAULT_CORRELATION } from "@/lib/quant/correlation"
import { DEFAULT_CONSTRAINTS } from "@/lib/quant/optimizer"
import { buildDfsBoard } from "@/lib/today/build"
import type { PickemLine } from "@/lib/odds-feed/propline"

/**
 * Whose opinion a price is.
 *
 * The report behind this file: two settled NBA entries, every leg an under,
 * picks a fan could see would not hit. On PropLine, which carries no Pinnacle
 * player props, the only "sharp" books are BetOnline and LowVig — one book
 * under two names — so an NBA consensus was about two thirds one offshore
 * number. Two points off the rest of the market, it turned a coin flip into a
 * 58% pick at 95 confidence.
 */

const NOW = Date.parse("2026-10-26T18:00:00Z")
const GAME = "Phoenix Suns@Oklahoma City Thunder"

function q(book: string, line: number, over = -110, under = -110): FeedQuote {
  return {
    book,
    line,
    overOdds: over,
    underOdds: under,
    fetchedAt: "2026-10-26T17:55:00Z",
    player: "Ajay Mitchell",
    market: "PTS",
    gameId: GAME,
    commenceTime: "2026-10-27T00:00:00Z",
  }
}

const RETAIL = [q("fanduel", 16.5), q("draftkings", 16.5), q("bovada", 16.5), q("betmgm", 16.5)]

const PRIZEPICKS = (line: number): PickemLine => ({
  app: "prizepicks",
  player: "Ajay Mitchell",
  playerKey: "ajay mitchell",
  market: "PTS",
  gameId: GAME,
  line,
  pickType: "standard",
  over: { multiplier: null },
  under: { multiplier: null },
  fetchedAt: "2026-10-26T17:55:00Z",
})

/** The chance of each side at PrizePicks' line, as the targets see it. */
function atPrizePicks(quotes: FeedQuote[], line = 16.5) {
  const board = buildDfsBoard(quotes, {
    value: { ...DEFAULT_VALUE_SETTINGS, projection: { ...DEFAULT_PROJECTION_SETTINGS, league: "nba" } },
    correlation: DEFAULT_CORRELATION,
    constraints: DEFAULT_CONSTRAINTS,
    dfsBreakEven: 0.55,
    now: NOW,
    pickemLines: [PRIZEPICKS(line)],
  })
  const t = board.targets[0]
  return { target: t, line: t?.appLines?.[0] }
}

describe("books that share one feed", () => {
  it("count once", () => {
    // LowVig hangs BetOnline's lines at less juice. Counted beside it, the
    // one book carried 0.95 of weight against a retail bloc capped at 0.45.
    const twin = bookConsensus([
      { book: "betonlineag", value: 15 },
      { book: "lowvig", value: 15 },
      { book: "fanduel", value: 17 },
    ])!
    const once = bookConsensus([
      { book: "betonlineag", value: 15 },
      { book: "fanduel", value: 17 },
    ])!
    expect(twin.value).toBeCloseTo(once.value, 10)
    expect(twin.totalWeight).toBeCloseTo(once.totalWeight, 10)
    expect(twin.contributors).toHaveLength(2)
    expect(sourceOf("lowvig")).toBe(sourceOf("betonlineag"))
    // Caesars arrives under two ids.
    expect(sourceOf("williamhill_us")).toBe(sourceOf("caesars"))
    expect(sourceOf("fanduel")).not.toBe(sourceOf("draftkings"))
  })

  it("never judge each other as value", () => {
    // A LowVig price judged against BetOnline is judged against itself, and
    // its lower juice read as an edge on every prop they both posted.
    const quotes = [q("betonlineag", 16.5, -110, -110), q("lowvig", 16.5, 110, -130), q("fanduel", 16.5, -110, -110)]
    const bets = findValueBets(quotes, DEFAULT_VALUE_SETTINGS, NOW)
    expect(bets.filter((b) => b.book === "lowvig")).toEqual([])
  })

  it("say what each bloc thinks, and whether a market maker is among them", () => {
    const c = bookConsensus([
      { book: "betonlineag", value: 15 },
      { book: "fanduel", value: 17 },
      { book: "draftkings", value: 17 },
    ])!
    expect(c.hasMarketMaker).toBe(false)
    expect(c.blocs.sharp).toBeCloseTo(15, 10)
    expect(c.blocs.retail).toBeCloseTo(17, 10)
    expect(bookConsensus([{ book: "pinnacle", value: 15 }])!.hasMarketMaker).toBe(true)
  })
})

describe("a pick with no market maker behind it", () => {
  it("is not a pick when only the offshore book sees it", () => {
    // The exact shape of the report: BetOnline and LowVig two points under
    // FanDuel, DraftKings, Bovada, BetMGM and PrizePicks' own line. The app
    // called the under a 58% pick; the rest of the market calls it a coin
    // flip, and so does this.
    const { target, line } = atPrizePicks([...RETAIL, q("betonlineag", 14.5), q("lowvig", 14.5)])
    expect(line!.under).toBeLessThan(0.52)
    expect(line!.under).toBeGreaterThan(0.48)
    // And the row says why its chance sits below what its mean suggests.
    expect(target.warnings?.some((w) => w.includes("disagree"))).toBe(true)
  })

  it("still is one when the whole market agrees", () => {
    // Every book a point under PrizePicks: an edge nobody disputes survives.
    const { line } = atPrizePicks([
      q("fanduel", 15.5),
      q("draftkings", 15.5),
      q("bovada", 15.5),
      q("betonlineag", 15.5),
      q("lowvig", 15.5),
    ])
    expect(line!.under).toBeGreaterThan(0.55)
  })

  it("follows Pinnacle where Pinnacle priced it", () => {
    // A market maker's number is the reference, and retail lagging it is the
    // classic edge. The check is for when no such number exists.
    const { line, target } = atPrizePicks([...RETAIL, q("pinnacle", 14.5)])
    expect(line!.under).toBeGreaterThan(0.58)
    expect(target.warnings?.some((w) => w.includes("disagree")) ?? false).toBe(false)
  })

  it("is not sold as value at a retail book either", () => {
    // FanDuel's even-money under is the retail market's own price; it only
    // looked like value against the offshore number.
    const quotes = [
      q("betonlineag", 14.5),
      q("lowvig", 14.5),
      q("draftkings", 16.5),
      q("bovada", 16.5),
      q("fanduel", 16.5, -120, 100),
    ]
    const bets = findValueBets(quotes, DEFAULT_VALUE_SETTINGS, NOW).filter((b) => b.book === "fanduel")
    expect(bets).toEqual([])
  })
})
