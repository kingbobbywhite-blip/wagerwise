import type { MarketKey } from "@/lib/nba/markets"
import { extractProps, linesFromText, type PropCandidate } from "@/lib/ocr/extract"
import { normalizeName } from "@/lib/quant/correlation"
import { resolveLine } from "@/lib/quant/distributions"
import { dfsPayout } from "@/lib/quant/evaluate"
import { capturedToMode, findApp, findMode, type BookApp, type PayoutMode } from "@/lib/quant/payouts"
import { groupQuotes, referenceProjection, type FeedQuote, type ValueBetSettings } from "@/lib/quant/valuebets"
import type { LegResult, TrackedLeg, TrackedSlip } from "@/lib/store/schema"

/**
 * Settling, pricing and reading back entries in the tracker.
 *
 * Built from five real settled PrizePicks entries. They showed three things the
 * tracker got wrong or could not do:
 *
 *   - A player who does not play ("Reboot") does not refund the entry. The entry
 *     shrinks to the remaining picks and pays that size's table, so a 3-pick
 *     with one win, one loss and one no-show is a 2-pick with a loss: a loss.
 *     The tracker only knew the 3-pick payout, so it refunded it.
 *   - Entries placed straight in the app could not be logged at all, and they
 *     are most of what gets played.
 *   - The same player sat in two open entries, so one bad game cost both.
 */

/** Results that take a leg out of the entry instead of deciding it. */
export const DROPS_OUT: LegResult[] = ["PUSH", "VOID"]

/**
 * The payout table a slip settles against: the multiple captured for its full
 * size, and the app's stored table for any smaller size a void shrinks it to.
 */
export function settlementMode(slip: Pick<TrackedSlip, "appId" | "modeId" | "capturedPayout">, apps: BookApp[]): PayoutMode {
  const stored = findMode(findApp(apps, slip.appId), slip.modeId)
  const captured = capturedToMode(slip.capturedPayout)
  return { ...captured, table: { ...(stored?.table ?? {}), ...captured.table } }
}

/** Apply leg results and, once every leg is decided, settle the entry. */
export function withResults(slip: TrackedSlip, legs: TrackedLeg[], apps: BookApp[]): TrackedSlip {
  const settledAll = legs.every((l) => l.result !== "PENDING")
  if (!settledAll) return { ...slip, legs, status: "PENDING", actualMultiple: null, settledAt: null }
  const wins = legs.filter((l) => l.result === "WIN").length
  const drops = legs.filter((l) => DROPS_OUT.includes(l.result)).length
  const outcomes = Int8Array.from(legs.map((l) => (l.result === "WIN" ? 1 : DROPS_OUT.includes(l.result) ? 0 : -1)))
  const actualMultiple = slip.capturedPayout
    ? dfsPayout(settlementMode(slip, apps))(wins, drops, legs.length, outcomes)
    : 0
  return { ...slip, legs, status: "SETTLED", actualMultiple, settledAt: slip.settledAt ?? new Date().toISOString() }
}

/**
 * Expected return of an entry from its legs' probabilities, assuming the legs
 * are independent. Exact over every win/loss combination, so partial-pay flex
 * tiers count. Null when any leg was never priced: an EV built on a guess for
 * one leg is a guess.
 */
export function entryExpectation(ps: (number | null)[], mode: PayoutMode): { ev: number; pAllHit: number } | null {
  if (ps.length === 0 || ps.some((p) => p == null)) return null
  const probs = ps as number[]
  const n = probs.length
  const pay = dfsPayout(mode)
  let ev = 0
  for (let mask = 0; mask < 1 << n; mask++) {
    let p = 1
    let wins = 0
    const outcomes = new Int8Array(n)
    for (let i = 0; i < n; i++) {
      const hit = (mask >> i) & 1
      p *= hit ? probs[i] : 1 - probs[i]
      wins += hit
      outcomes[i] = hit ? 1 : -1
    }
    ev += p * pay(wins, 0, n, outcomes)
  }
  return { ev: ev - 1, pAllHit: probs.reduce((a, b) => a * b, 1) }
}

/**
 * What the app's last pull said about a leg: the probability that side hits at
 * that line, from the same sharp-weighted reference the Today screen uses.
 * Null when the pull does not include the player and stat, which for an entry
 * placed before a pull is the usual case.
 */
export function priceLeg(
  quotes: FeedQuote[] | undefined,
  leg: { player: string; marketKey: MarketKey | null; line: number; side: "OVER" | "UNDER" },
  settings: ValueBetSettings,
  now = Date.now(),
): number | null {
  if (!quotes?.length || !leg.marketKey || !Number.isFinite(leg.line)) return null
  const who = normalizeName(leg.player)
  const group = groupQuotes(quotes).find((g) => g.market === leg.marketKey && normalizeName(g.player) === who)
  if (!group) return null
  const ref = referenceProjection(group, group.quotes, settings, now)
  if (!ref || ref.status !== "priced") return null
  const r = resolveLine(ref.distribution, leg.line)
  return leg.side === "OVER" ? r.over : r.under
}

export interface Exposure {
  player: string
  entries: number
  /** Distinct side-and-line combinations across those entries. */
  bets: string[]
  /** Over in one entry and under in another: they cannot both win. */
  conflicting: boolean
}

