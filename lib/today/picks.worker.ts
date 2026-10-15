import { buildDailyPicks, type BuildOptions } from "./build"
import type { FeedQuote } from "@/lib/quant/valuebets"

/**
 * The day's picks, built off the main thread.
 *
 * Pricing a full slate and searching it for parlays is a second or more of
 * uninterrupted arithmetic. On the page's own thread that second is a frozen
 * page: the tab just clicked cannot even highlight until it ends. Here it runs
 * beside the page, which stays live while the numbers come in.
 *
 * The same buildDailyPicks the page would call, so the picks are identical.
 */

export interface PicksRequest {
  id: number
  quotes: FeedQuote[]
  options: BuildOptions
}

export type PicksResponse =
  | { id: number; picks: ReturnType<typeof buildDailyPicks> }
  | { id: number; error: string }

// Typed by hand rather than with the webworker lib, which conflicts with dom.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<PicksRequest>) => void) | null
  postMessage: (message: PicksResponse) => void
}

scope.onmessage = (e) => {
  const { id, quotes, options } = e.data
  try {
    scope.postMessage({ id, picks: buildDailyPicks(quotes, options) })
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
