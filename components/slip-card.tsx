"use client"

import * as React from "react"
import { toast } from "sonner"
import { ChevronDown, TriangleAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { SideBadge } from "@/components/side-badge"
import { StatTile } from "@/components/stat-tile"
import type { BuiltSlip } from "@/lib/quant/optimizer"
import type { CapturedPayout } from "@/lib/quant/payouts"
import { recommendStake } from "@/lib/quant/staking"
import { useStore } from "@/lib/store/provider"
import type { TrackedSlip } from "@/lib/store/schema"
import { money, multiple, pct, signedNumber, signedPct } from "@/lib/format"
import { cn } from "@/lib/utils"

export function SlipCard({
  slip,
  appId,
  modeId,
  capturedPayout,
}: {
  slip: BuiltSlip
  appId: string
  modeId: string
  capturedPayout: CapturedPayout
}) {
  const { state, addSlip } = useStore()
  const [open, setOpen] = React.useState(false)
  const e = slip.evaluation
  const advice = recommendStake(e.kelly, state.settings.bankroll)
  const positive = e.ev > 0

  function log() {
    const tracked: TrackedSlip = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      settledAt: null,
      appId,
      modeId,
      legs: slip.legs.map((l) => ({
        player: l.player,
        marketKey: l.market,
        marketLabel: l.marketLabel,
        line: l.line,
        side: l.side,
        pWinAtEntry: l.pWin,
        app: l.app,
        result: "PENDING",
        actual: null,
      })),
      stake: Number(advice.stake.toFixed(2)),
      evAtEntry: e.ev,
      pAllHitAtEntry: e.pAllHit,
      topMultiple: e.topMultiple,
      status: "PENDING",
      actualMultiple: null,
      capturedPayout,
      notes: slip.label,
    }
    addSlip(tracked)
    toast.success("Logged to tracker", { description: `${slip.legs.length} legs at ${money(tracked.stake)}` })
  }

  return (
    <div
      className={cn(
        "rounded-xl border bg-card/40 p-4",
        positive ? "border-primary/30" : "border-border/60",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-mono text-sm font-semibold tracking-tight">{slip.label}</h3>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {slip.legs.length} legs · tops out at {multiple(e.topMultiple)}
          </p>
        </div>
        <div className="text-right">
          <Badge
            variant="outline"
            className={cn("font-mono text-[11px]", positive ? "border-primary/40 text-primary" : "border-destructive/40 text-destructive")}
          >
            {signedPct(e.ev)} EV
          </Badge>
          {/* Break-even sits beside expected value on purpose: if this number
              does not look like a plausible per-leg hit rate, the payout
              multiplier is wrong and the expected value beside it is fiction. */}
          {e.breakEvenLegProb != null ? (
            <div className="mt-1 font-mono text-[10px] leading-tight text-muted-foreground">
              break-even {pct(e.breakEvenLegProb)}
              <br />
              legs avg {pct(e.avgLegProb)}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <StatTile
          label="All hit"
          value={pct(e.pAllHit)}
          hint="Modelled, correlation included."
        />
        <StatTile label="Any return" value={pct(e.pProfit)} tone={e.pProfit > 0.4 ? "good" : "neutral"} hint="Chance the entry finishes ahead." />
        <StatTile
          label="Stake"
          value={money(advice.stake)}
          tone={advice.stake > 0 ? "good" : "neutral"}
          hint={advice.note}
        />
        <StatTile
          label="Correlation"
          value={signedNumber(e.avgPairCorrelation, 2)}
          tone={Math.abs(e.avgPairCorrelation) > 0.2 ? "warn" : "neutral"}
          hint="Average between legs. Positive means they tend to land together."
        />
      </div>

      <ul className="mt-3 divide-y divide-border/40 rounded-lg border border-border/40">
        {slip.legs.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium leading-tight">{l.player}</div>
              <div className="font-mono text-[10px] text-muted-foreground">
                {l.marketLabel} · {l.app ?? "—"}
                {l.team ? ` · ${l.team}` : ""}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <SideBadge side={l.side} />
              <span className="font-mono text-sm tabular-nums">{l.line}</span>
              <span className="w-12 text-right font-mono text-xs tabular-nums text-muted-foreground">{pct(l.pWin, 0)}</span>
            </div>
          </li>
        ))}
      </ul>

      {slip.warnings.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {slip.warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-accent">
              <TriangleAlert className="mt-0.5 size-3 shrink-0" />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <Collapsible open={open} onOpenChange={setOpen} className="mt-3">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 px-2 font-mono text-[10px] uppercase tracking-[0.14em]">
            <ChevronDown className={cn("mr-1 size-3 transition-transform", open && "rotate-180")} />
            Why this entry
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-2">
          <p className="text-[11px] leading-relaxed text-muted-foreground">{slip.rationale}</p>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Payout outcomes</div>
            <table className="mt-1 w-full text-[11px]">
              <tbody>
                {[...e.outcomes].reverse().map((o) => (
                  <tr key={o.multiple} className="border-b border-border/30 last:border-0">
                    <td className="py-1 font-mono tabular-nums">{multiple(o.multiple)}</td>
                    <td className="py-1 text-right font-mono tabular-nums text-muted-foreground">{pct(o.prob)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Simulated {e.simulations.toLocaleString()} times against the payout you captured. Full Kelly here is{" "}
            {pct(e.kelly)} of bankroll; the app stakes a fraction of that on purpose.
          </p>
          {e.breakEvenLegProb != null && e.evAtAvgLegProb != null ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              The legs average {pct(e.avgLegProb)} against a {pct(e.breakEvenLegProb)} break-even, a margin of{" "}
              {signedPct(e.legProbMargin ?? 0)}. Independent legs at that average would return{" "}
              {signedPct(e.evAtAvgLegProb)}, so the gap against the {signedPct(e.ev)} above is what correlation and the
              spread between legs are contributing.
            </p>
          ) : null}
        </CollapsibleContent>
      </Collapsible>

      <Button onClick={log} size="sm" variant={positive ? "default" : "secondary"} className="mt-3 w-full">
        Log this entry
      </Button>
    </div>
  )
}
