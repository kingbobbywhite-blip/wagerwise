"use client"

import * as React from "react"
import { Check, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { breakEvenLegProb, capturedToMode, validateCapture, type CapturedPayout } from "@/lib/quant/payouts"
import { pct } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * Reads the payout multipliers off the app's own screen.
 *
 * Stored tables drift. Operators change multipliers by state, by promotion and
 * by sport, and boosted picks override them outright. Since the app displays the
 * payout while you are building the entry, that number is ground truth and it is
 * what gets captured, stored with the slip, and used to price it.
 */
export function PayoutCapture({
  value,
  onChange,
  suggestedFrom,
}: {
  value: CapturedPayout
  onChange: (next: CapturedPayout) => void
  suggestedFrom?: string
}) {
  const problems = React.useMemo(() => validateCapture(value), [value])
  const breakEven = React.useMemo(() => {
    if (problems.length > 0) return null
    return breakEvenLegProb(capturedToMode(value), value.picks)
  }, [value, problems])

  // Tiers worth showing: all-correct down to two below, which covers every
  // flex product these apps run.
  const tierRows = React.useMemo(() => {
    const rows: number[] = []
    for (let k = value.picks; k >= Math.max(0, value.picks - 3); k--) rows.push(k)
    return rows
  }, [value.picks])

  function setTier(k: number, raw: string) {
    const next = { ...value.tiers }
    const n = Number.parseFloat(raw)
    if (raw.trim() === "" || !Number.isFinite(n)) delete next[k]
    else next[k] = n
    onChange({ ...value, tiers: next, confirmed: false })
  }

  const implausible = breakEven != null && (breakEven < 0.35 || breakEven > 0.85)

  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        value.confirmed ? "border-primary/40 bg-primary/5" : "border-accent/40 bg-accent/5",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">Payout on screen</h3>
          <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-muted-foreground">
            Enter the multipliers the app is showing you right now for a {value.picks}-pick entry.
            {suggestedFrom ? ` Pre-filled from the stored ${suggestedFrom} table, which is a starting point, not a source of truth.` : ""}
          </p>
        </div>
        <Button
          size="sm"
          variant={value.confirmed ? "secondary" : "default"}
          disabled={problems.length > 0}
          onClick={() => onChange({ ...value, confirmed: !value.confirmed, capturedAt: new Date().toISOString() })}
        >
          {value.confirmed ? <Check className="mr-1 size-3" /> : null}
          {value.confirmed ? "Confirmed" : "I checked this in the app"}
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap gap-3">
        {tierRows.map((k) => (
          <div key={k}>
            <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {k} of {value.picks}
            </Label>
            <div className="mt-1 flex items-center gap-1">
              <Input
                type="number"
                step="0.05"
                min="0"
                value={value.tiers[k] ?? ""}
                placeholder="—"
                onChange={(e) => setTier(k, e.target.value)}
                className="h-8 w-20 text-right font-mono text-xs tabular-nums"
              />
              <span className="font-mono text-xs text-muted-foreground">x</span>
            </div>
          </div>
        ))}
      </div>

      {problems.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {problems.map((p, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-destructive">
              <TriangleAlert className="mt-0.5 size-3 shrink-0" />
              <span>{p.message}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p
          className={cn(
            "mt-3 text-[11px] leading-relaxed",
            implausible ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {breakEven != null ? (
            <>
              This table breaks even at <span className="font-mono font-semibold">{pct(breakEven)}</span> per leg.
              {implausible
                ? " That is outside the plausible range for a pick'em entry, which almost always means a mistyped multiplier."
                : " Every expected-value figure below is measured against that bar."}
            </>
          ) : (
            "Enter the all-correct multiplier to see the break-even rate."
          )}
        </p>
      )}
    </div>
  )
}
