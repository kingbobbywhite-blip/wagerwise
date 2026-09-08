import { describe, expect, it } from "vitest"
import { appsOnBoard, boardToCandidates, buildBoard } from "@/lib/quant/board"
import { projectSlate, type RawPropRow } from "@/lib/quant/projection"

const pin = (line: number, over = -110, under = -110) => [{ book: "pinnacle", line, overOdds: over, underOdds: under }]

const slate: RawPropRow[] = [
  // Same player and market posted at two different numbers on two apps.
  { player: "Anthony Edwards", team: "MIN", opponent: "OKC", gameId: "g1", market: "Points", line: 24.5, quotes: pin(25.5), app: "prizepicks" },
  { player: "Anthony Edwards", team: "MIN", opponent: "OKC", gameId: "g1", market: "Points", line: 26.5, quotes: pin(25.5), app: "underdog" },
  { player: "Rudy Gobert", team: "MIN", opponent: "OKC", gameId: "g1", market: "Rebounds", line: 11.5, quotes: pin(11.5, -120, 100), app: "prizepicks" },
]

describe("buildBoard", () => {
  const rows = buildBoard(projectSlate(slate))

  it("groups every offer for a player and market into one row", () => {
    const edwards = rows.find((r) => r.player === "Anthony Edwards")!
    expect(edwards.offers).toHaveLength(2)
    expect(rows).toHaveLength(2)
  })

  it("picks the lowest line for the over and the highest for the under", () => {
    const edwards = rows.find((r) => r.player === "Anthony Edwards")!
    expect(edwards.bestOver!.offer.line).toBe(24.5)
    expect(edwards.bestOver!.offer.app).toBe("prizepicks")
    expect(edwards.bestUnder!.offer.line).toBe(26.5)
    expect(edwards.bestUnder!.offer.app).toBe("underdog")
  })

  it("measures the spread between apps and what shopping is worth", () => {
    const edwards = rows.find((r) => r.player === "Anthony Edwards")!
    expect(edwards.lineSpread).toBe(2)
    expect(edwards.shoppingGainPct).toBeGreaterThan(5)
  })

  it("recommends a side with a fair price attached", () => {
    const edwards = rows.find((r) => r.player === "Anthony Edwards")!
    expect(edwards.recommended).not.toBeNull()
    expect(edwards.recommended!.pWin).toBeGreaterThan(0.5)
    expect(Number.isFinite(edwards.recommended!.fairAmerican)).toBe(true)
  })

  it("lists the apps present on the slate", () => {
    expect(appsOnBoard(rows)).toEqual(["prizepicks", "underdog"])
  })
})

describe("pricing status on the board", () => {
  it("marks a row priced when a sportsbook price is behind it", () => {
    const rows = buildBoard(projectSlate(slate))
    expect(rows.every((r) => r.status === "priced")).toBe(true)
    expect(rows[0].hasSharpBook).toBe(true)
    expect(rows[0].books[0].book).toBe("pinnacle")
  })

  it("marks a row unpriced when it has no odds", () => {
    const rows = buildBoard(
      projectSlate([{ player: "No Odds", market: "Points", line: 20.5, gameLog: [18, 22, 25, 19, 21, 24, 20, 23] }]),
    )
    expect(rows[0].status).toBe("unpriced")
    expect(rows[0].unpricedReason).toMatch(/No sportsbook price/)
  })

  it("sorts priced rows ahead of unpriced ones", () => {
    const rows = buildBoard(
      projectSlate([
        { player: "No Odds", market: "Assists", line: 4.5, gameLog: [4, 6, 5, 7, 3, 5, 6, 4] },
        ...slate,
      ]),
    )
    expect(rows[0].status).toBe("priced")
    expect(rows[rows.length - 1].status).toBe("unpriced")
  })

  it("ignores unpriced offers in the consensus once a priced one exists", () => {
    const rows = buildBoard(
      projectSlate([
        { player: "Anthony Edwards", team: "MIN", market: "Points", line: 24.5, quotes: pin(25.5), app: "prizepicks" },
        { player: "Anthony Edwards", team: "MIN", market: "Points", line: 24.5, gameLog: Array(10).fill(40), app: "underdog" },
      ]),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe("priced")
    // The 40-point game log must not drag the market consensus upward.
    expect(rows[0].mean).toBeLessThan(28)
  })
})

describe("boardToCandidates", () => {
  const rows = buildBoard(projectSlate(slate))

  it("carries the pricing status through to the candidate", () => {
    expect(boardToCandidates(rows).every((c) => c.status === "priced")).toBe(true)
  })

  it("emits one candidate per row, on the recommended side only", () => {
    const c = boardToCandidates(rows)
    expect(c).toHaveLength(2)
    expect(new Set(c.map((x) => x.player)).size).toBe(2)
  })

  it("filters to a single app when asked", () => {
    const c = boardToCandidates(rows, "underdog")
    expect(c.every((x) => x.app === "underdog")).toBe(true)
  })

  it("carries a game key so correlation can see same-game legs", () => {
    const c = boardToCandidates(rows)
    expect(c.every((x) => !!x.gameId)).toBe(true)
  })
})
