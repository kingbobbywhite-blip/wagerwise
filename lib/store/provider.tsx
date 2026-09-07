"use client"

import * as React from "react"
import { loadState, saveState } from "./local"
import { EMPTY_STATE, type AppSettings, type AppState, type DailyCache, type Slate, type TrackedSlip } from "./schema"

interface StoreValue {
  state: AppState
  /** False until localStorage has been read, so the UI can avoid flashing empty. */
  ready: boolean
  saveError: string | null
  setSettings: (updater: (s: AppSettings) => AppSettings) => void
  setSlate: (slate: Slate | null) => void
  setDaily: (daily: DailyCache | null) => void
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

  React.useEffect(() => {
    setState(loadState())
    setReady(true)
  }, [])

  // Persist on every change, but not before the initial read has happened, or
  // we would overwrite stored data with the empty default on first paint.
  React.useEffect(() => {
    if (!ready) return
    const r = saveState(state)
    setSaveError(r.ok ? null : r.error)
  }, [state, ready])

  const value = React.useMemo<StoreValue>(
    () => ({
      state,
      ready,
      saveError,
      setSettings: (updater) => setState((s) => ({ ...s, settings: updater(s.settings) })),
      setSlate: (slate) => setState((s) => ({ ...s, slate })),
      setDaily: (daily) => setState((s) => ({ ...s, daily })),
      addSlip: (slip) => setState((s) => ({ ...s, slips: [slip, ...s.slips] })),
      updateSlip: (id, updater) =>
        setState((s) => ({ ...s, slips: s.slips.map((x) => (x.id === id ? updater(x) : x)) })),
      removeSlip: (id) => setState((s) => ({ ...s, slips: s.slips.filter((x) => x.id !== id) })),
      replaceAll: (next) => setState(next),
    }),
    [state, ready, saveError],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore(): StoreValue {
  const v = React.useContext(Ctx)
  if (!v) throw new Error("useStore must be used inside StoreProvider")
  return v
}
