import { describe, expect, it } from "vitest"
import { DEFAULT_APPS, capturedToMode } from "@/lib/quant/payouts"
import type { LegResult, TrackedLeg, TrackedSlip } from "@/lib/store/schema"
import { entryExpectation, openExposure, recordByType, settlementMode, withResults } from "@/lib/tracker/entries"

/**
 * The tracker against five real settled PrizePicks entries: four NFL 3-pick
 * power plays and one WNBA 4-pick, stakes and payouts as the app showed them.
 */

function leg(player: string, marketLabel: string, line: number, side: "OVER" | "UNDER", result: LegResult): TrackedLeg {
  return { player, marketKey: null, marketLabel, line, side, pWinAtEntry: null, app: "prizepicks", result, actual: null }
}

function slip(id: string, stake: number, payout: number, legs: TrackedLeg[]): TrackedSlip {
  const n = legs.length
  return {
    id, createdAt: "2026-09-27T17:00:00Z", settledAt: null, appId: "prizepicks", modeId: "power", legs, stake,
    capturedPayout: { picks: n, tiers: { [n]: payout / stake }, confirmed: true, capturedAt: "2026-09-27T17:00:00Z" },
    evAtEntry: null, pAllHitAtEntry: null, topMultiple: payout / stake, status: "PENDING", actualMultiple: null,
    notes: "", source: "logged",
  }
}

const settle = (s: TrackedSlip) => withResults(s, s.legs, DEFAULT_APPS)

describe("settling a real entry with a player who did not play", () => {
  it("scores 'win, loss, did not play' as a loss, not a refund", () => {
    // $2 for $12: Addison under 5.5 recs won, Allgeier over 2.5 rush yds lost,
    // Jack Bech did not play (Reboot). PrizePicks shrinks it to a 2-pick with
    // a loss in it. The tracker used to refund the $2.
    const s = settle(slip("a", 2, 12, [
      leg("Jordan Addison", "Receptions", 5.5, "UNDER", "WIN"),
      leg("Tyler Allgeier", "Rushing Yards", 2.5, "OVER", "LOSS"),
      leg("Jack Bech", "Receiving Yards", 0.5, "OVER", "VOID"),
    ]))
    expect(s.status).toBe("SETTLED")
    expect(s.actualMultiple).toBe(0)
  })

  it("pays the smaller entry's table when the rest all hit", () => {
    const s = settle(slip("b", 1, 6, [
      leg("A One", "Receptions", 5.5, "UNDER", "WIN"),
      leg("B Two", "Receptions", 5.5, "UNDER", "WIN"),
      leg("C Three", "Receptions", 5.5, "UNDER", "VOID"),
    ]))
    // A 2-pick power play from the stored table.
    expect(s.actualMultiple).toBe(DEFAULT_APPS[0].modes[0].table[2][2])
  })

  it("refunds when voids leave fewer picks than any entry allows", () => {
    const s = settle(slip("c", 1, 6, [
      leg("A One", "Receptions", 5.5, "UNDER", "VOID"),
      leg("B Two", "Receptions", 5.5, "UNDER", "VOID"),
      leg("C Three", "Receptions", 5.5, "UNDER", "WIN"),
    ]))
    expect(s.actualMultiple).toBe(1)
  })

  it("settles the full entry at the payout captured from the screen, goblins and all", () => {
    // $1 for $5.50: a goblin and a demon moved the 3-pick off the standard table.
    const s = settle(slip("d", 1, 5.5, [
      leg("Cade Otton", "Receiving Yards", 65.5, "UNDER", "WIN"),
      leg("George Pickens", "Receptions", 5.5, "UNDER", "WIN"),
      leg("Brock Bowers", "Receptions", 9.5, "UNDER", "WIN"),
    ]))
    expect(s.actualMultiple).toBe(5.5)
  })

  it("keeps the captured multiple for the full size in the settlement table", () => {
    const mode = settlementMode(slip("e", 4, 26.1, [leg("a", "x", 1, "OVER", "WIN"), leg("b", "x", 1, "OVER", "WIN"), leg("c", "x", 1, "OVER", "WIN"), leg("d", "x", 1, "OVER", "WIN")]), DEFAULT_APPS)
    expect(mode.table[4][4]).toBeCloseTo(6.525, 6)
    expect(mode.table[3]).toBeDefined()
  })
})

