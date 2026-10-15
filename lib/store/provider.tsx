"use client"

import * as React from "react"
import type { LeagueId } from "@/lib/leagues"
import { browserStorage, createPersister, type Persister, type StorageUsage } from "./local"
import {
  EMPTY_STATE,
  MAX_LINE_SNAPSHOTS,
  type AppSettings,
  type AppState,
  type DailyCache,
  type LineSnapshot,
  type Slate,
  type TrackedSlip,
} from "./schema"

interface StoreValue {
  state: AppState
  /** False until localStorage has been read, so the UI can avoid flashing empty. */
  ready: boolean
  saveError: string | null
  /**
   * What is on screen but could not be stored because browser storage is
   * full, so will be gone after a reload. Empty when everything fit.
   */
  unsaved: string[]
  /** What each stored piece takes, for the storage readout in Settings. Null until loaded. */
  storage: StorageUsage | null
  setSettings: (updater: (s: AppSettings) => AppSettings) => void
  setSlate: (slate: Slate | null) => void
  /** Store a pull under its own league, leaving the other leagues' caches intact. */
  setDaily: (daily: DailyCache) => void
  /** Keep a pull's lines for later comparison against the same props nearer kick-off. */
  addLineSnapshot: (snapshot: LineSnapshot) => void
  /** Forget one league's cached pull, here and in storage. */
  clearDaily: (league: LeagueId) => void
  /** Forget the line history. */
  clearLines: () => void
  /** Add an entry, newest first, or back at `at` when undoing a delete. */
  addSlip: (slip: TrackedSlip, at?: number) => void
  updateSlip: (id: string, updater: (s: TrackedSlip) => TrackedSlip) => void
  removeSlip: (id: string) => void
  replaceAll: (next: AppState) => void
}

const Ctx = React.createContext<StoreValue | null>(null)

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<AppState>(EMPTY_STATE)
  const [ready, setReady] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [unsaved, setUnsaved] = React.useState<string[]>([])
  const [storage, setStorage] = React.useState<StorageUsage | null>(null)
  const persister = React.useRef<Persister | null>(null)

  React.useEffect(() => {
    const p = createPersister(browserStorage())
    persister.current = p
    setState(p.load())
    setReady(true)
  }, [])

  // Persist on every change, but not before the initial read has happened, or
  // we would overwrite stored data with the empty default on first paint.
  //
  // When storage is full the persister stores less rather than nothing (see
  // reduceForQuota), and reports what it left out. The state on screen is
  // never cut to fit: a pull that cannot be kept is still a pull the credits
  // were spent on, and it stays usable until the tab is closed.
  React.useEffect(() => {
    const p = persister.current
    if (!ready || !p) return
    const r = p.save(state)
    setSaveError(r.ok ? null : (r.error ?? "Could not save."))
    setUnsaved((prev) => (prev.length === r.unsaved.length && prev.every((x, i) => x === r.unsaved[i]) ? prev : r.unsaved))
    const usage = p.usage()
    setStorage((prev) => (prev && JSON.stringify(prev) === JSON.stringify(usage) ? prev : usage))
  }, [state, ready])

  const value = React.useMemo<StoreValue>(
    () => ({
      state,
      ready,
      saveError,
      unsaved,
      storage,
      setSettings: (updater) => setState((s) => ({ ...s, settings: updater(s.settings) })),
      setSlate: (slate) => setState((s) => ({ ...s, slate })),
      setDaily: (daily) => setState((s) => ({ ...s, daily: { ...s.daily, [daily.league]: daily } })),
      addLineSnapshot: (snapshot) =>
        setState((s) => ({ ...s, lines: [snapshot, ...s.lines].slice(0, MAX_LINE_SNAPSHOTS) })),
      clearDaily: (league) =>
        setState((s) => {
          if (!s.daily[league]) return s
          const daily = { ...s.daily }
          delete daily[league]
          return { ...s, daily }
        }),
      clearLines: () => setState((s) => (s.lines.length === 0 ? s : { ...s, lines: [] })),
      addSlip: (slip, at = 0) =>
        setState((s) => {
          // An undo pressed twice must not log the entry twice.
          if (s.slips.some((x) => x.id === slip.id)) return s
          const slips = [...s.slips]
          slips.splice(Math.max(0, Math.min(at, slips.length)), 0, slip)
          return { ...s, slips }
        }),
      updateSlip: (id, updater) =>
        setState((s) => ({ ...s, slips: s.slips.map((x) => (x.id === id ? updater(x) : x)) })),
      removeSlip: (id) => setState((s) => ({ ...s, slips: s.slips.filter((x) => x.id !== id) })),
      replaceAll: (next) => setState(next),
    }),
    [state, ready, saveError, unsaved, storage],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore(): StoreValue {
  const v = React.useContext(Ctx)
  if (!v) throw new Error("useStore must be used inside StoreProvider")
  return v
}
