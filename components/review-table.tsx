"use client"

import * as React from "react"
import { Check, Trash2, TriangleAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MARKETS } from "@/lib/nba/markets"
import type { DraftProp } from "@/lib/import/draft"
import { validateDrafts } from "@/lib/import/draft"
import { bookProfile } from "@/lib/quant/books"
import { cn } from "@/lib/utils"

export function ReviewTable({
  drafts,
  onChange,
}: {
  drafts: DraftProp[]
  onChange: (next: DraftProp[]) => void
}) {
  const problems = React.useMemo(() => {
    const map = new Map<string, string[]>()
    for (const p of validateDrafts(drafts)) {
      const arr = map.get(p.id) ?? []
      arr.push(p.message)
      map.set(p.id, arr)
    }
    return map
  }, [drafts])

  function update(id: string, patch: Partial<DraftProp>) {
    onChange(drafts.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }

  function remove(id: string) {
    onChange(drafts.filter((d) => d.id !== id))
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full min-w-[860px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border/60 bg-card/40 text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            <th className="px-2 py-2 w-8"></th>
            <th className="px-2 py-2">Player</th>
            <th className="px-2 py-2">Market</th>
            <th className="px-2 py-2 w-24 text-right">Line</th>
            <th className="px-2 py-2 w-28">App</th>
            <th className="px-2 py-2">Odds</th>
            <th className="px-2 py-2 w-10"></th>
          </tr>
        </thead>
        <tbody>
          {drafts.map((d) => {
            const rowProblems = problems.get(d.id) ?? []
            const blocking = rowProblems.filter((p) => p !== "Not reviewed yet.")
            return (
              <tr
                key={d.id}
                className={cn(
                  "border-b border-border/40 last:border-0",
                  blocking.length > 0 && "bg-destructive/5",
                  !d.confirmed && blocking.length === 0 && "bg-accent/5",
                )}
              >
                <td className="px-2 py-1.5">
                  <button
                    type="button"
                    aria-label={d.confirmed ? "Mark unreviewed" : "Mark reviewed"}
                    onClick={() => update(d.id, { confirmed: !d.confirmed })}
                    className={cn(
                      "flex size-5 items-center justify-center rounded border transition-colors",
                      d.confirmed
                        ? "border-primary/50 bg-primary/20 text-primary"
                        : "border-border text-transparent hover:border-primary/40",
                    )}
                  >
                    <Check className="size-3" />
                  </button>
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    value={d.player}
                    onChange={(e) => update(d.id, { player: e.target.value, confirmed: false })}
                    className="h-7 font-mono text-xs"
                  />
                  {d.issues.length > 0 ? (
                    <div className="mt-0.5 flex items-start gap-1 text-[10px] leading-tight text-accent">
                      <TriangleAlert className="mt-0.5 size-2.5 shrink-0" />
                      <span>{d.issues.join(" ")}</span>
                    </div>
                  ) : null}
                </td>
                <td className="px-2 py-1.5">
                  <Select
                    value={d.marketKey ?? ""}
                    onValueChange={(v) => update(d.id, { marketKey: v as DraftProp["marketKey"], confirmed: false })}
                  >
                    <SelectTrigger className="h-7 font-mono text-xs"><SelectValue placeholder="Pick one" /></SelectTrigger>
                    <SelectContent>
                      {Object.values(MARKETS).map((m) => (
                        <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    type="number"
                    step="0.5"
                    value={Number.isFinite(d.line) ? d.line : ""}
                    onChange={(e) => update(d.id, { line: Number.parseFloat(e.target.value), confirmed: false })}
                    className="h-7 text-right font-mono text-xs tabular-nums"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    value={d.app ?? ""}
                    onChange={(e) => update(d.id, { app: e.target.value || null })}
                    className="h-7 font-mono text-xs"
                  />
                </td>
                <td className="px-2 py-1.5">
                  {d.quotes.length === 0 ? (
                    <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">unpriced</Badge>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {d.quotes.slice(0, 3).map((q, i) => (
                        <span
                          key={i}
                          className="rounded border border-border/60 px-1 py-0.5 font-mono text-[10px] tabular-nums"
                          title={`${bookProfile(q.book).name} ${q.line} · ${q.overOdds ?? "—"}/${q.underOdds ?? "—"}`}
                        >
                          {bookProfile(q.book).name.slice(0, 8)} {q.line}
                        </span>
                      ))}
                      {d.quotes.length > 3 ? (
                        <span className="font-mono text-[10px] text-muted-foreground">+{d.quotes.length - 3}</span>
                      ) : null}
                    </div>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground hover:text-destructive"
                    onClick={() => remove(d.id)}
                    aria-label="Remove row"
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
