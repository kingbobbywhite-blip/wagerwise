"use client"

import * as React from "react"
import type { LeagueId } from "@/lib/leagues"
import { clearLegacyState, isQuotaError, loadState, saveReduced } from "./local"
import { joinParts, openPartStore, partLabel, partsOf, partsToWrite, type PartStore } from "./idb"
import {
  EMPTY_STATE,
  MAX_LINE_SNAPSHOTS,
  migrate,
  type AppSettings,
  type AppState,
  type DailyCache,
  type LineSnapshot,
  type Slate,
  type TrackedSlip,
} from "./schema"

interface StoreValue {
  state: AppState
  /** False until storage has been read, so the UI can avoid flashing empty. */
  ready: boolean
  /** Why a save failed, when it failed for some reason other than room. */
  saveError: string | null
  /**
   * What could not be kept for want of room, in words. It is still in the
   * state and on screen: nothing is ever taken off the screen to make a save
   * fit. It is gone after a reload.
   */
  unsaved: string[]
  setSettings: (updater: (s: AppSettings) => AppSettings) => void
  setSlate: (slate: Slate | null) => void
  /** Store a pull under its own league, leaving the other leagues' caches intact. */
  setDaily: (daily: DailyCache) => void
  /** Keep a pull's lines for later comparison against the same props nearer kick-off. */
  addLineSnapshot: (snapshot: LineSnapshot) => void
  addSlip: (slip: TrackedSlip) => void
  updateSlip: (id: string, updater: (s: TrackedSlip) => TrackedSlip) => void
  removeSlip: (id: string) => void
  replaceAll: (next: AppState) => void
}

/** A save that did not happen, by the record (or, without IndexedDB, the piece) it was for. */
interface SaveFailure {
  label: string
  quota: boolean
  message: string
}

const Ctx = React.createContext<StoreValue | null>(null)

/**
 * The most recently fetched slate, which a full localStorage keeps longest.
 * Not whichever tab is selected: switching tabs while a pull is in flight
 * would otherwise shed the slate the credits were just spent on.
 */
function newestLeague(state: AppState): LeagueId {
  const newest = (Object.keys(state.daily) as LeagueId[]).sort((a, b) =>
    (state.daily[b]?.fetchedAt ?? "").localeCompare(state.daily[a]?.fetchedAt ?? ""),
  )[0]
  return newest ?? state.settings.daily.league
}

/**
 * Opens IndexedDB and reads the state out of it, moving an install still on
 * the old localStorage blob across first. Rejects where IndexedDB cannot be
 * used, and the caller falls back to that blob.
 */
