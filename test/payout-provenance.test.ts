import { describe, expect, it } from "vitest"
import {
  DEFAULT_APPS,
  capturedPayoutChanged,
  PLACEHOLDER_LEG_BAR,
  findApp,
  findMode,
  payoutMultiple,
  payoutVerified,
  pickemBar,
  pickemPricingMode,
  pickemPricingModeFor,
  type BookApp,
  type CapturedPayout,
} from "@/lib/quant/payouts"

/**
 * Which of these numbers has anybody actually checked?
 *
 * The Today screen's per-leg bar comes off a stored payout table, and that bar
 * decides which props become pick'em targets at all and which side each row
 * recommends. The app's rule is that it does not present a number it cannot
 * verify, so where the bar came from has to be answerable in code before it
 * can be said on screen.
 */

const dated = (app: BookApp, on: string): BookApp => ({ ...app, verifiedOn: on })
const prizepicks = findApp(DEFAULT_APPS, "prizepicks")!
const power = findMode(prizepicks, "power")!

describe("payoutVerified", () => {
  it("reads every payout table this app ships as unverified", () => {
    // A tripwire, not a tautology. The day somebody writes a date into
    // verifiedOn without having read a real entry screen, this is what asks
    // them whether they did.
    for (const a of DEFAULT_APPS) expect(payoutVerified(a), a.id).toBe(false)
  })

  it("counts a date as verified and nothing else", () => {
    expect(payoutVerified(dated(prizepicks, "2026-09-15"))).toBe(true)
    for (const on of ["unverified", "UNVERIFIED", "  unverified  ", "", "   ", "soon", "last week"]) {
      expect(payoutVerified(dated(prizepicks, on)), JSON.stringify(on)).toBe(false)
    }
    // A stored settings blob from an older version may not carry the field at
    // all, and the only safe reading of a missing one is that nobody checked.
    const withoutField = { ...prizepicks } as Partial<BookApp>
    delete withoutField.verifiedOn
    expect(payoutVerified(withoutField as BookApp)).toBe(false)
    expect(payoutVerified(undefined)).toBe(false)
  })
})

describe("the bar the pick'em section is judged against", () => {
  it("says it came from a stored table, and whether anyone checked it", () => {
    const bar = pickemBar(prizepicks, power, 3)
    expect(bar.source).toBe("stored")
    expect(bar.verified).toBe(false)
    // A 3-pick Power Play at 6x: the break-even is the cube root of 1/6.
    expect(bar.prob).toBeCloseTo(Math.cbrt(1 / 6), 6)
    expect(pickemBar(dated(prizepicks, "2026-09-15"), power, 3).verified).toBe(true)
  })

  it("falls back to a placeholder when no table covers the entry size, and says so", () => {
    // The Power Play table stops at six picks.
    const bar = pickemBar(prizepicks, power, 7)
    expect(bar.source).toBe("placeholder")
    expect(bar.prob).toBe(PLACEHOLDER_LEG_BAR)
    expect(pickemBar(prizepicks, undefined, 3).source).toBe("placeholder")
  })
})

describe("an expected value needs a table someone has checked", () => {
  it("withholds the pricing mode for every table this app ships", () => {
    for (const a of DEFAULT_APPS) {
      for (const m of a.modes) expect(pickemPricingMode(a, m), `${a.id} ${m.id}`).toBeNull()
    }
  })

  it("hands back the stored mode once the table carries a date", () => {
    expect(pickemPricingMode(dated(prizepicks, "2026-09-15"), power)).toBe(power)
    // And still nothing when there is no mode to price against.
    expect(pickemPricingMode(dated(prizepicks, "2026-09-15"), undefined)).toBeNull()
  })
})

/**
 * Four real settled entries, and what the stored tables said about them.
 *
 * Every one was a Power Play that paid less than the shipped table claims,
 * because goblins and demons lower the multiplier for the whole entry. The
 * app's bar was 55-56% where the truth was 59-64%: it was calling a losing
 * leg a target, by up to nine points.
 */