describe("expected value of an entry", () => {
  it("matches the closed form for an all-or-nothing 3-pick", () => {
    const mode = capturedToMode({ picks: 3, tiers: { 3: 6 }, confirmed: true, capturedAt: "" })
    const r = entryExpectation([0.55, 0.55, 0.55], mode)!
    expect(r.pAllHit).toBeCloseTo(0.55 ** 3, 9)
    expect(r.ev).toBeCloseTo(6 * 0.55 ** 3 - 1, 9)
  })

  it("refuses to guess when any leg was never priced", () => {
    const mode = capturedToMode({ picks: 3, tiers: { 3: 6 }, confirmed: true, capturedAt: "" })
    expect(entryExpectation([0.55, null, 0.6], mode)).toBeNull()
  })
})

describe("exposure across open entries", () => {
  it("flags the same player in two open entries", () => {
    // Brock Bowers under 9.5 receptions was in two of the four NFL entries.
    const one = slip("x", 1, 5.5, [leg("Brock Bowers", "Receptions", 9.5, "UNDER", "PENDING"), leg("Cade Otton", "Receiving Yards", 65.5, "UNDER", "PENDING")])
    const two = slip("y", 1, 6, [leg("Brock Bowers", "Receptions", 9.5, "UNDER", "PENDING"), leg("Kaelon Black", "Rushing Yards", 14.5, "OVER", "PENDING")])
    const e = openExposure([one, two])
    expect(e).toHaveLength(1)
    expect(e[0].player).toBe("Brock Bowers")
    expect(e[0].entries).toBe(2)
    expect(e[0].conflicting).toBe(false)
  })

  it("calls out an over in one entry and an under in another", () => {
    const one = slip("x", 1, 6, [leg("Jack Bech", "Receiving Yards", 0.5, "OVER", "PENDING")])
    const two = slip("y", 1, 6, [leg("Jack Bech", "Receiving Yards", 4.5, "UNDER", "PENDING")])
    expect(openExposure([one, two])[0].conflicting).toBe(true)
  })

  it("ignores settled entries", () => {
    const one = settle(slip("x", 1, 6, [leg("Brock Bowers", "Receptions", 9.5, "UNDER", "LOSS")]))
    const two = slip("y", 1, 6, [leg("Brock Bowers", "Receptions", 9.5, "UNDER", "PENDING")])
    expect(openExposure([one, two])).toHaveLength(0)
  })
})

describe("record by leg type", () => {
  it("groups settled legs by stat and side, and leaves out voids", () => {
    const s = [
      settle(slip("a", 1, 6, [leg("Addison", "Receptions", 5.5, "UNDER", "WIN"), leg("Pickens", "Receptions", 5.5, "UNDER", "LOSS"), leg("Bech", "Receiving Yards", 0.5, "OVER", "VOID")])),
      settle(slip("b", 1, 6, [leg("Bowers", "Receptions", 9.5, "UNDER", "LOSS"), leg("Wilson", "Receptions", 7.5, "UNDER", "LOSS"), leg("Black", "Rushing Yards", 14.5, "OVER", "WIN")])),
    ]
    const r = recordByType(s)
    expect(r.byType[0]).toEqual({ label: "Receptions unders", wins: 1, losses: 3 })
    expect(r.byType.find((x) => x.label === "Receiving Yards overs")).toBeUndefined()
    expect(r.unpriced.wins + r.unpriced.losses).toBe(5)
    expect(r.priced.wins + r.priced.losses).toBe(0)
  })
})

import { legsFromText } from "@/lib/tracker/entries"

describe("typing an entry's legs", () => {
  it("reads player, line, stat, side and result from each line", () => {
    const legs = legsFromText(
      "Jordan Addison under 5.5 Recs win\nTyler Allgeier over 2.5 Rush Yards loss\nJack Bech over 0.5 Rec Yards dnp\nKiki Iriafen more 9 Rebounds",
    )
    expect(legs.map((l) => `${l.player} | ${l.side} | ${l.line} | ${l.marketKey} | ${l.result}`)).toEqual([
      "Jordan Addison | UNDER | 5.5 | REC | WIN",
      "Tyler Allgeier | OVER | 2.5 | RUSH_YDS | LOSS",
      "Jack Bech | OVER | 0.5 | REC_YDS | VOID",
      "Kiki Iriafen | OVER | 9 | REB | PENDING",
    ])
  })

  it("keeps a line it cannot read, with a note, instead of dropping it", () => {
    const legs = legsFromText("something unreadable")
    expect(legs).toHaveLength(1)
    expect(legs[0].note).toMatch(/Could not read/)
  })
})
