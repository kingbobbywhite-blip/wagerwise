import { describe, expect, it } from "vitest"
import { appsOnBoard, boardToCandidates, buildBoard } from "@/lib/quant/board"
import { projectSlate, type RawPropRow } from "@/lib/quant/projection"

const slate: RawPropRow[] = [
  // Same player and market posted at two different numbers on two apps.
  { player: "Anthony Edwards", team: "MIN", opponent: "OKC", gameId: "g1", market: "Points", line: 24.5, bookLine: 25.5, overOdds: -110, underOdds: -110, app: "prizepicks" },
  { player: "Anthony Edwards", team: "MIN", opponent: "OKC", gameId: "g1", market: "Points", line: 26.5, bookLine: 25.5, overOdds: -110, underOdds: -110, app: "underdog" },
  { player: "Rudy Gobert", team: "MIN", opponent: "OKC", gameId: "g1", market: "Rebounds", line: 11.5, bookLine: 11.5, overOdds: -120, underOdds: 100, app: "prizepicks" },
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

describe("boardToCandidates", () => {
  const rows = buildBoard(projectSlate(slate))

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
