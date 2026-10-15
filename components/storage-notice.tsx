"use client"

import * as React from "react"
import Link from "next/link"
import { TriangleAlert, X } from "lucide-react"
import { useStore } from "@/lib/store/provider"
import { listJoin } from "@/lib/format"

/**
 * Says when the browser could not keep what you just did.
 *
 * Lives in the header rather than on a page, because the two screens that
 * cause a full-storage failure were the two that never showed it: a slate pull
 * is the biggest write in the app and settling legs is the most frequent, and
 * both read `saveError` from a store that nobody asked. One banner everywhere
 * cannot be forgotten by a new page.
 *
 * It describes what is true now, not a history of what was tried: what is on
 * screen but not stored, and so will be gone after a reload. Once a later save
 * fits (a cache cleared, a smaller pull), the list shrinks and the banner goes.
 */
export function StorageNotice() {
  const { saveError, unsaved, ready } = useStore()
  // Dismissed for this exact message only, so anything new shows again.
  const message = saveError ?? unsaved.join("|")
  const [dismissed, setDismissed] = React.useState<string | null>(null)
  if (!ready || (!saveError && unsaved.length === 0) || dismissed === message) return null
  // Shed order is cheapest first; read it the other way, so the thing that
  // matters most (usually the pull just paid for) is named first.
  const named = [...unsaved].reverse()
  return (
    <div
      role="status"
      className={
        saveError
          ? "border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-[11px] leading-relaxed text-destructive md:px-6"
          : "border-b border-accent/40 bg-accent/10 px-4 py-2 text-[11px] leading-relaxed text-accent md:px-6"
      }
    >
      <div className="mx-auto flex max-w-7xl items-start gap-2">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1">
          {saveError ? (
            <>
              <strong className="font-semibold">{saveError}</strong> Changes since then are not being saved and will be
              gone after a reload.{" "}
              <Link href="/settings#data" className="underline underline-offset-2">
                Export your data now
              </Link>
              , then clear what you no longer need.
            </>
          ) : (
            <>
              Browser storage is full, so {listJoin(named)} {named.length === 1 && !/s$/.test(named[0]) ? "is" : "are"}{" "}
              on screen but will not be kept after a reload. Your slips and settings are saved.{" "}
              <Link href="/settings#data" className="underline underline-offset-2">
                Manage storage
              </Link>
            </>
          )}
        </p>
        <button
          type="button"
          onClick={() => setDismissed(message)}
          className="-m-1 shrink-0 rounded p-1 opacity-70 hover:opacity-100"
          aria-label="Dismiss"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
  )
}
