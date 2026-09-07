import { describe, expect, it } from "vitest"
import {
  approxJointAllHit,
  bivariateUpper,
  dfsPayout,
  evaluateSlip,
  kellyForOutcomes,
  oddsParlayPayout,
  simulateSlip,
  type EvalLeg,
} from "@/lib/quant/evaluate"
import { DEFAULT_APPS, breakEvenLegProb, findApp, findMode, payoutMultiple } from "@/lib/quant/payouts"
import { normalCdf } from "@/lib/quant/math"
import { DEFAULT_CORRELATION, legCorrelation } from "@/lib/quant/correlation"

function leg(over: Partial<EvalLeg> & { id: string; pWin: number }): EvalLeg {
  return {
    player: over.id,
    team: null,
    opponent: null,
    gameId: null,
    market: "PTS",
    marketLabel: "Points",
    line: 20.5,
    side: "OVER",
    pPush: 0,
    ...over,
  } as EvalLeg
}

const INDEPENDENT = { strength: 0, teammateUsage: 0, gamePace: 0, assistLink: 0 }

// Distinct real-looking names: name normalisation strips digits, so "l0" and
// "l1" would collapse to the same player and correlate at 0.99.
const NAMES = ["Devin Booker", "Jalen Brunson", "Cade Cunningham", "Franz Wagner", "Alperen Sengun", "Scottie Barnes"]

describe("bivariateUpper", () => {
  it("reduces to the product when uncorrelated", () => {
    expect(bivariateUpper(0, 0, 0)).toBeCloseTo(0.25, 8)
    expect(bivariateUpper(1, -0.5, 0)).toBeCloseTo((1 - normalCdf(1)) * (1 - normalCdf(-0.5)), 8)
  })
  it("approaches the marginal as correlation approaches one", () => {
    const marginal = 1 - normalCdf(0.4)
    const strong = bivariateUpper(0.4, 0.4, 0.97)
    // Well above the independent product, but still capped by the marginal.
    expect(strong).toBeGreaterThan(marginal * marginal * 2)
    expect(strong).toBeLessThanOrEqual(marginal + 1e-9)
  })
  it("increases with correlation for the same thresholds", () => {
    const a = bivariateUpper(0.5, 0.5, -0.5)
    const b = bivariateUpper(0.5, 0.5, 0)
    const c = bivariateUpper(0.5, 0.5, 0.5)
    expect(a).toBeLessThan(b)
    expect(b).toBeLessThan(c)
  })
})

