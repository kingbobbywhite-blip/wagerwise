import { describe, it, expect } from "vitest"
import { DEFAULT_CORRELATION, legCorrelation, playerKeyIn } from "@/lib/quant/correlation"
import { DEFAULT_CONSTRAINTS } from "@/lib/quant/optimizer"
import { DEFAULT_PROJECTION_SETTINGS } from "@/lib/quant/projection"
import { DEFAULT_VALUE_SETTINGS, ambiguousPlayers, findValueBets, groupQuotes, type FeedQuote } from "@/lib/quant/valuebets"
import { sameGameId, teamNickname } from "@/lib/odds-feed/games"
import { attachQuotes, indexQuotes, type NormalizedQuote } from "@/lib/odds-feed/theoddsapi"
import { buildDfsTargets, pickemLinesFor } from "@/lib/today/build"
import type { PickemLine } from "@/lib/odds-feed/propline"

/**
 * Two different players with the same name, in two different games, in one
 * pull. Across 130 college football teams this is ordinary rather than
 * freakish, and every map in this app used to be keyed on the name alone.
 *
 * The failure it caused is the worst kind this app can produce: not a missing
 * price but a WRONG one, with one player's books pooled into the other's
 * consensus and whichever line came back wrong for both.
 */

const NOW = Date.parse("2026-11-07T15:00:00Z")
const KICKOFF = "2026-11-07T20:00:00Z"

/** The same name, two fixtures, deliberately different lines. */
function quote(book: string, gameId: string, line: number, over: number, under: number): FeedQuote {
  const [away, home] = gameId.split("@")
  return {
    book, line, overOdds: over, underOdds: under, fetchedAt: null,
    player: "Jordan Johnson",
    market: "RUSH_YDS",
    gameId,
    homeTeam: home,
    awayTeam: away,
    commenceTime: KICKOFF,
    competition: "cfb",
  }
}

// One is a 95-yard back at Ohio State; the other barely plays at Duke.
const BIG = "Nittany Lions@Buckeyes"
const SMALL = "Blue Devils@Tar Heels"
const SLATE: FeedQuote[] = [
  quote("pinnacle", BIG, 94.5, -110, -110),
  quote("draftkings", BIG, 94.5, -112, -108),
  quote("fanduel", BIG, 95.5, -110, -110),
  quote("pinnacle", SMALL, 18.5, -110, -110),
  quote("draftkings", SMALL, 18.5, -108, -112),
  quote("fanduel", SMALL, 19.5, -110, -110),
]

const OPTS = {
  value: { ...DEFAULT_VALUE_SETTINGS, projection: { ...DEFAULT_PROJECTION_SETTINGS, league: "nfl" as const } },
  correlation: DEFAULT_CORRELATION,
  constraints: { ...DEFAULT_CONSTRAINTS, picks: 2, maxPerGame: 2, maxPerTeam: 2 },
  dfsBreakEven: 0.577,
  now: NOW,
}

describe("two players, one name", () => {
  it("prices each separately instead of pooling six books into one consensus", () => {
    const groups = groupQuotes(SLATE)
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.quotes.length)).toEqual([3, 3])
    expect(new Set(groups.map((g) => g.gameId))).toEqual(new Set([BIG, SMALL]))
  })

  it("neither inherits the other's line", () => {
    const targets = buildDfsTargets(SLATE, OPTS)
    expect(targets).toHaveLength(2)
    const big = targets.find((t) => t.gameId === BIG)!
    const small = targets.find((t) => t.gameId === SMALL)!
    // The projections must stay with their own fixtures. Pooled, both landed
    // somewhere near 57 yards, which is nobody's line.
    expect(big.mean).toBeGreaterThan(80)
    expect(small.mean).toBeLessThan(30)
    expect(big.marketLine).toBeGreaterThan(80)
    expect(small.marketLine).toBeLessThan(30)
  })

  it("says on the row that the name is shared", () => {
    const targets = buildDfsTargets(SLATE, OPTS)
    for (const t of targets) {
      expect(t.warnings?.join(" ")).toContain("same name")
      expect(t.warnings?.join(" ")).toContain(t.gameId.replace("@", " at "))
    }
    expect(ambiguousPlayers(SLATE)).toEqual(new Set(["jordan johnson"]))
  })

  it("warns on a value bet rather than quietly offering it", () => {
    // One book hangs a soft over on the small one; the edge is real at that
    // fixture, and the row still has to say the name is not unique.
    const soft = SLATE.map((q) => (q.book === "fanduel" && q.gameId === SMALL ? { ...q, overOdds: 160 } : q))
    const bets = findValueBets(soft, OPTS.value, NOW)
    expect(bets.length).toBeGreaterThan(0)
    for (const b of bets) expect(b.warnings.join(" ")).toContain("same name")
  })

  it("keeps one decision per player rather than one per name", () => {
    // bestPerSelection collapses duplicate opinions. Keyed on the name alone
    // it discarded one of the two players entirely.
    const soft = SLATE.map((q) => (q.book === "fanduel" ? { ...q, overOdds: 170 } : q))
    const picks = findValueBets(soft, OPTS.value, NOW)
    const games = new Set(picks.map((b) => b.gameId))
    expect(games.size).toBe(2)
  })

  it("leaves two same-named players as near-independent legs in a parlay", () => {
    // Priced as one person, two legs on the same market came out at 0.99 — the
    // same event twice — and the optimizer treated a two-leg parlay as one leg.
    const leg = (gameId: string) => ({ player: "Jordan Johnson", team: null, opponent: null, gameId, market: "RUSH_YDS" as const, isOver: true })
    expect(legCorrelation(leg(BIG), leg(BIG))).toBeGreaterThan(0.9)
    expect(legCorrelation(leg(BIG), leg(SMALL))).toBeLessThan(0.1)
  })

  it("keys identity on the game, and falls back to the bare name without one", () => {
    expect(playerKeyIn("Jordan Johnson", BIG)).not.toBe(playerKeyIn("Jordan Johnson", SMALL))
    expect(playerKeyIn("Jordan  Johnson")).toBe(playerKeyIn("jordan johnson"))
  })
})

