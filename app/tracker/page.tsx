"use client"

import * as React from "react"
import { Trash2 } from "lucide-react"
import { EmptyState } from "@/components/empty-state"
import { SideBadge } from "@/components/side-badge"
import { StatTile } from "@/components/stat-tile"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { brierScore, calibrationBias, calibrationBuckets, logLoss, summarise, type Observation } from "@/lib/quant/calibration"
import { dfsPayout } from "@/lib/quant/evaluate"
import { breakEvenLegProb, capturedToMode, findApp, findMode } from "@/lib/quant/payouts"
import { useStore } from "@/lib/store/provider"
import type { LegResult, TrackedSlip } from "@/lib/store/schema"
import { money, multiple, pct, shortDate, signedPct } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Legs needed before the headline calibration number is worth reacting to. */
const CALIBRATION_MIN = 100

export default function TrackerPage() {
  const { state, updateSlip, removeSlip, ready } = useStore()
  const slips = state.slips

  const perf = React.useMemo(() => summarise(slips), [slips])

  const observations = React.useMemo<Observation[]>(
    () =>
      slips
        .flatMap((s) => s.legs)
        .filter((l) => l.result === "WIN" || l.result === "LOSS")
        .map((l) => ({ p: l.pWinAtEntry, win: l.result === "WIN" })),
    [slips],
  )

  const buckets = React.useMemo(() => calibrationBuckets(observations), [observations])
  const bias = calibrationBias(observations)
  const brier = brierScore(observations)
  const ll = logLoss(observations)

  if (!ready) {
    return <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Loading…</p>
  }

  if (slips.length === 0) {
    return (
      <EmptyState
        title="Nothing logged yet"
        body="Log entries from the build screen, then settle each leg here once the games finish. Results are the only thing that can tell you whether the model is honest, and it takes a few hundred legs before the answer means much."
        actionLabel="Build entries"
        actionHref="/build"
      />
    )
  }

  function settleLeg(slip: TrackedSlip, index: number, result: LegResult) {
    updateSlip(slip.id, (s) => {
      const legs = s.legs.map((l, i) => (i === index ? { ...l, result } : l))
      const settledAll = legs.every((l) => l.result !== "PENDING")
      if (!settledAll) return { ...s, legs, status: "PENDING", actualMultiple: null, settledAt: null }

      // Settle against the payout captured when the entry was built, not the
      // stored table, which may have changed since.
      const wins = legs.filter((l) => l.result === "WIN").length
      const pushes = legs.filter((l) => l.result === "PUSH").length
      // Settlement is deterministic here, so the per-leg outcome vector is
      // built from the recorded results rather than simulated.
      const outcomes = Int8Array.from(legs.map((l) => (l.result === "WIN" ? 1 : l.result === "PUSH" ? 0 : -1)))
      const actualMultiple = s.capturedPayout
        ? dfsPayout(capturedToMode(s.capturedPayout))(wins, pushes, legs.length, outcomes)
        : 0
      return { ...s, legs, status: "SETTLED", actualMultiple, settledAt: new Date().toISOString() }
    })
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-mono text-lg font-semibold tracking-tight">Tracker</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
          Settle each leg and the entry prices itself against the payout table you used. Calibration compares what the
          model predicted against what happened, which is the only honest test of whether it works.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Settled" value={`${perf.settled}/${perf.entries}`} hint={`${perf.wins} returned a profit, ${perf.losses} did not.`} />
        <StatTile
          label="Profit"
          value={money(perf.profit)}
          tone={perf.profit > 0 ? "good" : perf.profit < 0 ? "bad" : "neutral"}
          hint={`${money(perf.staked)} staked, ${money(perf.returned)} returned.`}
        />
        <StatTile
          label="Return on stake"
          value={perf.roi == null ? "—" : signedPct(perf.roi)}
          tone={perf.roi != null && perf.roi > 0 ? "good" : perf.roi != null && perf.roi < 0 ? "bad" : "neutral"}
          hint={perf.expectedRoi == null ? "Settle an entry to compare." : `The model expected ${signedPct(perf.expectedRoi)}.`}
        />
        <StatTile
          label="Calibration bias"
          value={bias == null ? "—" : signedPct(bias)}
          /* Only call the bias good or bad once there is enough data to mean
             anything. Flagging a 4-leg sample in red would be exactly the
             mistake the calibration table below warns against. */
          tone={bias == null || observations.length < CALIBRATION_MIN ? "neutral" : Math.abs(bias) > 0.05 ? "bad" : "good"}
          hint={
            bias == null
              ? "Settle some legs first."
              : observations.length < CALIBRATION_MIN
                ? `Too few legs to read yet. ${observations.length} of roughly ${CALIBRATION_MIN} before this number means anything.`
                : bias > 0
                  ? "The model is claiming more than it delivers. Widen the outcome spread in settings."
                  : "The model is understating its legs."
          }
        />
      </div>

      {observations.length > 0 ? (
        <section className="rounded-lg border border-border/60 bg-card/40 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">Calibration</h2>
            <span className="font-mono text-[11px] text-muted-foreground">
              {observations.length} settled legs
              {brier != null ? ` · Brier ${brier.toFixed(3)}` : ""}
              {ll != null ? ` · log loss ${ll.toFixed(3)}` : ""}
            </span>
          </div>
          <table className="mt-3 w-full text-xs">
            <thead>
              <tr className="text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <th className="pb-1">Predicted band</th>
                <th className="pb-1 text-right">Legs</th>
                <th className="pb-1 text-right">Model said</th>
                <th className="pb-1 text-right">Actual</th>
                <th className="pb-1 text-right">Gap</th>
              </tr>
            </thead>
            <tbody>
              {buckets.filter((b) => b.count > 0).map((b) => {
                const gap = b.actual - b.predicted
                const meaningful = Math.abs(gap) > 2 * b.stderr && b.count >= 20
                return (
                  <tr key={`${b.lo}-${b.hi}`} className="border-t border-border/40">
                    <td className="py-1.5 font-mono tabular-nums">
                      {pct(b.lo, 0)}–{pct(Math.min(b.hi, 1), 0)}
                    </td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-muted-foreground">{b.count}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">{pct(b.predicted)}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">{pct(b.actual)}</td>
                    <td
                      className={cn(
                        "py-1.5 text-right font-mono tabular-nums",
                        meaningful ? (gap < 0 ? "text-destructive" : "text-primary") : "text-muted-foreground",
                      )}
                    >
                      {signedPct(gap)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            A gap is only highlighted once it exceeds two standard errors on at least twenty legs. Below that it is
            noise, and reacting to it will make the model worse rather than better.
          </p>
        </section>
      ) : null}

      <div className="space-y-3">
        {slips.map((s) => {
          const app = findApp(state.settings.apps, s.appId)
          const mode = findMode(app, s.modeId)
          const wins = s.legs.filter((l) => l.result === "WIN").length
          const be = s.capturedPayout ? breakEvenLegProb(capturedToMode(s.capturedPayout), s.legs.length) : null
          return (
            <div key={s.id} className="rounded-lg border border-border/60 bg-card/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono text-xs font-semibold">
                    {app?.name ?? s.appId} · {mode?.label ?? s.modeId} · {s.legs.length}-pick
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {shortDate(s.createdAt)} · {money(s.stake)} · model said {pct(s.pAllHitAtEntry)} to sweep,{" "}
                    {signedPct(s.evAtEntry)} EV
                    {be != null ? ` · break-even ${pct(be)}` : ""}
                  </div>
                  {s.capturedPayout ? (
                    <div className="font-mono text-[10px] text-muted-foreground">
                      payout captured:{" "}
                      {Object.entries(s.capturedPayout.tiers)
                        .sort((a, b) => Number(b[0]) - Number(a[0]))
                        .map(([k, v]) => `${k}/${s.capturedPayout.picks} ${v}x`)
                        .join(" · ")}
                      {s.capturedPayout.confirmed ? "" : " (unconfirmed)"}
                    </div>
                  ) : (
                    <div className="font-mono text-[10px] text-accent">
                      No payout captured for this entry, so it was settled at zero. Entries logged before payout capture
                      existed cannot be scored.
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {s.status === "SETTLED" ? (
                    <Badge
                      variant="outline"
                      className={cn(
                        "font-mono text-[11px]",
                        (s.actualMultiple ?? 0) > 1 ? "border-primary/40 text-primary" : "border-destructive/40 text-destructive",
                      )}
                    >
                      {wins}/{s.legs.length} · {multiple(s.actualMultiple ?? 0)} ·{" "}
                      {money(s.stake * ((s.actualMultiple ?? 0) - 1))}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="font-mono text-[11px] text-muted-foreground">
                      {wins}/{s.legs.length} settled
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-destructive"
                    onClick={() => removeSlip(s.id)}
                    aria-label="Delete entry"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>

              <ul className="mt-2 divide-y divide-border/40">
                {s.legs.map((l, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                    <div className="min-w-0 flex-1">
                      <span className="text-sm">{l.player}</span>
                      <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                        {l.marketLabel} {l.line} · model {pct(l.pWinAtEntry, 0)}
                      </span>
                    </div>
                    <SideBadge side={l.side} />
                    <Select value={l.result} onValueChange={(v) => settleLeg(s, i, v as LegResult)}>
                      <SelectTrigger className="h-7 w-28 font-mono text-[11px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PENDING">Pending</SelectItem>
                        <SelectItem value="WIN">Win</SelectItem>
                        <SelectItem value="LOSS">Loss</SelectItem>
                        <SelectItem value="PUSH">Push</SelectItem>
                      </SelectContent>
                    </Select>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}
