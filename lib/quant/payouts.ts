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
 * Break-even per-leg probability for an all-or-nothing entry, assuming
 * independent legs of equal strength. Useful as a sanity benchmark: a 4-pick
 * paying 10x needs each leg at 10^(-1/4) = 56.2% just to break even, which is
 * why "hit rate over 50%" is nowhere near good enough on these apps.
 */
export function breakEvenLegProb(mode: PayoutMode, picks: number): number | null {
  const mult = payoutMultiple(mode, picks, picks)
  if (mult <= 0) return null
  return Math.pow(1 / mult, 1 / picks)
}
