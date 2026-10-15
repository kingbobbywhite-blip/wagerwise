import { LEAGUE_IDS, isLeagueId, leagueFor, type LeagueId } from "@/lib/leagues"
import { packRows, unpackRows, type PackedTable } from "./pack"
import { EMPTY_STATE, migrate, type AppState, type DailyCache, type LineSnapshot } from "./schema"

/**
 * Persistence.
 *
 * Everything lives in the browser. That is a deliberate trade: the app runs with
 * zero configuration, no account and no database, and your betting history never
 * leaves your machine. The cost is that clearing site data wipes it, so the
 * settings page offers a one-click JSON export and import.
 *
 * The state is stored in pieces rather than as one blob, for two reasons.
 *
 * The first is that a full quota used to stop everything. One blob meant a
 * slate too big to fit also kept a settled slip or a changed setting from
 * being written, and the banner could only say that nothing was being saved.
 * Settings and slips now have a key of their own, written first, and a slate
 * that does not fit cannot hold them hostage.
 *
 * The second is cost. Every change, down to a slider being dragged, used to
 * serialise every cached slate again on the page's thread. Now a write touches
 * only the pieces that changed.
 */

/** Settings and slips. It once held the whole state, which is why it keeps the old name. */
const CORE_KEY = "wagerwise.state.v1"
const SLATE_KEY = "wagerwise.slate.v1"
const LINES_KEY = "wagerwise.lines.v1"
const DAILY_PREFIX = "wagerwise.daily.v1."
const dailyKey = (id: LeagueId) => `${DAILY_PREFIX}${id}`
const OWN_PREFIXES = [CORE_KEY, SLATE_KEY, LINES_KEY, DAILY_PREFIX]

/** The part of the Web Storage interface this module uses, so tests can hand it a fake with a quota. */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">

/** localStorage, or null where reading it throws (storage blocked) or there is no window. */
export function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/**
 * A slate cache as stored: its quotes and pick'em lines packed by column (see
 * pack.ts), which is what lets a full NFL Sunday fit at all. Marked with a
 * format number so a cache written verbatim still reads.
 */
interface StoredDaily {
  f: 1
  cache: Omit<DailyCache, "quotes" | "pickemLines">
  quotes: PackedTable
  pickemLines?: PackedTable
}

function encodeDaily(c: DailyCache): string {
  // pickemLines is stripped here and re-added packed; `rest` carries the rest verbatim.
  const { quotes, pickemLines, ...rest } = c
  const out: StoredDaily = { f: 1, cache: rest, quotes: packRows(quotes) }
  if (pickemLines) out.pickemLines = packRows(pickemLines)
  return JSON.stringify(out)
}

function decodeDaily(raw: string): unknown {
  const o = JSON.parse(raw)
  if (o?.f !== 1) return o
  const d = o as StoredDaily
  return {
    ...d.cache,
    quotes: unpackRows(d.quotes),
    ...(d.pickemLines ? { pickemLines: unpackRows(d.pickemLines) } : {}),
  }
}

/**
 * The line history as stored: every snapshot's rows in one packed table, so a
 * player seen in eight pulls has his name and key stored once rather than
 * eight times.
 */
interface StoredLines {
  f: 1
  snaps: (Omit<LineSnapshot, "rows"> & { n: number })[]
  rows: PackedTable
}

function encodeLines(lines: LineSnapshot[]): string {
  const out: StoredLines = {
    f: 1,
    snaps: lines.map(({ rows, ...meta }) => ({ ...meta, n: rows.length })),
    rows: packRows(lines.flatMap((l) => l.rows)),
  }
  return JSON.stringify(out)
}

function decodeLines(raw: string): unknown {
  const o = JSON.parse(raw)
  if (o?.f !== 1) return o
  const d = o as StoredLines
  if (!Array.isArray(d.snaps)) throw new Error("Line history has no snapshots")
  const rows = unpackRows(d.rows)
  let at = 0
  const out = d.snaps.map(({ n, ...meta }) => {
    if (!Number.isInteger(n) || n < 0) throw new Error("Bad snapshot length")
    const snap = { ...meta, rows: rows.slice(at, at + n) }
    at += n
    return snap
  })
  if (at !== rows.length) throw new Error("Line history rows do not add up")
  return out
}

// ---------------------------------------------------------------------------
// Shedding
// ---------------------------------------------------------------------------

