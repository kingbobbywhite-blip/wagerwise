import { afterEach, describe, expect, it, vi } from "vitest"
import { extractProps, linesFromText, mergeReads, type OcrLine, type PropCandidate } from "@/lib/ocr/extract"
import { PAGE_SEG_MODE } from "@/lib/ocr/engine"
import grid from "./fixtures/ocr/board-grid.json"
import list from "./fixtures/ocr/board-list.json"
import hard from "./fixtures/ocr/board-hard.json"
import lineup from "./fixtures/ocr/real-prizepicks-lineup.json"

/**
 * Capture-a-slate regression tests.
 *
 * The fixtures are real Tesseract output, not hand-written text: three phone
 * screenshots of rendered boards, run through the same segmentation mode and
 * block walk as lib/ocr/engine.ts, positions included. They pin the two
 * failures that made capture return nothing, or worse, the wrong thing:
 *
 *   - SINGLE_BLOCK segmentation merged grid columns and dropped every line
 *     value, so a PrizePicks screenshot produced zero props.
 *   - AUTO segmentation fixed that but emits a list board's right-aligned values
 *     after all the names, so pairing by output order pinned each value to the
 *     wrong player. Pairing by position fixes it.
 *
 * Every assertion is on the full set, so a wrong pairing fails as loudly as a
 * missing one.
 */

const props = (lines: OcrLine[]) =>
  extractProps(lines)
    .candidates.map((c) => `${c.player} | ${c.line} | ${c.marketKey}`)
    .sort()

describe("OCR engine configuration", () => {
  it("uses AUTO page segmentation, not tesseract.js's SINGLE_BLOCK default", () => {
    // SINGLE_BLOCK is what broke capture. Changing this back fails every
    // screenshot test below as well, but this names the cause.
    expect(PAGE_SEG_MODE).toBe("3")
  })
})

describe("real OCR output", () => {
  it("reads a two-column PrizePicks grid", () => {
    expect(props(grid as OcrLine[])).toEqual([
      "Anthony Edwards | 3.5 | 3PM",
      "LeBron James | 24.5 | PTS",
      "Nikola Jokic | 12.5 | REB",
      "Stephen Curry | 27.5 | PTS",
    ])
  })

  it("pairs a list board's right-aligned values with the right player", () => {
    // The regression: Clark's 8.5 Assists used to land on Breanna Stewart.
    expect(props(list as OcrLine[])).toEqual([
      "Aja Wilson | 24.5 | PTS",
      "Breanna Stewart | 32.5 | PRA",
      "Caitlin Clark | 8.5 | AST",
    ])
  })

  it("survives badges, a filter bar of stat words, hyphens, apostrophes and combo stats", () => {
    // The regression: "Blocked Shots" read as a name and took Collier's line.
    expect(props(hard as OcrLine[])).toEqual([
      "A'ja Wilson | 38.5 | PRA",
      "Breanna Stewart | 9.5 | REB",
      "Brittney Griner | 1.5 | BLK",
      "Caitlin Clark | 8.5 | AST",
      "Napheesa Collier | 2.5 | 3PM",
      "Skylar Diggins-Smith | 14.5 | PTS",
    ])
  })

  it("reads a real PrizePicks entry screen: name and arrowed value on one row, stat below", () => {
    // A user's own screenshot, cleaned up the way the engine does it. The
    // arrow reads as "T" or "7" and the decimal point is often lost, so every
    // value here is a repair and every one must be flagged for checking.
    const c = extractProps(lineup as OcrLine[]).candidates
    expect(c.map((x) => `${x.player} | ${x.line} | ${x.marketKey}`).sort()).toEqual([
      "Jonquel Jones | 1.5 | AST",
      "Leonie Fiebich | 0.5 | 3PM",
      "Napheesa Collier | 1.5 | AST",
      "Olivia Miles | 0.5 | 3PM",
    ])
    expect(c.every((x) => x.issues.some((i) => /Check it against the app/.test(i)))).toBe(true)
  })

  it("never pairs a value with a player below it", () => {
    // Positions without the name above them: nothing is the right answer.
    const lines: OcrLine[] = [
      { text: "24.5 Points", bbox: { x0: 800, y0: 50, x1: 1100, y1: 90 } },
      { text: "LeBron James", bbox: { x0: 50, y0: 200, x1: 300, y1: 240 } },
    ]
    expect(extractProps(lines).candidates).toEqual([])
  })
})

describe("merging the raw and cleaned reads", () => {
  const cand = (player: string, line: number): PropCandidate => ({
    player, marketKey: "PTS", marketLabel: "Points", rawMarket: "Points", line,
    confidence: 0.9, sourceLines: [0], issues: [],
  })

  it("keeps one copy when the reads agree", () => {
    expect(mergeReads([cand("LeBron James", 24.5)], [cand("LeBron James", 24.5)])).toHaveLength(1)
  })

  it("keeps the raw value and flags it when the reads disagree", () => {
    // Measured: cleanup turned a large 3.5 into 3.9. Never pick silently.
    const [m] = mergeReads([cand("Anthony Edwards", 3.5)], [cand("Anthony Edwards", 3.9)])
    expect(m.line).toBe(3.5)
    expect(m.issues.join(" ")).toMatch(/disagree: 3.5 and 3.9/)
  })

  it("adds props only the cleaned read found", () => {
    expect(mergeReads([], [cand("Olivia Miles", 0.5)]).map((c) => c.player)).toEqual(["Olivia Miles"])
  })
})

