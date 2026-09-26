import { EMPTY_STATE, migrate, type AppState } from "./schema"

/**
 * Persistence.
 *
 * Everything lives in the browser. That is a deliberate trade: the app runs with
 * zero configuration, no account and no database, and your betting history never
 * leaves your machine. The cost is that clearing site data wipes it, so the
 * settings page offers a one-click JSON export and import.
 */

const KEY = "wagerwise.state.v1"

export function loadState(): AppState {
  if (typeof window === "undefined") return EMPTY_STATE
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return EMPTY_STATE
    return migrate(JSON.parse(raw))
  } catch {
    // Corrupt or unreadable storage must not take the whole app down.
    return EMPTY_STATE
  }
}

export function saveState(state: AppState): { ok: true } | { ok: false; error: string } {
  if (typeof window === "undefined") return { ok: false, error: "No browser storage available." }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state))
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      error: msg.toLowerCase().includes("quota")
        ? "Browser storage is full. Export your data, then clear old slates."
        : `Could not save: ${msg}`,
    }
  }
}

export function exportState(state: AppState): string {
  return JSON.stringify(state, null, 2)
}

export function importState(json: string): AppState {
  return migrate(JSON.parse(json))
}