/**
 * Progressively smaller versions of the state, for when storage is full.
 *
 * This is not hypothetical. A 14-game NFL pull at eight books is around ten
 * thousand quotes, and stored verbatim that was about 3.7 million characters,
 * against a quota Chrome sets at about 5.2 million and Safari no higher: a
 * second slate beside it could not fit at all. Packing (pack.ts) cut that by
 * more than an order of magnitude, but a quota is still a quota, and it is
 * shared with anything else served from the same address.
 *
 * So a save that does not fit stores less, cheapest first, and says what it
 * left out. The order is deliberate: line history is research and can be
 * thinned, another league's slate is yesterday's problem, and the pull you
 * most recently paid for is the last thing to go. Slips and settings are
 * never shed — slips are the only record of what the model got right.
 *
 * What this sheds is the STORED copy. The state on screen is left whole, so
 * the slate you just pulled stays usable for the rest of the session even
 * when it cannot be kept; the banner says what will not survive a reload.
 */
export function reduceForQuota(
  state: AppState,
  keep?: LeagueId | null,
): { state: AppState; dropped: string } | null {
  // 1. Thin the line history to the newest few pulls.
  if (state.lines.length > 2) {
    const n = state.lines.length - 2
    return {
      state: { ...state, lines: state.lines.slice(0, 2) },
      dropped: `${n} older line snapshot${n === 1 ? "" : "s"}`,
    }
  }
  // 2. Drop other leagues' slates, oldest first.
  const others = (Object.keys(state.daily) as LeagueId[]).filter((id) => id !== keep)
  if (others.length > 0) {
    const oldest = others.sort((a, b) =>
      (state.daily[a]?.fetchedAt ?? "").localeCompare(state.daily[b]?.fetchedAt ?? ""),
    )[0]
    const daily = { ...state.daily }
    delete daily[oldest]
    return { state: { ...state, daily }, dropped: `the ${leagueName(oldest)} slate` }
  }
  // 3. The line history entirely.
  if (state.lines.length > 0) {
    return { state: { ...state, lines: [] }, dropped: "the line history" }
  }
  // 4. The imported board, which can be captured again.
  if (state.slate) {
    return { state: { ...state, slate: null }, dropped: "the imported board" }
  }
  // 5. The last slate standing, which step 2 has left as the kept one. Beyond
  // this there is nothing safe to shed: slips are the only record of what the
  // model predicted.
  const left = Object.keys(state.daily) as LeagueId[]
  if (left.length > 0) {
    return {
      state: { ...state, daily: {} },
      dropped: left.length === 1 ? `the ${leagueName(left[0])} slate` : "every cached slate",
    }
  }
  return null
}

function leagueName(id: LeagueId): string {
  return isLeagueId(id) ? leagueFor(id).label : String(id).toUpperCase()
}

/** The league whose pull is newest: the one the credits were most recently spent on. */
function newestLeague(state: AppState): LeagueId {
  const ids = (Object.keys(state.daily) as LeagueId[]).sort((a, b) =>
    (state.daily[b]?.fetchedAt ?? "").localeCompare(state.daily[a]?.fetchedAt ?? ""),
  )
  return ids[0] ?? state.settings.daily.league
}

/**
 * The labels a banner should show. Once the whole history is out, saying the
 * older snapshots are out as well is the same loss counted twice.
 */
function summarise(dropped: string[]): string[] {
  if (!dropped.includes("the line history")) return dropped
  return dropped.filter((d) => !/older line snapshots?$/.test(d))
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

export interface SaveResult {
  ok: boolean
  error?: string
  /**
   * True only when the write failed for want of room.
   *
   * The distinction decides whether anything may be left out. Shedding data
   * is the right answer to a full quota and the wrong answer to every other
   * failure: storage disabled in a private window, or a value that would not
   * serialise, would otherwise have the app throw away slate after slate in a
   * loop trying to fix a problem that was never about size.
   */
  quota?: boolean
  /**
   * What is on screen but not stored, so will be gone after a reload. Empty
   * when everything fit.
   */
  unsaved: string[]
}

export interface StorageUsage {
  /** What this app is holding, by piece, in UTF-16 code units (characters). */
  items: { key: string; kind: "core" | "slate" | "daily" | "lines"; league?: LeagueId; chars: number }[]
  /**
   * Characters held by anything else on this origin. The quota is per origin,
   * so another app served from the same localhost port eats into it.
   */
  otherChars: number
}

export interface Persister {
  /** Read what is stored. Call once, before the first save. */
  load(): AppState
  /** Store what changed since the last save, leaving out what has to be left out. */
  save(state: AppState): SaveResult
  usage(): StorageUsage
}

const FULL_ERROR = "Browser storage is full, even with every cached slate left out."
const UNREADABLE = Symbol("unreadable")

interface Written {
  /** What was written, for telling whether it changed: an object, or an array compared item by item. */
  ref: unknown
  /** Key plus value, in UTF-16 code units, which is what a quota counts. */
  chars: number
}

interface Entry {
  key: string
  ref: unknown
  encode: () => string
}

function sameRef(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i])
  return false
}

