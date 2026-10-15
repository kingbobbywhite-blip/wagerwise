"use client"

import { toast } from "sonner"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { leagueFor, type LeagueId } from "@/lib/leagues"
import { useStore } from "@/lib/store/provider"
import { shortDate, storageSize } from "@/lib/format"

/**
 * What this browser is holding, piece by piece, and a way to let go of it.
 *
 * The full-storage banner used to tell people to clear old slates, and there
 * was nowhere to do that short of wiping the site's data, slips and all. This
 * is that place. Clearing is one press with an undo rather than a dialog,
 * because everything here except the slips can be pulled or captured again.
 */
export function StoragePanel({ onExport }: { onExport?: () => void }) {
  const { state, storage, unsaved, saveError, setDaily, clearDaily, clearLines, setSlate, addLineSnapshot } = useStore()
  if (!storage) return null

  const sizeOf = (kind: string, league?: LeagueId) =>
    storage.items.find((i) => i.kind === kind && (league == null || i.league === league))?.chars ?? null
  const ours = storage.items.reduce((a, i) => a + i.chars, 0)

  const rows: { id: string; label: string; detail: string; chars: number | null; clear?: () => void }[] = [
    {
      id: "core",
      label: "Settings and slips",
      detail: `${state.slips.length} logged ${state.slips.length === 1 ? "entry" : "entries"}. Never cleared to make room.`,
      chars: sizeOf("core"),
    },
  ]
  for (const id of Object.keys(state.daily) as LeagueId[]) {
    const cache = state.daily[id]
    if (!cache) continue
    rows.push({
      id: `daily-${id}`,
      label: `${leagueFor(id).label} slate`,
      detail: `${cache.events.length} games, ${cache.quotes.length.toLocaleString()} prices, pulled ${shortDate(cache.fetchedAt)}`,
      chars: sizeOf("daily", id),
      clear: () => {
        clearDaily(id)
        toast.success(`Cleared the ${leagueFor(id).label} slate`, {
          action: { label: "Undo", onClick: () => setDaily(cache) },
        })
      },
    })
  }
  if (state.lines.length > 0) {
    const lines = state.lines
    rows.push({
      id: "lines",
      label: "Line history",
      detail: `${lines.length} ${lines.length === 1 ? "pull" : "pulls"}, kept to measure how lines move toward kick-off`,
      chars: sizeOf("lines"),
      clear: () => {
        clearLines()
        // Restoring puts back exactly what was cleared, pulls made since included.
        toast.success("Cleared the line history", {
          action: { label: "Undo", onClick: () => restoreLines(lines) },
        })
      },
    })
  }
  if (state.slate) {
    const slate = state.slate
    rows.push({
      id: "slate",
      label: "Imported board",
      detail: `${slate.rows.length} lines from ${slate.label}`,
      chars: sizeOf("slate"),
      clear: () => {
        setSlate(null)
        toast.success("Cleared the imported board", { action: { label: "Undo", onClick: () => setSlate(slate) } })
      },
    })
  }

  function restoreLines(lines: typeof state.lines) {
    // Adding the snapshots back oldest first rebuilds the history newest-first,
    // the order it was in.
    for (const snap of [...lines].reverse()) addLineSnapshot(snap)
  }

  const problem = saveError != null || unsaved.length > 0

  return (
    <div
      className={`space-y-3 rounded-lg border p-4 ${problem ? "border-accent/40 bg-accent/5" : "border-border/60 bg-card/40"}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Storage in this browser</h2>
        <span className="font-mono text-xs tabular-nums">{storageSize(ours + storage.otherChars)} used</span>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Browsers cap this at roughly 5 to 10 MB a site, depending on the browser; sizes here are counted the strictest
        way. Slates are stored compressed, so a full NFL Sunday is a few hundred KB.
        {problem ? " Anything marked not saved is on screen now but will be gone after a reload." : ""}
      </p>
      <ul className="divide-y divide-border/40">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="text-xs font-medium">{r.label}</p>
              <p className="text-[11px] leading-snug text-muted-foreground">{r.detail}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {r.chars != null ? (
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{storageSize(r.chars)}</span>
              ) : (
                <span className="font-mono text-[11px] text-accent">not saved</span>
              )}
              {r.clear ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  onClick={r.clear}
                  aria-label={`Clear ${r.label.toLowerCase()}`}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              ) : (
                <span className="size-7" aria-hidden />
              )}
            </div>
          </li>
        ))}
        {storage.otherChars > 0 ? (
          <li className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="text-xs font-medium">Other data at this address</p>
              <p className="text-[11px] leading-snug text-muted-foreground">
                Not WagerWise&apos;s, but it counts against the same allowance. Another app run on the same localhost
                port is the usual cause.
              </p>
            </div>
            <span className="mr-9 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
              {storageSize(storage.otherChars)}
            </span>
          </li>
        ) : null}
      </ul>
      {onExport ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          A cleared slate can be pulled again, at a cost in feed credits.{" "}
          <button type="button" onClick={onExport} className="underline underline-offset-2">
            Export everything first
          </button>{" "}
          if you want a copy.
        </p>
      ) : null}
    </div>
  )
}