describe("matching a fixture across two feeds", () => {
  it("matches on nicknames, because the feeds spell teams differently", () => {
    expect(teamNickname("Ohio State Buckeyes")).toBe("buckeyes")
    expect(sameGameId("Nittany Lions@Buckeyes", "Penn State Nittany Lions@Ohio State Buckeyes")).toBe(true)
    expect(sameGameId("LA Clippers@Lakers", "Los Angeles Clippers@Los Angeles Lakers")).toBe(true)
    // Home and away still have to line up: the reverse fixture is another game.
    expect(sameGameId("Buckeyes@Nittany Lions", "Nittany Lions@Buckeyes")).toBe(false)
    expect(sameGameId(null, "a@b")).toBe(false)
    expect(sameGameId("a", "a@b")).toBe(false)
  })

  it("prefers a pick'em line from the same fixture", () => {
    const line = (gameId: string, l: number): PickemLine => ({
      app: "prizepicks", player: "Jordan Johnson", playerKey: "jordan johnson",
      market: "RUSH_YDS", gameId, line: l, pickType: "standard",
      over: { multiplier: null }, under: { multiplier: null }, fetchedAt: null,
    })
    const both = [line("Penn State Nittany Lions@Ohio State Buckeyes", 92.5), line(SMALL, 17.5)]
    const picked = pickemLinesFor(both, BIG, true)
    expect(picked.lines.map((l) => l.line)).toEqual([92.5])
    expect(picked.warning).toBeNull()
  })

  it("shows nothing, and says why, when a shared name cannot be tied to a fixture", () => {
    const stray: PickemLine = {
      app: "prizepicks", player: "Jordan Johnson", playerKey: "jordan johnson",
      market: "RUSH_YDS", gameId: "Somebody@Else", line: 55.5, pickType: "standard",
      over: { multiplier: null }, under: { multiplier: null }, fetchedAt: null,
    }
    const ambiguous = pickemLinesFor([stray], BIG, true)
    expect(ambiguous.lines).toEqual([])
    expect(ambiguous.warning).toContain("same name")
    // A unique name with a feed spelling we failed to match is still usable:
    // there is only one person it can be.
    const unique = pickemLinesFor([stray], BIG, false)
    expect(unique.lines).toEqual([stray])
    expect(unique.warning).toBeNull()
  })
})

describe("an imported board has a name and a stat, often no fixture", () => {
  const priced = (gameId: string, line: number): NormalizedQuote => ({
    book: "pinnacle", line, overOdds: -110, underOdds: -110, fetchedAt: null,
    player: "Jordan Johnson", playerKey: "jordan johnson", market: "RUSH_YDS",
    gameId, homeTeam: gameId.split("@")[1], awayTeam: gameId.split("@")[0], commenceTime: KICKOFF,
  })

  it("names the ambiguity instead of attaching whichever price came first", () => {
    const index = indexQuotes([priced(BIG, 94.5), priced(SMALL, 18.5)])
    const attached = attachQuotes([{ player: "Jordan Johnson", marketKey: "RUSH_YDS" as const, marketLabel: "Rushing Yards" }], index)
    expect(attached.matched).toBe(1)
    expect(attached.ambiguous).toHaveLength(1)
    expect(attached.ambiguous[0].games.sort()).toEqual([BIG, SMALL].sort())
  })

  it("resolves it outright when the row does carry a fixture", () => {
    const index = indexQuotes([priced(BIG, 94.5), priced(SMALL, 18.5)])
    const attached = attachQuotes(
      [{ player: "Jordan Johnson", marketKey: "RUSH_YDS" as const, marketLabel: "Rushing Yards", gameId: SMALL }],
      index,
    )
    expect(attached.ambiguous).toHaveLength(0)
    expect(attached.rows[0].quotes.map((q) => q.line)).toEqual([18.5])
  })
})