describe("typed and pasted text", () => {
  const typed = (t: string) => props(linesFromText(t))

  it("reads one prop per line", () => {
    expect(typed("LeBron James 24.5 Points\nStephen Curry 27.5 Points")).toEqual([
      "LeBron James | 24.5 | PTS",
      "Stephen Curry | 27.5 | PTS",
    ])
  })

  it("ignores over/under and accepts shorthand", () => {
    expect(typed("Caitlin Clark over 8.5 assists\nLeBron James o24.5 pts\nJalen Brunson u6.5 ast")).toEqual([
      "Caitlin Clark | 8.5 | AST",
      "Jalen Brunson | 6.5 | AST",
      "LeBron James | 24.5 | PTS",
    ])
  })

  it("accepts the stat before the value, and separators", () => {
    expect(typed("LeBron James: Points 24.5\nShai Gilgeous-Alexander - 31.5 - Pts+Rebs+Asts")).toEqual([
      "LeBron James | 24.5 | PTS",
      "Shai Gilgeous-Alexander | 31.5 | PRA",
    ])
  })

  it("accepts comma-separated lines with no header", () => {
    expect(typed("LeBron James, 24.5, Points")).toEqual(["LeBron James | 24.5 | PTS"])
  })

  it("capitalises a lowercase name", () => {
    expect(typed("lebron james 24.5 points")).toEqual(["Lebron James | 24.5 | PTS"])
  })

  it("keeps the full stop in Jr. and initials", () => {
    expect(typed("Jaren Jackson Jr. 1.5 Blocks\nP.J. Washington 6.5 Rebounds")).toEqual([
      "Jaren Jackson Jr. | 1.5 | BLK",
      "P.J. Washington | 6.5 | REB",
    ])
  })

  it("finds the name after leading junk such as a date", () => {
    expect(typed("Tue Sep 26 Tyrese Haliburton 2.5 threes")).toEqual(["Tyrese Haliburton | 2.5 | 3PM"])
  })

  it("flags a surname-only entry for review instead of guessing", () => {
    const c = extractProps(linesFromText("jokic 12.5 reb")).candidates
    expect(c).toHaveLength(1)
    expect(c[0].issues.join(" ")).toMatch(/full name/)
  })

  it("still reads the stacked layout", () => {
    expect(typed("LAL - F\nLeBron James\nvs GSW Tue 7:30pm\n24.5\nPoints\nLess\nMore")).toEqual([
      "LeBron James | 24.5 | PTS",
    ])
  })

  it("reads name and value on one line with the stat on the next", () => {
    expect(typed("Jonquel Jones 1.5\nAssists\nOlivia Miles 0.5\n3PTM")).toEqual([
      "Jonquel Jones | 1.5 | AST",
      "Olivia Miles | 0.5 | 3PM",
    ])
  })

  it("returns nothing for text with no prop in it", () => {
    expect(typed("hello this is not a prop")).toEqual([])
  })
})

describe("/api/odds", () => {
  afterEach(() => vi.unstubAllGlobals())

  function stubFeed(events: { id: string; commence_time: string }[]) {
    const urls: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url)
        const body = url.includes("/odds?")
          ? { id: "x", home_team: "H", away_team: "A", commence_time: "", bookmakers: [] }
          : events.map((e) => ({ ...e, home_team: "H", away_team: "A", sport_key: "k" }))
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "x-requests-remaining": "400", "x-requests-used": "100" },
        })
      }),
    )
    return urls
  }

  const post = async (body: object) => {
    const { POST } = await import("@/app/api/odds/route")
    return POST(new Request("http://t/api/odds", { method: "POST", body: JSON.stringify({ apiKey: "k", ...body }) }))
  }

  it("queries the requested league's feed", async () => {
    const urls = stubFeed([])
    await post({ league: "wnba", markets: ["player_points"] })
    expect(urls[0]).toContain("/sports/basketball_wnba/")
  })

  it("prices only games in the window, capped, instead of every game the feed lists", async () => {
    // The regression: with no window, a press priced weeks of games at once.
    const now = Date.parse("2026-10-20T16:00:00Z")
    const at = (h: number) => new Date(now + h * 3600 * 1000).toISOString()
    const events = [
      ...Array.from({ length: 12 }, (_, i) => ({ id: `today-${i}`, commence_time: at(3 + i * 0.25) })),
      ...Array.from({ length: 40 }, (_, i) => ({ id: `later-${i}`, commence_time: at(48 + i * 6) })),
    ]
    const urls = stubFeed(events)
    const res = await post({
      league: "nba",
      markets: ["player_points"],
      from: new Date(now).toISOString(),
      to: at(20),
      maxGames: 5,
    })
    const data = await res.json()
    const oddsCalls = urls.filter((u) => u.includes("/odds?"))
    expect(oddsCalls).toHaveLength(5)
    expect(oddsCalls.every((u) => u.includes("/events/today-"))).toBe(true)
    expect(data.cappedOut).toBe(7)
  })

  it("rejects an unknown league rather than falling back to the NBA", async () => {
    stubFeed([])
    const res = await post({ league: "nfl" })
    expect(res.status).toBe(400)
  })
})
