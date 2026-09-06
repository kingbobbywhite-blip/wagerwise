"use client"

import * as React from "react"
import { Loader2, RefreshCw } from "lucide-react"
import { EmptyState } from "@/components/empty-state"
import { SlipCard } from "@/components/slip-card"
import { StatTile } from "@/components/stat-tile"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { OBJECTIVES, optimizeSlips, type BuiltSlip, type Objective } from "@/lib/quant/optimizer"
import { breakEvenLegProb, findApp, findMode, supportedPickCounts } from "@/lib/quant/payouts"
import { useDerivedSlate } from "@/lib/store/hooks"
import { useStore } from "@/lib/store/provider"
import { pct } from "@/lib/format"

export default function BuildPage() {
  const { state, setSettings, ready } = useStore()
  const { candidates } = useDerivedSlate()
  const [slips, setSlips] = React.useState<BuiltSlip[] | null>(null)
  const [running, setRunning] = React.useState(false)
  const [objective, setObjective] = React.useState<Objective>("ev")

  const app = findApp(state.settings.apps, state.settings.defaultAppId)
  const mode = findMode(app, state.settings.defaultModeId)
  const c = state.settings.constraints

  const pickOptions = React.useMemo(() => (mode ? supportedPickCounts(mode) : []), [mode])
  const breakEven = mode ? breakEvenLegProb(mode, c.picks) : null

  const eligible = React.useMemo(
    () => candidates.filter((l) => l.pWin >= c.minLegProb && l.confidence >= c.minConfidence),
    [candidates, c.minLegProb, c.minConfidence],
  )

  const run = React.useCallback(() => {
    if (!mode) return
    setRunning(true)
    // Yield a frame so the spinner paints before the search blocks the thread.
    setTimeout(() => {
      try {
        setSlips(
          optimizeSlips(candidates, {
            mode,
            constraints: c,
            correlation: state.settings.correlation,
            objectives: [objective],
            count: 5,
          }),
        )
      } finally {
        setRunning(false)
      }
    }, 16)
  }, [candidates, mode, c, state.settings.correlation, objective])

  React.useEffect(() => {
    setSlips(null)
  }, [candidates, objective, c.picks, state.settings.defaultAppId, state.settings.defaultModeId])

  if (!ready) {
    return <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Loading…</p>
  }

  if (candidates.length === 0) {
    return (
      <EmptyState
        title="Nothing to build from"
        body="The optimizer needs a priced slate. Import today's lines first, ideally with sportsbook prices attached so the projections have something solid underneath them."
        actionLabel="Import a slate"
        actionHref="/import"
      />
    )
  }

  function update(patch: Partial<typeof c>) {
    setSettings((s) => ({ ...s, constraints: { ...s.constraints, ...patch } }))
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-mono text-lg font-semibold tracking-tight">Build entries</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
          Searches for the entry that maximises your chosen objective under the app's real payout table, scoring every
          candidate with a correlation-aware simulation rather than multiplying leg probabilities together.
        </p>
      </header>

      <div className="grid gap-3 md:grid-cols-4">
        <StatTile label="Legs available" value={String(candidates.length)} hint="One per player-market, on the side the model prefers." />
        <StatTile
          label="Passing filters"
          value={String(eligible.length)}
          tone={eligible.length >= c.picks ? "good" : "bad"}
          hint={`Above ${pct(c.minLegProb, 0)} win probability and ${c.minConfidence} confidence.`}
        />
        <StatTile
          label="Break-even per leg"
          value={breakEven ? pct(breakEven) : "—"}
          tone="warn"
          hint={`What a ${c.picks}-pick ${mode?.label ?? ""} entry needs from every leg just to break even.`}
        />
        <StatTile
          label="Clearing that bar"
          value={String(eligible.filter((l) => breakEven != null && l.pWin >= breakEven).length)}
          hint="Legs the model rates above the break-even rate. Correlation can still rescue a slip below it."
        />
      </div>

      <div className="grid gap-4 rounded-lg border border-border/60 bg-card/40 p-4 md:grid-cols-3">
        <Field label="App">
          <Select
            value={state.settings.defaultAppId}
            onValueChange={(v) => {
              const nextApp = findApp(state.settings.apps, v)
              setSettings((s) => ({ ...s, defaultAppId: v, defaultModeId: nextApp?.modes[0]?.id ?? s.defaultModeId }))
            }}
          >
            <SelectTrigger className="h-9 font-mono text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {state.settings.apps.filter((a) => a.kind === "dfs").map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Entry type">
          <Select value={state.settings.defaultModeId} onValueChange={(v) => setSettings((s) => ({ ...s, defaultModeId: v }))}>
            <SelectTrigger className="h-9 font-mono text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {app?.modes.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Picks">
          <Select value={String(c.picks)} onValueChange={(v) => update({ picks: Number(v) })}>
            <SelectTrigger className="h-9 font-mono text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {pickOptions.map((n) => <SelectItem key={n} value={String(n)}>{n}-pick</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Objective" className="md:col-span-3">
          <Select value={objective} onValueChange={(v) => setObjective(v as Objective)}>
            <SelectTrigger className="h-9 font-mono text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {OBJECTIVES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {OBJECTIVES.find((o) => o.value === objective)?.blurb}
          </p>
        </Field>

        <SliderField
          label="Minimum leg probability"
          value={c.minLegProb}
          min={0.4}
          max={0.8}
          step={0.01}
          format={(v) => pct(v, 0)}
          onChange={(v) => update({ minLegProb: v })}
        />
        <SliderField
          label="Minimum confidence"
          value={c.minConfidence}
          min={0}
          max={90}
          step={5}
          format={(v) => String(v)}
          onChange={(v) => update({ minConfidence: v })}
        />
        <SliderField
          label="Max legs per game"
          value={c.maxPerGame}
          min={1}
          max={6}
          step={1}
          format={(v) => String(v)}
          onChange={(v) => update({ maxPerGame: v })}
        />

        <div className="flex items-center justify-between gap-3 md:col-span-3">
          <div>
            <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Allow same-player stacks
            </Label>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              Two legs on one player are strongly correlated. That raises the chance they both land, and equally the
              chance they both miss. Useful on all-or-nothing entries, punishing on flex.
            </p>
          </div>
          <Switch
            checked={c.maxPerPlayer > 1}
            onCheckedChange={(v) => update({ maxPerPlayer: v ? 2 : 1 })}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={run} disabled={running || eligible.length < c.picks}>
          {running ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <RefreshCw className="mr-1 size-3.5" />}
          {slips ? "Rebuild" : "Find entries"}
        </Button>
        {eligible.length < c.picks ? (
          <span className="text-xs text-muted-foreground">
            Only {eligible.length} legs pass the filters, which is fewer than the {c.picks} needed. Loosen the minimum
            probability or import more lines.
          </span>
        ) : null}
      </div>

      {slips ? (
        slips.length === 0 ? (
          <EmptyState
            title="No entry met the constraints"
            body="Every combination was either blocked by the per-game and per-player caps or exceeded the correlation ceiling. Raising the legs-per-game limit or lowering the minimum probability usually opens it up."
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {slips.map((s) => (
              <SlipCard key={s.id} slip={s} appId={state.settings.defaultAppId} modeId={state.settings.defaultModeId} />
            ))}
          </div>
        )
      ) : null}
    </div>
  )
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</Label>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</Label>
        <span className="font-mono text-xs tabular-nums">{format(value)}</span>
      </div>
      <Slider
        className="mt-2.5"
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
      />
    </div>
  )
}
