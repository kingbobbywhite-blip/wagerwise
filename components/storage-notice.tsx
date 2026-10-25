"use client"

import Link from "next/link"
import { TriangleAlert } from "lucide-react"
import { useStore } from "@/lib/store/provider"

/**
 * Says when the browser could not keep what you just did.
 *
 * Lives in the header rather than on a page, because the two screens that
 * cause a full-storage failure were the two that never showed it: a slate pull
 * is the biggest write in the app and settling legs is the most frequent, and
 * both read `saveError` from a store that nobody asked. One banner everywhere
 * cannot be forgotten by a new page.
 *
 * What it reports is never gone from the screen. A save that does not fit
 * leaves the state alone, so the notice is about the next reload, not about
 * anything already missing.
 */
export function StorageNotice() {
  const { saveError, unsaved, ready } = useStore()
  if (!ready || (!saveError && unsaved.length === 0)) return null
  return (
    <div
      role="status"
      className={
        saveError
          ? "border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-[11px] leading-relaxed text-destructive md:px-6"
          : "border-b border-accent/40 bg-accent/10 px-4 py-2 text-[11px] leading-relaxed text-accent md:px-6"
      }
    >
      <p className="mx-auto flex max-w-7xl items-start gap-2">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
        <span>
          {saveError ? (
            <>
              <strong className="font-semibold">{saveError}</strong> What is on screen is still here, but what was
              not saved will be lost on reload.{" "}
              <Link href="/settings" className="underline underline-offset-2">
                Export your data now
              </Link>
              , then clear what you no longer need.
            </>
          ) : (
            <>
              Browser storage is full, so {unsaved.join(", then ")} could not be saved.{" "}
              {unsaved.length === 1 ? "It is" : "They are"} still on screen, but will be gone after a reload. Export
              from{" "}
              <Link href="/settings" className="underline underline-offset-2">
                Settings
              </Link>{" "}
              to keep a copy.
            </>
          )}
        </span>
      </p>
    </div>
  )
}