async function loadFromIndexedDb(): Promise<{ db: PartStore; state: AppState; records: string[] }> {
  const db = await openPartStore()
  // The old blob, or the empty state on a fresh install, written only if the
  // database holds nothing yet. The blob is cleared once it is in, giving its
  // share of the localStorage quota back.
  if (await db.seed(partsOf(loadState()))) clearLegacyState()
  // Read back rather than trusted: if another tab seeded first, its state is
  // the one stored, and this tab has to show the same.
  const records = await db.readAll()
  const raw = joinParts(records)
  return { db, state: raw ? migrate(raw) : EMPTY_STATE, records: Object.keys(records) }
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<AppState>(EMPTY_STATE)
  const [ready, setReady] = React.useState(false)
  const [failures, setFailures] = React.useState<Record<string, SaveFailure>>({})
  // Where the state is written: IndexedDB, or null for the localStorage blob.
  const db = React.useRef<PartStore | null>(null)
  // Each IndexedDB record, by the references it was last written from.
  const sent = React.useRef(new Map<string, unknown[]>())

  React.useEffect(() => {
    let live = true
    loadFromIndexedDb().then(
      (loaded) => {
        if (!live) return
        db.current = loaded.db
        // What is stored is what was just read, so nothing is rewritten on
        // the first save. A stored record the state has no part for (a
        // league since retired) is given empty references, so the first save
        // removes it rather than leaving it to take up room forever.
        const current = new Map(partsOf(loaded.state).map((p) => [p.key, p.refs]))
        sent.current = new Map(loaded.records.map((k) => [k, current.get(k) ?? []]))
        setState(loaded.state)
        setReady(true)
      },
      () => {
        if (!live) return
        db.current = null
        setState(loadState())
        setReady(true)
      },
    )
    return () => {
      live = false
    }
  }, [])

  // Persist on every change, but not before the initial read has happened, or
  // we would overwrite stored data with the empty default on first paint.
  //
  // Nothing here ever changes the state. A save that does not fit is reported
  // and left at that: what is on screen stays on screen until a reload. The
  // old rule — shed from the state until the save fits — ended, on a slate too
  // big to store, by shedding the pull that had just come in, so a pull that
  // succeeded read as "Nothing pulled yet".
  React.useEffect(() => {
    if (!ready) return
    const store = db.current

    if (!store) {
      // No IndexedDB: the one localStorage blob, shed from the stored copy
      // until it fits.
      const r = saveReduced(state, newestLeague(state))
      const next: Record<string, SaveFailure> = {}
      for (const d of r.dropped) next[d] = { label: d, quota: true, message: "" }
      if (!r.ok) next["*"] = { label: "everything", quota: false, message: r.error ?? "Could not save." }
      setFailures((prev) => (sameFailures(prev, next) ? prev : next))
      return
    }

    for (const part of partsToWrite(sent.current, state)) {
      const { key, refs } = part
      if (part.value == null) sent.current.delete(key)
      else sent.current.set(key, refs)
      store.write(key, part.value).then(
        () => settle(key, refs, null),
        (err: unknown) => settle(key, refs, err),
      )
    }

    function settle(key: string, refs: unknown[], err: unknown) {
      // Only the newest write of a record says whether it is stored: an
      // answer to an older one is out of date.
      const latest = sent.current.get(key)
      if (latest !== undefined && latest !== refs) return
      if (err == null) {
        setFailures((prev) => {
          if (!(key in prev)) return prev
          const next = { ...prev }
          delete next[key]
          return next
        })
        return
      }
      const quota = isQuotaError(err)
      // A write that failed for want of room is not retried until the part
      // changes: the same megabytes would fail the same way on every
      // keystroke. Any other failure may be passing, so the next save tries
      // it again.
      if (!quota && latest === refs) sent.current.delete(key)
      const message = `Could not save ${partLabel(key)}: ${err instanceof Error ? err.message : String(err)}`
      setFailures((prev) => ({ ...prev, [key]: { label: partLabel(key), quota, message } }))
    }
  }, [state, ready])

  const unsaved = React.useMemo(
    () =>
      Object.values(failures)
        .filter((f) => f.quota)
        .map((f) => f.label),
    [failures],
  )
  const saveError = Object.values(failures).find((f) => !f.quota)?.message ?? null

  const value = React.useMemo<StoreValue>(
    () => ({
      state,
      ready,
      saveError,
      unsaved,
      setSettings: (updater) => setState((s) => ({ ...s, settings: updater(s.settings) })),
      setSlate: (slate) => setState((s) => ({ ...s, slate })),
      setDaily: (daily) => setState((s) => ({ ...s, daily: { ...s.daily, [daily.league]: daily } })),
      addLineSnapshot: (snapshot) =>
        setState((s) => ({ ...s, lines: [snapshot, ...s.lines].slice(0, MAX_LINE_SNAPSHOTS) })),
      addSlip: (slip) => setState((s) => ({ ...s, slips: [slip, ...s.slips] })),
      updateSlip: (id, updater) =>
        setState((s) => ({ ...s, slips: s.slips.map((x) => (x.id === id ? updater(x) : x)) })),
      removeSlip: (id) => setState((s) => ({ ...s, slips: s.slips.filter((x) => x.id !== id) })),
      replaceAll: (next) => setState(next),
    }),
    [state, ready, saveError, unsaved],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

function sameFailures(a: Record<string, SaveFailure>, b: Record<string, SaveFailure>): boolean {
  const ka = Object.keys(a)
  return (
    ka.length === Object.keys(b).length &&
    ka.every((k) => b[k] && b[k].message === a[k].message && b[k].quota === a[k].quota)
  )
}

export function useStore(): StoreValue {
  const v = React.useContext(Ctx)
  if (!v) throw new Error("useStore must be used inside StoreProvider")
  return v
}
