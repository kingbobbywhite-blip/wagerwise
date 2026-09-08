import { binomialPmf } from "./binomial"
import { bisect } from "./math"

/**
 * Payout structures for the apps in the user's rotation.
 *
 * IMPORTANT AND NOT OPTIONAL: these multipliers change. Operators adjust them by
 * state, by promotion, by sport and sometimes week to week, and several of these
 * apps run different tables for "demon"/"goblin" style boosted picks. Every
 * table below carries a verifiedOn date and the whole registry is editable in
 * settings. The app treats these as USER-SUPPLIED CONFIGURATION, not as truth,
 * and every expected-value number is only as correct as the table behind it.
 *
 * Confirm the live table in the app before you stake money on an EV figure.
 */

export type AppKind = "dfs" | "exchange" | "prediction"

export interface PayoutMode {
  id: string
  label: string
  /** table[picks][correct] = gross multiple returned on a 1-unit stake. */
  table: Record<number, Record<number, number>>
  blurb: string
}

export interface BookApp {
  id: string
  name: string
  kind: AppKind
  modes: PayoutMode[]
  /** Exchange commission on net winnings, as a fraction. */
  commission?: number
  verifiedOn: string
  notes: string
}

/** All-or-nothing table helper: n picks pays m, anything less pays zero. */
function allOrNothing(pairs: [picks: number, multiplier: number][]): Record<number, Record<number, number>> {
  const t: Record<number, Record<number, number>> = {}
  for (const [picks, mult] of pairs) {
    t[picks] = { [picks]: mult }
  }
  return t
}

export const DEFAULT_APPS: BookApp[] = [
  {
    id: "prizepicks",
    name: "PrizePicks",
    kind: "dfs",
    verifiedOn: "unverified",
    notes: "Power Play is all-or-nothing. Flex pays partial hits. Demon and Goblin picks override the table with their own multipliers, which this app does not model automatically.",
    modes: [
      {
        id: "power",
        label: "Power Play",
        blurb: "Every pick must hit.",
        table: allOrNothing([[2, 3], [3, 5], [4, 10], [5, 20], [6, 37.5]]),
      },
      {
        id: "flex",
        label: "Flex Play",
        blurb: "Partial hits still pay, at a lower top-end multiplier.",
        table: {
          3: { 3: 2.25, 2: 1.25 },
          4: { 4: 5, 3: 1.5 },
          5: { 5: 10, 4: 2, 3: 0.4 },
          6: { 6: 25, 5: 2, 4: 0.4 },
        },
      },
    ],
  },
  {
    id: "underdog",
    name: "Underdog Fantasy",
    kind: "dfs",
    verifiedOn: "unverified",
    notes: "Standard entries are all-or-nothing. Insured entries survive one or two misses. Boosted picks carry their own multipliers.",
    modes: [
      {
        id: "standard",
        label: "Standard",
        blurb: "Every pick must hit.",
        table: allOrNothing([[2, 3], [3, 6], [4, 10], [5, 20]]),
      },
      {
        id: "insured",
        label: "Insured",
        blurb: "Survives a miss at a reduced payout.",
        table: {
          3: { 3: 3, 2: 0.5 },
          4: { 4: 6, 3: 1.5 },
          5: { 5: 10, 4: 2.5, 3: 0.4 },
        },
      },
    ],
  },
  {
    id: "sleeper",
    name: "Sleeper",
    kind: "dfs",
    verifiedOn: "unverified",
    notes: "Sleeper Picks. Payout tables differ between regions and between the standard and flex products.",
    modes: [
      {
        id: "power",
        label: "Power",
        blurb: "Every pick must hit.",
        table: allOrNothing([[2, 3], [3, 6], [4, 10], [5, 20], [6, 37.5]]),
      },
      {
        id: "flex",
        label: "Flex",
        blurb: "Partial hits pay.",
        table: {
          3: { 3: 2.1, 2: 1 },
          4: { 4: 6, 3: 1.25 },
          5: { 5: 10, 4: 2, 3: 0.35 },
        },
      },
    ],
  },
  {
    id: "dabble",
    name: "Dabble",
    kind: "dfs",
    verifiedOn: "unverified",
    notes: "Structure mirrors the standard pick'em template. Verify the live table before sizing anything.",
    modes: [
      { id: "power", label: "Power", blurb: "Every pick must hit.", table: allOrNothing([[2, 3], [3, 5], [4, 10], [5, 20]]) },
      {
        id: "flex", label: "Flex", blurb: "Partial hits pay.",
        table: { 3: { 3: 2.25, 2: 1.25 }, 4: { 4: 5, 3: 1.5 }, 5: { 5: 10, 4: 2, 3: 0.4 } },
      },
    ],
  },
  {
    id: "chalkboard",
    name: "Chalkboard",
    kind: "dfs",
    verifiedOn: "unverified",
    notes: "Structure mirrors the standard pick'em template. Verify the live table before sizing anything.",
    modes: [
      { id: "power", label: "Power", blurb: "Every pick must hit.", table: allOrNothing([[2, 3], [3, 5], [4, 10], [5, 20], [6, 35]]) },
      {
        id: "flex", label: "Flex", blurb: "Partial hits pay.",
        table: { 3: { 3: 2.25, 2: 1.25 }, 4: { 4: 5, 3: 1.5 }, 5: { 5: 10, 4: 2, 3: 0.4 } },
      },
    ],
  },
  {
    id: "winible",
    name: "Winible",
    kind: "dfs",
    verifiedOn: "unverified",
    notes: "Payout table not confirmed. The defaults here are a generic pick'em template and almost certainly need editing in settings.",
    modes: [
      { id: "power", label: "Power", blurb: "Every pick must hit.", table: allOrNothing([[2, 3], [3, 5], [4, 10], [5, 20]]) },
    ],
  },
  {
    id: "real",
    name: "Real",
    kind: "dfs",
    verifiedOn: "unverified",
    notes: "Payout table not confirmed. The defaults here are a generic pick'em template and almost certainly need editing in settings.",
    modes: [
      { id: "power", label: "Power", blurb: "Every pick must hit.", table: allOrNothing([[2, 3], [3, 5], [4, 10], [5, 20]]) },
    ],
  },
  {
    id: "prophetx",
    name: "ProphetX",
    kind: "exchange",
    commission: 0.02,
    verifiedOn: "unverified",
    notes: "Peer-to-peer exchange. Legs carry real American odds and payout is the true parlay price, less commission on net winnings. Because you are trading against other users rather than a book, the posted price is closer to fair and the edge comes from getting filled at a better number.",
    modes: [{ id: "parlay", label: "Parlay", blurb: "Priced from the actual leg odds.", table: {} }],
  },
  {
    id: "polymarket",
    name: "Polymarket",
    kind: "prediction",
    commission: 0,
    verifiedOn: "unverified",
    notes: "Binary contracts settle at 1 or 0, so the quoted price IS the market's probability. There is no vig to strip, but there is spread and slippage. Edge is the gap between your probability and the ask.",
    modes: [{ id: "binary", label: "Binary contract", blurb: "Priced from the contract ask.", table: {} }],
  },
]