describe("simulateSlip", () => {
  const allOrNothing = (wins: number, pushes: number, picks: number) => (wins === picks - pushes ? 10 : 0)

  it("reproduces the independent product when correlations are off", () => {
    const legs = [
      leg({ id: "a", player: NAMES[0], pWin: 0.6 }),
      leg({ id: "b", player: NAMES[1], pWin: 0.55 }),
      leg({ id: "c", player: NAMES[2], pWin: 0.7 }),
    ]
    const r = simulateSlip(legs, allOrNothing, { simulations: 200000, correlation: INDEPENDENT, seed: 1 })
    expect(r.pAllHit).toBeCloseTo(0.6 * 0.55 * 0.7, 2)
  })

  it("is deterministic for a fixed seed", () => {
    const legs = [leg({ id: "a", player: NAMES[0], pWin: 0.6 }), leg({ id: "b", player: NAMES[1], pWin: 0.55 })]
    const a = simulateSlip(legs, allOrNothing, { simulations: 5000, seed: 99 })
    const b = simulateSlip(legs, allOrNothing, { simulations: 5000, seed: 99 })
    expect(a.pAllHit).toBe(b.pAllHit)
  })

  it("raises the all-hit probability when legs are positively correlated", () => {
    const legs: EvalLeg[] = [
      leg({ id: "a", pWin: 0.6, player: "LeBron James", market: "PTS", team: "LAL", opponent: "BOS", gameId: "g1" }),
      leg({ id: "b", pWin: 0.6, player: "LeBron James", market: "3PM", team: "LAL", opponent: "BOS", gameId: "g1" }),
    ]
    const corr = simulateSlip(legs, allOrNothing, { simulations: 120000, seed: 5 })
    const indep = simulateSlip(legs, allOrNothing, { simulations: 120000, seed: 5, correlation: INDEPENDENT })
    expect(corr.pAllHit).toBeGreaterThan(indep.pAllHit + 0.02)
    expect(indep.pAllHit).toBeCloseTo(0.36, 2)
  })

  it("lowers the all-hit probability when legs oppose each other", () => {
    const legs: EvalLeg[] = [
      leg({ id: "a", pWin: 0.6, player: "Nikola Jokic", market: "PTS", side: "OVER", team: "DEN", opponent: "PHX", gameId: "g2" }),
      leg({ id: "b", pWin: 0.6, player: "Nikola Jokic", market: "3PM", side: "UNDER", team: "DEN", opponent: "PHX", gameId: "g2" }),
    ]
    const corr = simulateSlip(legs, allOrNothing, { simulations: 120000, seed: 6 })
    const indep = simulateSlip(legs, allOrNothing, { simulations: 120000, seed: 6, correlation: INDEPENDENT })
    expect(corr.pAllHit).toBeLessThan(indep.pAllHit - 0.02)
  })

  it("voids a pushed leg and shrinks the entry", () => {
    const mode = findMode(findApp(DEFAULT_APPS, "prizepicks"), "power")!
    const payout = dfsPayout(mode)
    // 3 picks paying 5x; if one pushes it becomes a 2-pick paying 3x.
    // DFS tables settle on counts alone, so the outcome vector is unused.
    const none = new Int8Array(3)
    expect(payout(3, 0, 3, none)).toBe(5)
    expect(payout(2, 1, 3, none)).toBe(3)
    expect(payout(1, 1, 3, none)).toBe(0)
    // Shrinking below the smallest entry refunds the stake.
    expect(payout(1, 2, 3, none)).toBe(1)
  })
})

describe("payout tables", () => {
  it("prices a PrizePicks power play", () => {
    const mode = findMode(findApp(DEFAULT_APPS, "prizepicks"), "power")!
    expect(payoutMultiple(mode, 4, 4)).toBe(10)
    expect(payoutMultiple(mode, 4, 3)).toBe(0)
  })

  it("pays partial hits on a flex play", () => {
    const mode = findMode(findApp(DEFAULT_APPS, "prizepicks"), "flex")!
    expect(payoutMultiple(mode, 5, 5)).toBe(10)
    expect(payoutMultiple(mode, 5, 4)).toBe(2)
    expect(payoutMultiple(mode, 5, 3)).toBe(0.4)
    expect(payoutMultiple(mode, 5, 2)).toBe(0)
  })

  it("shows how high the per-leg bar really is", () => {
    const mode = findMode(findApp(DEFAULT_APPS, "prizepicks"), "power")!
    // A 4-pick paying 10x needs 56.2% per leg just to break even.
    expect(breakEvenLegProb(mode, 4)!).toBeCloseTo(0.5623, 3)
    // A 6-pick paying 37.5x needs 54.7% per leg.
    expect(breakEvenLegProb(mode, 6)!).toBeCloseTo(Math.pow(1 / 37.5, 1 / 6), 6)
    expect(breakEvenLegProb(mode, 6)!).toBeCloseTo(0.5466, 3)
    // Two picks at 3x needs 57.7%, the hardest of the lot.
    expect(breakEvenLegProb(mode, 2)!).toBeCloseTo(0.5774, 3)
  })
})