function isQuotaError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  // Browsers disagree about the name and the message. Safari throws
  // QuotaExceededError, Firefox NS_ERROR_DOM_QUOTA_REACHED, and the legacy
  // code 22 is still what some report.
  const name =
    typeof e === "object" && e !== null && "name" in e ? String((e as { name: unknown }).name) : ""
  const code = typeof e === "object" && e !== null && "code" in e ? (e as { code?: number }).code : undefined
  return /quota|NS_ERROR_DOM_QUOTA_REACHED/i.test(`${name} ${msg}`) || code === 22 || name === "QuotaExceededError"
}

/** The state with the first `level` reductions applied, or null when there are not that many. */
function planAt(state: AppState, keep: LeagueId, level: number): { state: AppState; dropped: string[] } | null {
  let target = state
  const dropped: string[] = []
  for (let i = 0; i < level; i++) {
    const r = reduceForQuota(target, keep)
    if (!r) return null
    dropped.push(r.dropped)
    target = r.state
  }
  return { state: target, dropped }
}

export function createPersister(storage: StorageLike | null): Persister {
  /** What is in storage now, by key, as far as this tab knows. */
  const stored = new Map<string, Written>()
  /** Encoded caches, so stepping down the shed levels does not pack the same slate twice. */
  const encoded = new WeakMap<object, string>()
  /** How far down the shed order the last save had to go. */
  let level = 0
  /** The state last saved, for telling a new pull from a changed setting. */
  let seen: AppState | null = null

  function memo(o: object, f: () => string): string {
    let v = encoded.get(o)
    if (v === undefined) {
      v = f()
      encoded.set(o, v)
    }
    return v
  }

  function entriesFor(s: AppState): Entry[] {
    const out: Entry[] = [
      {
        key: CORE_KEY,
        ref: [s.settings, s.slips],
        encode: () => JSON.stringify({ version: s.version, settings: s.settings, slips: s.slips }),
      },
    ]
    const slate = s.slate
    if (slate) out.push({ key: SLATE_KEY, ref: slate, encode: () => memo(slate, () => JSON.stringify(slate)) })
    for (const id of LEAGUE_IDS) {
      const c = s.daily[id]
      if (c) out.push({ key: dailyKey(id), ref: c, encode: () => memo(c, () => encodeDaily(c)) })
    }
    const lines = s.lines
    if (lines.length > 0) out.push({ key: LINES_KEY, ref: lines, encode: () => encodeLines(lines) })
    return out
  }

  function load(): AppState {
    stored.clear()
    level = 0
    seen = null
    if (!storage) return EMPTY_STATE

    // Everything this app has ever written, read once. A key nothing reads any
    // more (a league since dropped) is found this way and cleared by the first
    // save, rather than kept in a tight quota forever.
    const raw = new Map<string, string>()
    try {
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i)
        if (k && OWN_PREFIXES.some((p) => k.startsWith(p))) raw.set(k, storage.getItem(k) ?? "")
      }
    } catch {
      // Storage that cannot even be listed cannot be read either.
      return EMPTY_STATE
    }
    // Until a piece is known to be what the state holds, it is marked as
    // something to replace, so the first save overwrites or removes it.
    for (const [k, v] of raw) stored.set(k, { ref: UNREADABLE, chars: k.length + v.length })

    const decoded = new Map<string, unknown>()
    const read = (key: string, decode: (raw: string) => unknown): unknown => {
      const v = raw.get(key)
      if (v == null) return undefined
      try {
        const out = decode(v)
        decoded.set(key, out)
        return out
      } catch {
        // One unreadable piece costs that piece, not the app.
        return undefined
      }
    }

    const core = read(CORE_KEY, JSON.parse)
    const coreObj = core && typeof core === "object" && !Array.isArray(core) ? (core as Record<string, unknown>) : {}
    // JSON that is not an object is as good as unreadable, and is replaced.
    if (coreObj !== core) decoded.delete(CORE_KEY)

    // Before the state was split, all of it lived in the core key. A blob that
    // still carries a slate, the line history or the board was written by that
    // version and is the newest copy there is, so it wins over split keys left
    // from before a downgrade. Nothing is marked as stored, so the first save
    // splits it, and rewriting the core without the caches is the biggest
    // shrink, so it goes first and frees the room for the rest.
    if ("daily" in coreObj || "lines" in coreObj || "slate" in coreObj) return migrate(coreObj)

    const daily: Record<string, unknown> = {}
    for (const id of LEAGUE_IDS) {
      const c = read(dailyKey(id), decodeDaily)
      if (c !== undefined) daily[id] = c
    }
    const state = migrate({
      ...coreObj,
      slate: read(SLATE_KEY, JSON.parse) ?? null,
      daily,
      lines: read(LINES_KEY, decodeLines) ?? [],
    })

    // What was read back is what is stored, so the first save writes nothing.
    // A piece migrate() pruned is rewritten when it next changes. A piece that
    // would not decode, or that the state no longer has a place for, keeps its
    // mark and goes.
    for (const e of entriesFor(state)) {
      const w = stored.get(e.key)
      if (w && decoded.has(e.key)) stored.set(e.key, { ...w, ref: e.ref })
    }
    seen = state
    return state
  }

  /** Make storage hold `target`, touching only what differs. */
  function writeTarget(target: AppState): { ok: true } | { ok: false; quota: boolean; error?: string } {
    const want = entriesFor(target)
    const wantKeys = new Set(want.map((e) => e.key))
    try {
      // Removals first: they only ever free room.
      for (const key of Array.from(stored.keys())) {
        if (wantKeys.has(key)) continue
        storage!.removeItem(key)
        stored.delete(key)
      }
      // Then the writes, biggest shrink first, so room freed by one is there
      // for the next. A legacy blob being split frees megabytes this way.
      const growth = (e: Entry & { value: string }) => e.key.length + e.value.length - (stored.get(e.key)?.chars ?? 0)
      const pending = want
        .filter((e) => {
          const w = stored.get(e.key)
          return !w || !sameRef(w.ref, e.ref)
        })
        .map((e) => ({ ...e, value: e.encode() }))
        .sort((a, b) => growth(a) - growth(b))
      for (const e of pending) {
        storage!.setItem(e.key, e.value)
        stored.set(e.key, { ref: e.ref, chars: e.key.length + e.value.length })
      }
      return { ok: true }
    } catch (e) {
      if (isQuotaError(e)) return { ok: false, quota: true }
      return { ok: false, quota: false, error: `Could not save: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  function save(state: AppState): SaveResult {
    if (!storage) return { ok: false, error: "No browser storage available.", unsaved: [] }
    // A new pull, an import or a cleared cache re-plans from the top, because
    // what fits has changed. Anything else (a setting, a slip) stays at the
    // level that fitted last time, so it is one small write rather than a
    // retry of every slate already left out.
    if (
      !seen ||
      seen.slate !== state.slate ||
      seen.lines !== state.lines ||
      LEAGUE_IDS.some((id) => seen!.daily[id] !== state.daily[id])
    ) {
      level = 0
    }
    seen = state
    // Keep the most recently fetched slate rather than whichever tab is
    // selected: switching tabs while a pull is in flight would otherwise shed
    // the slate the credits were just spent on.
    const keep = newestLeague(state)
    for (;;) {
      const plan = planAt(state, keep, level)
      if (!plan) {
        // Every reduction made and the core still does not fit. Stay at the
        // last real level, so the next change tries the core again.
        level--
        return { ok: false, quota: true, error: FULL_ERROR, unsaved: summarise(planAt(state, keep, level)?.dropped ?? []) }
      }
      const r = writeTarget(plan.state)
      if (r.ok) return { ok: true, unsaved: summarise(plan.dropped) }
      // Only a full quota is a reason to store less. Anything else, storage
      // switched off or a value that will not serialise, is reported as it is.
      if (!r.quota) return { ok: false, error: r.error, unsaved: summarise(plan.dropped) }
      level++
    }
  }

  function usage(): StorageUsage {
    const items: StorageUsage["items"] = []
    for (const [key, w] of stored) {
      if (key === CORE_KEY) items.push({ key, kind: "core", chars: w.chars })
      else if (key === SLATE_KEY) items.push({ key, kind: "slate", chars: w.chars })
      else if (key === LINES_KEY) items.push({ key, kind: "lines", chars: w.chars })
      else if (key.startsWith(DAILY_PREFIX)) {
        const id = key.slice(DAILY_PREFIX.length)
        items.push({ key, kind: "daily", league: isLeagueId(id) ? id : undefined, chars: w.chars })
      }
    }
    let otherChars = 0
    if (storage) {
      try {
        for (let i = 0; i < storage.length; i++) {
          const k = storage.key(i)
          if (k && !OWN_PREFIXES.some((p) => k.startsWith(p))) otherChars += k.length + (storage.getItem(k)?.length ?? 0)
        }
      } catch {
        // A usage readout is not worth an error.
      }
    }
    return { items, otherChars }
  }

  return { load, save, usage }
}

export function exportState(state: AppState): string {
  return JSON.stringify(state, null, 2)
}

export function importState(json: string): AppState {
  return migrate(JSON.parse(json))
}