/**
 * Players who appear in more than one open entry. Each extra entry on the same
 * player is the same bet again: one quiet game, or one blowout, settles all of
 * them together, which multiplies the swing without adding any edge.
 */
export function openExposure(slips: TrackedSlip[]): Exposure[] {
  const byPlayer = new Map<string, { player: string; slips: Set<string>; bets: Set<string>; sides: Set<string> }>()
  for (const s of slips) {
    if (s.status !== "PENDING") continue
    for (const l of s.legs) {
      if (l.result !== "PENDING") continue
      const k = normalizeName(l.player)
      const e = byPlayer.get(k) ?? { player: l.player, slips: new Set(), bets: new Set(), sides: new Set() }
      e.slips.add(s.id)
      e.bets.add(`${l.side === "OVER" ? "over" : "under"} ${l.line} ${l.marketLabel}`)
      e.sides.add(`${l.marketKey ?? l.marketLabel}|${l.side}`)
      byPlayer.set(k, e)
    }
  }
  return Array.from(byPlayer.values())
    .filter((e) => e.slips.size > 1)
    .map((e) => {
      const markets = new Map<string, Set<string>>()
      for (const x of e.sides) {
        const [m, side] = x.split("|")
        markets.set(m, (markets.get(m) ?? new Set()).add(side))
      }
      return {
        player: e.player,
        entries: e.slips.size,
        bets: Array.from(e.bets),
        conflicting: Array.from(markets.values()).some((v) => v.size > 1),
      }
    })
    .sort((a, b) => b.entries - a.entries)
}

export interface LegRecord {
  label: string
  wins: number
  losses: number
}

/**
 * Settled legs grouped by stat and side, plus whether the app had priced them.
 * The point is the pattern, not the headline: "receptions unders 1-4" says more
 * about what to stop doing than an overall record does. Voids and pushes are
 * left out; they decided nothing.
 */
export function recordByType(slips: TrackedSlip[]): { byType: LegRecord[]; priced: LegRecord; unpriced: LegRecord } {
  const map = new Map<string, LegRecord>()
  const priced: LegRecord = { label: "Legs the app priced", wins: 0, losses: 0 }
  const unpriced: LegRecord = { label: "Legs the app never priced", wins: 0, losses: 0 }
  for (const s of slips) {
    for (const l of s.legs) {
      if (l.result !== "WIN" && l.result !== "LOSS") continue
      const label = `${l.marketLabel} ${l.side === "OVER" ? "overs" : "unders"}`
      const r = map.get(label) ?? { label, wins: 0, losses: 0 }
      const bucket = l.pWinAtEntry == null ? unpriced : priced
      if (l.result === "WIN") {
        r.wins++
        bucket.wins++
      } else {
        r.losses++
        bucket.losses++
      }
      map.set(label, r)
    }
  }
  return {
    byType: Array.from(map.values()).sort((a, b) => b.wins + b.losses - (a.wins + a.losses)),
    priced,
    unpriced,
  }
}

export interface DraftLeg {
  player: string
  marketKey: MarketKey | null
  marketLabel: string
  line: number
  side: "OVER" | "UNDER" | null
  result: LegResult
  /** Why this row needs a look before it is saved. */
  note: string | null
}

const RESULT_WORDS: [RegExp, LegResult][] = [
  [/^(win|won|w|hit|cashed)$/i, "WIN"],
  [/^(loss|lost|l|miss|missed)$/i, "LOSS"],
  [/^(dnp|void|reboot|voided)$/i, "VOID"],
  [/^push$/i, "PUSH"],
]

/**
 * Legs typed one per line, the way you would read them off the entry:
 *
 *   Jordan Addison under 5.5 Recs win
 *   Tyler Allgeier over 2.5 Rush Yards loss
 *   Jack Bech over 0.5 Rec Yards dnp
 *
 * The result word at the end is optional. A line that does not read as a leg
 * is kept with a note rather than dropped, so nothing typed disappears.
 */
export function legsFromText(text: string): DraftLeg[] {
  const out: DraftLeg[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const tokens = line.split(/\s+/)
    let result: LegResult = "PENDING"
    const last = tokens[tokens.length - 1].replace(/[^A-Za-z]/g, "")
    const hit = RESULT_WORDS.find(([re]) => re.test(last))
    if (hit && tokens.length > 1) {
      result = hit[1]
      tokens.pop()
    }
    const c = extractProps(linesFromText(tokens.join(" "))).candidates[0]
    if (!c) {
      out.push({ player: line, marketKey: null, marketLabel: "", line: Number.NaN, side: null, result, note: "Could not read a player, line and stat from this line." })
      continue
    }
    out.push(draftFromCandidate(c, result))
  }
  return out
}

export function draftFromCandidate(c: PropCandidate, result: LegResult = "PENDING"): DraftLeg {
  const notes = [
    c.side ? null : "Pick over or under.",
    c.marketKey ? null : `Stat "${c.rawMarket}" was not recognised.`,
    ...c.issues.filter((i) => !i.startsWith("Marked Reboot")),
  ].filter(Boolean)
  return {
    player: c.player,
    marketKey: c.marketKey,
    marketLabel: c.marketLabel,
    line: c.line,
    side: c.side ?? null,
    result: c.dnp ? "VOID" : result,
    note: notes.length ? notes.join(" ") : null,
  }
}
