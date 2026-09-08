import { describe, expect, it } from "vitest"
import { optimizeSlips, type CandidateLeg } from "@/lib/quant/optimizer"
import { DEFAULT_APPS, findApp, findMode } from "@/lib/quant/payouts"

const power = findMode(findApp(DEFAULT_APPS, "prizepicks"), "power")!
const flex = findMode(findApp(DEFAULT_APPS, "prizepicks"), "flex")!

const NAMES = [
  "Devin Booker", "Jalen Brunson", "Cade Cunningham", "Franz Wagner", "Alperen Sengun",
  "Scottie Barnes", "Tyrese Maxey", "Paolo Banchero", "Jalen Williams", "Desmond Bane",
]
const MARKETS = ["PTS", "REB", "AST", "3PM", "STL"] as const

function pool(pWins: number[]): CandidateLeg[] {
  return pWins.map((p, i) => ({
    id: `leg${i}`,
    player: NAMES[i % NAMES.length],
    team: `T${i % 6}`,
    opponent: `O${i % 6}`,
    gameId: `g${i % 5}`,
    market: MARKETS[i % MARKETS.length],
    marketLabel: MARKETS[i % MARKETS.length],
    line: 20.5,
    side: "OVER" as const,
    pWin: p,
    pPush: 0,
    american: null,
    status: "priced" as const,
    confidence: 70,
    lineEdge: (p - 0.5) * 10,
    lineEdgeZ: (p - 0.5) * 2,
    app: "prizepicks",
  }))
}

