"use client"

import * as React from "react"
import type { LeagueId } from "@/lib/leagues"
import { loadState, reduceForQuota, saveState } from "./local"
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
  /** What a full-storage save had to shed to succeed, when it did. */
  saveDropped: string[]
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

const Ctx = React.createContext<StoreValue | null>(null)

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<AppState>(EMPTY_STATE)
  const [ready, setReady] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [saveDropped, setSaveDropped] = React.useState<string[]>([])

  React.useEffect(() => {
    setState(loadState())
    setReady(true)
  }, [])

  // Persist on every change, but not before the initial read has happened, or
  // we would overwrite stored data with the empty default on first paint.
  React.useEffect(() => {
    if (!ready) return
    const r = saveState(state)
    if (r.ok) {
      setSaveError(null)
      return
    }
    // Out of room: shed the cheapest thing and try again on the next pass
    // rather than reporting success while nothing is being written. Each
    // reduction is strictly smaller, so this terminates; when there is nothing
    // left to shed, the error stands and every screen shows it.
    //
    // Only for a quota failure. Shedding data in response to any other error —
    // storage switched off, a value that will not serialise — would delete
    // slate after slate trying to fix a problem that was never about size.
    // Keep the most recently fetched slate rather than whichever tab is
    // selected: switching tabs while a pull is in flight would otherwise shed
    // the slate the credits were just spent on.
    const newest = (Object.keys(state.daily) as LeagueId[]).sort((a, b) =>
      (state.daily[b]?.fetchedAt ?? "").localeCompare(state.daily[a]?.fetchedAt ?? ""),
    )[0]
    const reduced = r.quota ? reduceForQuota(state, newest ?? state.settings.daily.league) : null
    if (reduced) {
      setSaveDropped((d) => (d.includes(reduced.dropped) ? d : [...d, reduced.dropped]))
      setState(reduced.state)
      return
    }
    setSaveError(r.error ?? "Could not save.")
  }, [state, ready])

  const value = React.useMemo<StoreValue>(
    () => ({
      state,
      ready,
      saveError,
      saveDropped,
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
    [state, ready, saveError, saveDropped],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore(): StoreValue {
  const v = React.useContext(Ctx)
  if (!v) throw new Error("useStore must be used inside StoreProvider")
  return v
}