describe("evaluateSlip", () => {
  const mode = findMode(findApp(DEFAULT_APPS, "prizepicks"), "power")!

  it("returns negative expected value on coin-flip legs", () => {
    const legs = [0.5, 0.5, 0.5, 0.5].map((p, i) => leg({ id: `l${i}`, player: NAMES[i], pWin: p }))
    const e = evaluateSlip(legs, dfsPayout(mode), { simulations: 250000, correlation: INDEPENDENT, seed: 3 })
    // 0.5^4 * 10 = 0.625, so a 37.5% loss per dollar. Tolerance is roughly four
    // Monte-Carlo standard errors at this sample size.
    expect(Math.abs(e.ev - -0.375)).toBeLessThan(0.02)
  })

  it("turns positive once every leg clears the break-even rate", () => {
    const legs = [0.6, 0.6, 0.6, 0.6].map((p, i) => leg({ id: `l${i}`, player: NAMES[i], pWin: p }))
    const e = evaluateSlip(legs, dfsPayout(mode), { simulations: 250000, correlation: INDEPENDENT, seed: 4 })
    // 0.6^4 * 10 = 1.296
    expect(Math.abs(e.ev - 0.296)).toBeLessThan(0.02)
    expect(e.kelly).toBeGreaterThan(0)
  })

  it("reports how much correlation changed the answer", () => {
    const legs: EvalLeg[] = [
      leg({ id: "a", pWin: 0.58, player: "Anthony Edwards", market: "PTS", team: "MIN", opponent: "OKC", gameId: "g3" }),
      leg({ id: "b", pWin: 0.58, player: "Anthony Edwards", market: "3PM", team: "MIN", opponent: "OKC", gameId: "g3" }),
      leg({ id: "c", pWin: 0.58, player: "Rudy Gobert", market: "REB", team: "MIN", opponent: "OKC", gameId: "g3" }),
    ]
    const e = evaluateSlip(legs, dfsPayout(mode), { simulations: 60000, seed: 11 })
    expect(e.ev).toBeGreaterThan(e.evIndependent)
    expect(e.avgPairCorrelation).toBeGreaterThan(0)
  })

  it("never returns a Kelly stake on a losing slip", () => {
    const legs = [0.5, 0.5, 0.5, 0.5].map((p, i) => leg({ id: `l${i}`, player: NAMES[i], pWin: p }))
    const e = evaluateSlip(legs, dfsPayout(mode), { simulations: 20000, correlation: INDEPENDENT, seed: 8 })
    expect(e.kelly).toBe(0)
  })
})

describe("kellyForOutcomes", () => {
  it("matches the closed form on a simple two-outcome bet", () => {
    // p=0.6 at even money: f* = (b*p - q)/b = (0.6 - 0.4)/1 = 0.2
    const f = kellyForOutcomes([
      { multiple: 2, prob: 0.6 },
      { multiple: 0, prob: 0.4 },
    ])
    expect(f).toBeCloseTo(0.2, 6)
  })

  it("matches the closed form at 3-to-1", () => {
    // b=3, p=0.4: f* = (3*0.4 - 0.6)/3 = 0.2
    const f = kellyForOutcomes([
      { multiple: 4, prob: 0.4 },
      { multiple: 0, prob: 0.6 },
    ])
    expect(f).toBeCloseTo(0.2, 6)
  })

  it("stakes nothing on a negative edge", () => {
    expect(kellyForOutcomes([{ multiple: 2, prob: 0.45 }, { multiple: 0, prob: 0.55 }])).toBe(0)
  })

  it("handles a three-outcome flex payout", () => {
    const f = kellyForOutcomes([
      { multiple: 10, prob: 0.12 },
      { multiple: 2, prob: 0.3 },
      { multiple: 0, prob: 0.58 },
    ])
    expect(f).toBeGreaterThan(0)
    expect(f).toBeLessThan(1)
  })
})

describe("approxJointAllHit", () => {
  it("is exact for a single leg", () => {
    expect(approxJointAllHit([leg({ id: "a", pWin: 0.63 })])).toBeCloseTo(0.63, 8)
  })

  it("matches the product under independence", () => {
    const legs = [leg({ id: "a", player: NAMES[0], pWin: 0.6 }), leg({ id: "b", player: NAMES[1], pWin: 0.55 })]
    expect(approxJointAllHit(legs, INDEPENDENT)).toBeCloseTo(0.33, 3)
  })

  it("tracks the simulator closely on a correlated pair", () => {
    const legs: EvalLeg[] = [
      leg({ id: "a", pWin: 0.6, player: "Luka Doncic", market: "PTS", team: "DAL", opponent: "SAS", gameId: "g4" }),
      leg({ id: "b", pWin: 0.55, player: "Luka Doncic", market: "AST", team: "DAL", opponent: "SAS", gameId: "g4" }),
    ]
    const approx = approxJointAllHit(legs)
    const sim = simulateSlip(legs, (w, p, n) => (w === n - p ? 1 : 0), { simulations: 200000, seed: 21 })
    expect(approx).toBeCloseTo(sim.pAllHit, 2)
  })
})