export function findApp(apps: BookApp[], id: string): BookApp | undefined {
  return apps.find((a) => a.id === id)
}

export function findMode(app: BookApp | undefined, modeId: string): PayoutMode | undefined {
  return app?.modes.find((m) => m.id === modeId)
}

/**
 * Gross multiple returned for `correct` hits out of `picks`.
 * Returns 0 when the outcome is not in the table, which is a loss.
 */
export function payoutMultiple(mode: PayoutMode, picks: number, correct: number): number {
  return mode.table[picks]?.[correct] ?? 0
}

/** Entry sizes a mode actually supports. */
export function supportedPickCounts(mode: PayoutMode): number[] {
  return Object.keys(mode.table).map(Number).sort((a, b) => a - b)
}

/**
 * Expected gross return per unit staked, if every leg were an independent coin
 * with probability p.
 *
 * This sums across EVERY paying tier, not just the all-hit tier:
 *
 *   E[M] = sum over k of  C(n,k) p^k (1-p)^(n-k) * M(n,k)
 *
 * Independence is a simplifying assumption used only for these benchmark
 * figures. Real entries are priced by the correlated simulator.
 */
export function expectedMultipleAtLegProb(mode: PayoutMode, picks: number, p: number): number {
  const tiers = mode.table[picks]
  if (!tiers) return 0
  let acc = 0
  for (const [correctStr, mult] of Object.entries(tiers)) {
    const k = Number(correctStr)
    acc += binomialPmf(picks, k, p) * mult
  }
  return acc
}

