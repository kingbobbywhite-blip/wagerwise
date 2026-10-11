import type { LeagueId } from "@/lib/leagues"
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

export interface SaveResult {
  ok: boolean
  error?: string
  /**
   * True only when the write failed for want of room.
   *
   * The distinction decides whether anything may be thrown away. Shedding data
   * is the right answer to a full quota and the wrong answer to every other
   * failure: storage disabled in a private window, or a value that would not
   * serialise, would otherwise have the app delete slate after slate in a loop
   * trying to fix a problem that was never about size.
   */
  quota?: boolean
}

export function saveState(state: AppState): SaveResult {
  if (typeof window === "undefined") return { ok: false, error: "No browser storage available." }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state))
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Browsers disagree about the name and the message. Safari throws
    // QuotaExceededError, Firefox NS_ERROR_DOM_QUOTA_REACHED, and the legacy
    // code 22 is still what some report.
    const name = e instanceof Error ? e.name : ""
    const code = typeof e === "object" && e !== null && "code" in e ? (e as { code?: number }).code : undefined
    const quota =
      /quota|NS_ERROR_DOM_QUOTA_REACHED/i.test(`${name} ${msg}`) || code === 22 || name === "QuotaExceededError"
    return {
      ok: false,
      quota,
      error: quota ? "Browser storage is full. Export your data, then clear old slates." : `Could not save: ${msg}`,
    }
  }
}

/**
 * Progressively smaller versions of the state, for when storage is full.
 *
 * This is not hypothetical. One 14-game NFL pull at eight books is roughly
 * 1,100 props x 8 quotes x ~320 bytes, which is 2.8MB of JSON; browsers meter
 * localStorage in UTF-16 code units, so that is over 5MiB of a ~5MiB quota
 * before an NBA or NHL cache sits beside it. A pull can therefore fail to save
 * at all, and until now it failed silently on the one screen that causes it:
 * the slate lived in React state, looked fine, and vanished on reload along
 * with the feed credits that bought it.
 *
 * So a failed save sheds load rather than giving up, oldest and cheapest
 * first, and says what it dropped. The order is deliberate: line history is
 * research and can be thinned, another league's slate is yesterday's problem,
 * and the pull you just paid for is the last thing to go. Slips are never
 * dropped — they are the only record of what the model got right.
 */
export function reduceForQuota(
  state: AppState,
  keep?: LeagueId | null,
): { state: AppState; dropped: string } | null {
  // 1. Thin the line history to the newest few pulls.
  if (state.lines.length > 2) {
    return {
      state: { ...state, lines: state.lines.slice(0, 2) },
      dropped: `${state.lines.length - 2} older line snapshots`,
    }
  }
  // 2. Drop other leagues' slates, newest kept.
  const others = (Object.keys(state.daily) as LeagueId[]).filter((id) => id !== keep)
  if (others.length > 0) {
    const oldest = others.sort((a, b) =>
      (state.daily[a]?.fetchedAt ?? "").localeCompare(state.daily[b]?.fetchedAt ?? ""),
    )[0]
    const daily = { ...state.daily }
    delete daily[oldest]
    return { state: { ...state, daily }, dropped: `the ${oldest.toUpperCase()} slate` }
  }
  // 3. The line history entirely.
  if (state.lines.length > 0) {
    return { state: { ...state, lines: [] }, dropped: "the line history" }
  }
  // 4. The imported board, which can be captured again.
  if (state.slate) {
    return { state: { ...state, slate: null }, dropped: "the imported board" }
  }
  // 5. The last slate standing. Beyond this there is nothing safe to shed:
  // slips are the only record of what the model predicted.
  if (Object.keys(state.daily).length > 0) {
    return { state: { ...state, daily: {} }, dropped: "every cached slate" }
  }
  return null
}

export function exportState(state: AppState): string {
  return JSON.stringify(state, null, 2)
}

export function importState(json: string): AppState {
  return migrate(JSON.parse(json))
}