describe("legCorrelation", () => {
  it("links a player's points and threes strongly", () => {
    const a = { player: "Stephen Curry", team: "GSW", opponent: "LAL", gameId: "g", market: "PTS" as const, isOver: true }
    const b = { player: "Stephen Curry", team: "GSW", opponent: "LAL", gameId: "g", market: "3PM" as const, isOver: true }
    expect(legCorrelation(a, b, DEFAULT_CORRELATION)).toBeGreaterThan(0.35)
  })

  it("flips sign when the sides oppose", () => {
    const a = { player: "Stephen Curry", team: "GSW", opponent: "LAL", gameId: "g", market: "PTS" as const, isOver: true }
    const b = { player: "Stephen Curry", team: "GSW", opponent: "LAL", gameId: "g", market: "3PM" as const, isOver: false }
    expect(legCorrelation(a, b, DEFAULT_CORRELATION)).toBeLessThan(0)
  })

  it("treats points and PRA for one player as nearly the same bet", () => {
    const a = { player: "Jayson Tatum", team: "BOS", opponent: "NYK", gameId: "g", market: "PTS" as const, isOver: true }
    const b = { player: "Jayson Tatum", team: "BOS", opponent: "NYK", gameId: "g", market: "PRA" as const, isOver: true }
    expect(legCorrelation(a, b, DEFAULT_CORRELATION)).toBeGreaterThan(0.6)
  })

  it("keeps different games close to independent", () => {
    const a = { player: "A", team: "BOS", opponent: "NYK", gameId: "g1", market: "PTS" as const, isOver: true }
    const b = { player: "B", team: "DEN", opponent: "PHX", gameId: "g2", market: "PTS" as const, isOver: true }
    expect(Math.abs(legCorrelation(a, b, DEFAULT_CORRELATION))).toBeLessThan(0.05)
  })
})

describe("oddsParlayPayout", () => {
  const three = [
    leg({ id: "a", player: NAMES[0], pWin: 0.6, american: -110 }),
    leg({ id: "b", player: NAMES[1], pWin: 0.55, american: 120 }),
    leg({ id: "c", player: NAMES[2], pWin: 0.5, american: -140 }),
  ]

  it("pays the exact product of the leg prices", () => {
    const pay = oddsParlayPayout(three)
    const all = Int8Array.from([1, 1, 1])
    const expected = (1 + 100 / 110) * 2.2 * (1 + 100 / 140)
    expect(pay(3, 0, 3, all)).toBeCloseTo(expected, 9)
  })

  it("pays nothing when a leg loses", () => {
    expect(oddsParlayPayout(three)(2, 0, 3, Int8Array.from([1, 1, -1]))).toBe(0)
  })

  it("drops a pushed leg out of the product rather than losing the parlay", () => {
    const pay = oddsParlayPayout(three)
    const pushed = Int8Array.from([1, 0, 1])
    const expected = (1 + 100 / 110) * (1 + 100 / 140)
    expect(pay(2, 1, 3, pushed)).toBeCloseTo(expected, 9)
  })

  it("takes commission off the net winnings only", () => {
    const plain = oddsParlayPayout(three)(3, 0, 3, Int8Array.from([1, 1, 1]))
    const charged = oddsParlayPayout(three, 0.02)(3, 0, 3, Int8Array.from([1, 1, 1]))
    expect(charged).toBeCloseTo(1 + (plain - 1) * 0.98, 9)
  })

  it("prices a two-leg -110 parlay at 2.64 times the stake", () => {
    const two = [
      leg({ id: "a", player: NAMES[0], pWin: 0.5, american: -110 }),
      leg({ id: "b", player: NAMES[1], pWin: 0.5, american: -110 }),
    ]
    expect(oddsParlayPayout(two)(2, 0, 2, Int8Array.from([1, 1]))).toBeCloseTo(3.6446, 3)
  })
})
