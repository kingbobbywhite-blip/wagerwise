import * as React from "react"
import { buildDailyPicks, type BuildOptions, type DailyPicks } from "@/lib/today/build"
import type { FeedQuote } from "@/lib/quant/valuebets"
import type { LeagueId } from "@/lib/leagues"
import type { PicksRequest, PicksResponse } from "@/lib/today/picks.worker"

/** Everything the day's picks are built from. A new object means a new build. */
export interface PickInputs {
  leagueId: LeagueId
  /**
   * The stored pull the quotes were taken from, compared by identity. Picks are
   * shown only while that pull is still the one on screen: a refresh replaces
   * it, and restoring a backup swaps it out.
   */
  pull: unknown
  quotes: FeedQuote[]
  options: BuildOptions
}

export interface DailyPicksState {
  /** The latest finished build, or null before the first one. */
  picks: DailyPicks | null
  /** The inputs that build was made from, so a caller can tell whose picks they are. */
  builtFrom: PickInputs | null
  /** True while the inputs have moved on and the build has not caught up. */
  pricing: boolean
  /** Why the latest build failed, when it did. */
  error: string | null
}

/**
 * The day's picks, built without ever holding up the page.
 *
 * A full football Sunday takes a second or more to price, and built during
 * render that second froze the page: a click on the NFL tab could not even
 * highlight it until the build was done, and the minute clock froze it again
 * every minute. The build runs in a Web Worker instead, so the page stays live
 * and the picks arrive when they are ready. Where a worker cannot be started,
 * it runs on the page's own thread, but only after the browser has painted.
 */
export function useDailyPicks(inputs: PickInputs | null): DailyPicksState {
  const [built, setBuilt] = React.useState<{ from: PickInputs; picks: DailyPicks | null; error: string | null } | null>(
    null,
  )
  const worker = React.useRef<Worker | null>(null)
  // False once a worker has failed, so later builds go straight to the fallback.
  const workerUsable = React.useRef(true)
  // Whether the worker is still working on an earlier request.
  const busy = React.useRef(false)
  const latest = React.useRef(0)

  React.useEffect(
    () => () => {
      // Cleared as well as stopped: a terminated worker drops messages silently.
      worker.current?.terminate()
      worker.current = null
    },
    [],
  )

  React.useEffect(() => {
    // Every change of inputs retires the request before it, so an answer still
    // on its way is dropped rather than shown for inputs that are gone.
    const id = ++latest.current
    if (!inputs) {
      // Nothing to build: stop any build in flight instead of letting it finish.
      if (worker.current && busy.current) {
        worker.current.terminate()
        worker.current = null
      }
      busy.current = false
      setBuilt(null)
      return
    }
    const settle = (picks: DailyPicks | null, error: string | null) => {
      // An answer to anything but the newest request is out of date.
      if (id !== latest.current) return
      busy.current = false
      setBuilt({ from: inputs, picks, error })
    }
    const onMainThread = () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      // A frame first, so the click that asked for this has painted before the
      // page's thread is spent on arithmetic.
      const frame = requestAnimationFrame(() => {
        timer = setTimeout(() => {
          if (id !== latest.current) return
          try {
            settle(buildDailyPicks(inputs.quotes, inputs.options), null)
          } catch (err) {
            settle(null, err instanceof Error ? err.message : String(err))
          }
        }, 0)
      })
      return () => {
        cancelAnimationFrame(frame)
        if (timer) clearTimeout(timer)
      }
    }

    if (!workerUsable.current || typeof Worker === "undefined") return onMainThread()

    // A worker still busy with an earlier slate would make this one wait behind
    // work nobody wants any more: start a fresh one instead.
    if (worker.current && busy.current) {
      worker.current.terminate()
      worker.current = null
    }
    if (!worker.current) {
      try {
        worker.current = new Worker(new URL("../lib/today/picks.worker.ts", import.meta.url), { type: "module" })
      } catch {
        workerUsable.current = false
        return onMainThread()
      }
    }
    const w = worker.current
    let cancelFallback: (() => void) | null = null
    w.onmessage = (e: MessageEvent<PicksResponse>) => {
      if (e.data.id !== id) return
      if ("error" in e.data) settle(null, e.data.error)
      else settle(e.data.picks, null)
    }
    w.onerror = (e) => {
      // The worker could not load or crashed: price on this thread from now on.
      e.preventDefault()
      workerUsable.current = false
      busy.current = false
      w.terminate()
      if (worker.current === w) worker.current = null
      if (id === latest.current) cancelFallback = onMainThread()
    }
    busy.current = true
    w.postMessage({ id, quotes: inputs.quotes, options: inputs.options } satisfies PicksRequest)
    return () => cancelFallback?.()
  }, [inputs])

  return {
    picks: built?.picks ?? null,
    builtFrom: built?.from ?? null,
    pricing: inputs !== null && built?.from !== inputs,
    error: built?.error ?? null,
  }
}