describe("optimizeSlips", () => {
  it("refuses to build from unpriced legs", () => {
    const legs = pool([0.7, 0.69, 0.68, 0.67, 0.66, 0.65]).map((l) => ({ ...l, status: "unpriced" as const }))
    expect(
      optimizeSlips(legs, { mode: power, constraints: { picks: 4, maxPerGame: 4, maxPerTeam: 4 }, objectives: ["ev"] }),
    ).toEqual([])
  })

  it("ignores unpriced legs while still using the priced ones", () => {
    const legs = pool([0.7, 0.69, 0.68, 0.67, 0.66, 0.65, 0.64, 0.63])
    legs[0].status = "unpriced"
    legs[1].status = "unpriced"
    const slips = optimizeSlips(legs, {
      mode: power,
      constraints: { picks: 4, maxPerGame: 4, maxPerTeam: 4 },
      objectives: ["ev"],
      count: 2,
    })
    expect(slips.length).toBeGreaterThan(0)
    for (const s of slips) {
      for (const l of s.legs) expect(l.status).toBe("priced")
      expect(s.legs.some((l) => l.id === "leg0" || l.id === "leg1")).toBe(false)
    }
  })

  it("reports the break-even hit rate beside expected value", () => {
    const slips = optimizeSlips(pool([0.66, 0.65, 0.64, 0.63, 0.62, 0.61]), {
      mode: power,
      constraints: { picks: 4, maxPerGame: 4, maxPerTeam: 4 },
      objectives: ["ev"],
      count: 1,
    })
    const e = slips[0].evaluation
    expect(e.breakEvenLegProb).toBeCloseTo(Math.pow(1 / 10, 1 / 4), 6)
    expect(e.avgLegProb).toBeGreaterThan(0.6)
    expect(e.legProbMargin).toBeCloseTo(e.avgLegProb - e.breakEvenLegProb!, 8)
    expect(e.evAtAvgLegProb).not.toBeNull()
  })

  it("warns when an implausible payout produces a huge expected value", () => {
    const absurd = { id: "x", label: "Typo", blurb: "", table: { 4: { 4: 500 } } }
    const slips = optimizeSlips(pool([0.66, 0.65, 0.64, 0.63, 0.62]), {
      mode: absurd,
      constraints: { picks: 4, maxPerGame: 4, maxPerTeam: 4 },
      objectives: ["ev"],
      count: 1,
    })
    const w = slips[0].warnings.join(" ")
    expect(w).toMatch(/far larger than these markets normally offer/)
    expect(w).toMatch(/Break-even sits at/)
  })

  it("returns nothing when the pool is smaller than the entry", () => {
    expect(optimizeSlips(pool([0.6, 0.62]), { mode: power, constraints: { picks: 4 } })).toEqual([])
  })

  it("returns nothing when the entry size is not in the payout table", () => {
    expect(optimizeSlips(pool([0.6, 0.62, 0.64, 0.66, 0.68]), { mode: power, constraints: { picks: 7 } })).toEqual([])
  })

  it("builds entries of exactly the requested size", () => {
    const slips = optimizeSlips(pool([0.66, 0.65, 0.64, 0.63, 0.62, 0.61, 0.6, 0.59]), {
      mode: power,
      constraints: { picks: 4, maxPerGame: 4, maxPerTeam: 4 },
      objectives: ["ev"],
      count: 3,
    })
    expect(slips.length).toBeGreaterThan(0)
    for (const s of slips) expect(s.legs).toHaveLength(4)
  })

  it("prefers the stronger legs", () => {
    const slips = optimizeSlips(pool([0.72, 0.71, 0.7, 0.69, 0.52, 0.51, 0.5, 0.5]), {
      mode: power,
      constraints: { picks: 4, maxPerGame: 4, maxPerTeam: 4 },
      objectives: ["ev"],
      count: 1,
    })
    const avg = slips[0].legs.reduce((a, l) => a + l.pWin, 0) / 4
    expect(avg).toBeGreaterThan(0.65)
  })

  it("never repeats a player inside one entry by default", () => {
    const slips = optimizeSlips(pool([0.68, 0.67, 0.66, 0.65, 0.64, 0.63]), {
      mode: power,
      constraints: { picks: 4, maxPerGame: 4, maxPerTeam: 4 },
      objectives: ["ev"],
      count: 4,
    })
    for (const s of slips) {
      expect(new Set(s.legs.map((l) => l.player)).size).toBe(s.legs.length)
    }
  })

  it("honours the per-game cap", () => {
    const slips = optimizeSlips(pool([0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7]), {
      mode: power,
      constraints: { picks: 4, maxPerGame: 2, maxPerTeam: 4 },
      objectives: ["ev"],
      count: 3,
    })
    for (const s of slips) {
      const counts = new Map<string, number>()
      for (const l of s.legs) counts.set(l.gameId!, (counts.get(l.gameId!) ?? 0) + 1)
      for (const v of counts.values()) expect(v).toBeLessThanOrEqual(2)
    }
  })

  it("filters out legs below the probability floor", () => {
    const slips = optimizeSlips(pool([0.75, 0.74, 0.73, 0.72, 0.4, 0.4, 0.4]), {
      mode: power,
      constraints: { picks: 4, minLegProb: 0.6, maxPerGame: 4, maxPerTeam: 4 },
      objectives: ["ev"],
      count: 2,
    })
    for (const s of slips) for (const l of s.legs) expect(l.pWin).toBeGreaterThanOrEqual(0.6)
  })

  it("flags a negative expected value entry instead of hiding it", () => {
    const slips = optimizeSlips(pool([0.52, 0.52, 0.52, 0.52, 0.51, 0.51]), {
      mode: power,
      constraints: { picks: 4, minLegProb: 0.5, maxPerGame: 4, maxPerTeam: 4 },
      objectives: ["ev"],
      count: 1,
    })
    expect(slips.length).toBeGreaterThan(0)
    expect(slips[0].evaluation.ev).toBeLessThan(0)
    expect(slips[0].warnings.join(" ")).toMatch(/Negative expected value/)
  })

  it("returns entries that are not all the same legs", () => {
    const slips = optimizeSlips(pool([0.7, 0.69, 0.68, 0.67, 0.66, 0.65, 0.64, 0.63, 0.62, 0.61]), {
      mode: power,
      constraints: { picks: 4, maxPerGame: 4, maxPerTeam: 4 },
      objectives: ["ev", "growth", "floor"],
      count: 3,
      maxOverlap: 2,
    })
    for (let i = 0; i < slips.length; i++) {
      for (let j = i + 1; j < slips.length; j++) {
        const a = new Set(slips[i].legs.map((l) => l.id))
        let overlap = 0
        for (const l of slips[j].legs) if (a.has(l.id)) overlap++
        expect(overlap).toBeLessThanOrEqual(2)
      }
    }
  })

  it("gives a flex entry a floor that an all-or-nothing entry does not have", () => {
    const legs = pool([0.62, 0.61, 0.6, 0.59, 0.58])
    const cons = { picks: 5, maxPerGame: 5, maxPerTeam: 5 }
    const p = optimizeSlips(legs, { mode: power, constraints: cons, objectives: ["ev"], count: 1 })[0]
    const f = optimizeSlips(legs, { mode: flex, constraints: cons, objectives: ["ev"], count: 1 })[0]
    expect(p.evaluation.pLoseStake).toBeGreaterThan(f.evaluation.pLoseStake)
    expect(f.evaluation.outcomes.length).toBeGreaterThan(2)
  })

  it("produces a stable result for the same input", () => {
    const legs = pool([0.68, 0.67, 0.66, 0.65, 0.64, 0.63])
    const opts = { mode: power, constraints: { picks: 4, maxPerGame: 4, maxPerTeam: 4 }, objectives: ["ev"] as const, count: 2 }
    const a = optimizeSlips(legs, { ...opts, objectives: ["ev"] })
    const b = optimizeSlips(legs, { ...opts, objectives: ["ev"] })
    expect(a.map((s) => s.id)).toEqual(b.map((s) => s.id))
    expect(a[0].evaluation.ev).toBe(b[0].evaluation.ev)
  })
})