/**
 * Break-even per-leg probability: the p at which the entry returns exactly the
 * stake.
 *
 * For an all-or-nothing table this reduces to M^(-1/n), but for anything with
 * partial-payout tiers that shortcut is badly wrong, because it ignores every
 * dollar the lower tiers return. A PrizePicks 5-pick flex paying 10x / 2x / 0.4x
 * breaks even near 54.3%, where the all-hit shortcut would claim 63.1% and talk
 * you out of entries that are actually fine.
 *
 * Expected return is monotone increasing in p (higher tiers never pay less), so
 * bisection is safe.
 */
export function breakEvenLegProb(mode: PayoutMode, picks: number): number | null {
  const tiers = mode.table[picks]
  if (!tiers || Object.keys(tiers).length === 0) return null
  const f = (p: number) => expectedMultipleAtLegProb(mode, picks, p) - 1
  if (f(1) <= 0) return null // even a perfect card cannot return the stake
  if (f(0) >= 0) return 0 // a tier pays out on zero correct
  return bisect(f, 0, 1, 1e-12, 200)
}

/**
 * Expected value per unit staked at a given per-leg probability, again assuming
 * independence. Used to show what a slip's expected value SHOULD look like for
 * its legs, so a mistyped multiplier stands out immediately.
 */
export function evAtLegProb(mode: PayoutMode, picks: number, p: number): number {
  return expectedMultipleAtLegProb(mode, picks, p) - 1
}

// ---------------------------------------------------------------------------
// Captured payouts
// ---------------------------------------------------------------------------

/**
 * A payout table read off the app's own screen at the moment an entry was built.
 *
 * The stored tables above are defaults, and defaults drift: operators change
 * multipliers by state, by promotion and by sport, and boosted picks override
 * them outright. The number the app displays while you are building the entry is
 * ground truth, so that is what gets captured and stored with the slip.
 *
 * `tiers` maps correct-leg count to the gross multiple returned on a one-unit
 * stake. `confirmed` records whether a human actually checked it. An
 * unconfirmed payout is not used to price anything.
 */
export interface CapturedPayout {
  picks: number
  tiers: Record<number, number>
  confirmed: boolean
  capturedAt: string
}

/** Seed a capture form from a stored table, so the common case is one click. */
export function capturedFromMode(mode: PayoutMode, picks: number): CapturedPayout {
  const tiers = mode.table[picks] ?? {}
  return {
    picks,
    tiers: { ...tiers },
    confirmed: false,
    capturedAt: new Date().toISOString(),
  }
}

/** Wrap a captured payout so the simulator can price against it. */
export function capturedToMode(c: CapturedPayout, label = "Captured"): PayoutMode {
  return {
    id: "captured",
    label,
    blurb: "Priced from the multipliers you read off the app.",
    table: { [c.picks]: { ...c.tiers } },
  }
}

export interface CaptureProblem {
  field: string
  message: string
}

/**
 * Validate a captured payout before it is allowed to price anything.
 * Every rejection here is a case where a typo would silently produce a
 * confident, wrong expected value.
 */
export function validateCapture(c: CapturedPayout): CaptureProblem[] {
  const problems: CaptureProblem[] = []
  if (!Number.isInteger(c.picks) || c.picks < 2 || c.picks > 12) {
    problems.push({ field: "picks", message: "Entry size must be between 2 and 12 picks." })
  }
  const keys = Object.keys(c.tiers).map(Number).sort((a, b) => a - b)
  if (keys.length === 0) {
    problems.push({ field: "tiers", message: "Enter at least the all-correct multiplier." })
  }
  for (const k of keys) {
    const v = c.tiers[k]
    if (!Number.isFinite(k) || k < 0 || k > c.picks) {
      problems.push({ field: `tier-${k}`, message: `${k} correct is not possible on a ${c.picks}-pick entry.` })
    }
    if (!Number.isFinite(v) || v < 0) {
      problems.push({ field: `tier-${k}`, message: `Multiplier for ${k} correct must be a number of zero or more.` })
    }
    if (v > 1000) {
      problems.push({ field: `tier-${k}`, message: `A ${v}x multiplier is implausible. Check for a typo.` })
    }
  }
  if (keys.length > 0 && !keys.includes(c.picks)) {
    problems.push({ field: "tiers", message: "The all-correct tier is missing, which is the one that matters most." })
  }
  // Payouts must not decrease as you get more legs right.
  for (let i = 1; i < keys.length; i++) {
    if (c.tiers[keys[i]] < c.tiers[keys[i - 1]]) {
      problems.push({
        field: `tier-${keys[i]}`,
        message: `${keys[i]} correct pays less than ${keys[i - 1]} correct, which no app does. Check the values.`,
      })
    }
  }
  return problems
}