describe("a payout read off a real entry screen", () => {
  const read = (picks: number, multiple: number): CapturedPayout => ({
    picks,
    tiers: { [picks]: multiple },
    confirmed: true,
    capturedAt: "2026-10-22T03:34:00Z",
  })

  const SETTLED: [label: string, picks: number, multiple: number, storedBar: number][] = [
    ["$5 for $40", 4, 8, Math.pow(1 / 10, 1 / 4)],
    ["$5 for $42.50", 4, 8.5, Math.pow(1 / 10, 1 / 4)],
    ["$2.50 for $11.25", 3, 4.5, Math.pow(1 / 6, 1 / 3)],
    ["$2.50 for $9.38", 3, 3.752, Math.pow(1 / 6, 1 / 3)],
  ]

  it("raises the bar to what the entry really had to clear", () => {
    for (const [label, picks, multiple, storedBar] of SETTLED) {
      const bar = pickemBar(prizepicks, findMode(prizepicks, "power"), picks, read(picks, multiple))
      expect(bar.source, label).toBe("captured")
      expect(bar.verified, label).toBe(true)
      expect(bar.capturedAt, label).toBe("2026-10-22T03:34:00Z")
      expect(bar.prob, label).toBeCloseTo(Math.pow(1 / multiple, 1 / picks), 6)
      // Always harder than the stored table's, never easier: a flavoured pick
      // only ever lowers the multiplier.
      expect(bar.prob, label).toBeGreaterThan(storedBar)
    }
  })

  it("was understating the worst of them by nine points", () => {
    const [, picks, multiple] = SETTLED[3]
    const stored = pickemBar(prizepicks, findMode(prizepicks, "power"), picks)
    const captured = pickemBar(prizepicks, findMode(prizepicks, "power"), picks, read(picks, multiple))
    expect(stored.prob).toBeCloseTo(0.5503, 3)
    expect(captured.prob).toBeCloseTo(0.6437, 3)
    expect(captured.prob - stored.prob).toBeGreaterThan(0.09)
  })

  it("prices the entry once a payout has been read, and not before", () => {
    const power = findMode(prizepicks, "power")!
    expect(pickemPricingModeFor(prizepicks, power, 4)).toBeNull()
    expect(pickemPricingModeFor(prizepicks, power, 4, read(4, 8))).not.toBeNull()
  })

  it("ignores a capture that is not for this entry size", () => {
    // A payout read for a 3-pick says nothing about a 4-pick, and using it
    // would be the same error as trusting the stored table.
    const bar = pickemBar(prizepicks, findMode(prizepicks, "power"), 4, read(3, 4.5))
    expect(bar.source).toBe("stored")
    expect(pickemPricingModeFor(prizepicks, findMode(prizepicks, "power"), 4, read(3, 4.5))).toBeNull()
  })

  it("ignores an unconfirmed or invalid capture", () => {
    const power = findMode(prizepicks, "power")!
    expect(pickemBar(prizepicks, power, 4, { ...read(4, 8), confirmed: false }).source).toBe("stored")
    // A settings file is restorable from disk, so a typo'd multiplier must not
    // walk into the bar that decides what gets recommended.
    expect(pickemBar(prizepicks, power, 4, read(4, 5000)).source).toBe("stored")
    expect(pickemBar(prizepicks, power, 4, { picks: 4, tiers: {}, confirmed: true, capturedAt: "x" }).source).toBe("stored")
  })
})

describe("deciding whether a capture is worth a write", () => {
  const typed = (tiers: Record<number, number>, confirmed = false): CapturedPayout => ({
    picks: 4,
    tiers,
    confirmed,
    capturedAt: "2026-10-22T03:34:00Z",
  })

  it("writes nothing while a form is being filled in", () => {
    // Every settings write persists the whole state blob, which on a full
    // slate is megabytes of quotes. The capture form calls back on every
    // keystroke, so answering "yes" here re-serialises the entire cache per
    // character typed — and an unconfirmed capture stores nothing anyway, so
    // nothing is both what would be stored and what is already there.
    expect(capturedPayoutChanged(null, typed({}))).toBe(false)
    expect(capturedPayoutChanged(null, typed({ 4: 8 }))).toBe(false)
    expect(capturedPayoutChanged(null, typed({ 4: 8, 3: 1.5 }))).toBe(false)
  })

  it("writes when a capture is confirmed, and again when it changes", () => {
    expect(capturedPayoutChanged(null, typed({ 4: 8 }, true))).toBe(true)
    const stored = typed({ 4: 8 }, true)
    expect(capturedPayoutChanged(stored, stored)).toBe(false)
    expect(capturedPayoutChanged(stored, typed({ 4: 8.5 }, true))).toBe(true)
  })

  it("writes when a stored capture is withdrawn", () => {
    // Un-confirming one that was saved has to clear it, or the bar would go on
    // using a number the user has taken back.
    expect(capturedPayoutChanged(typed({ 4: 8 }, true), typed({ 4: 8 }))).toBe(true)
  })

  it("never stores a capture that would not validate", () => {
    expect(capturedPayoutChanged(null, typed({ 4: 5000 }, true))).toBe(false)
    expect(capturedPayoutChanged(null, typed({}, true))).toBe(false)
  })
})

describe("the one number in the registry anybody has confirmed", () => {
  it("still pays 6x on a 3-pick Power Play", () => {
    // A real entry screen paid $2 for $12 in Sep 2026, which is the only
    // verified datum in the whole table and the reason the comment above it
    // exists. If this is ever edited, that comment has become a lie.
    expect(payoutMultiple(power, 3, 3)).toBe(6)
  })
})
