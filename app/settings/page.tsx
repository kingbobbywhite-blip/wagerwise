"use client"

import * as React from "react"
import { toast } from "sonner"
import { Download, RotateCcw, TriangleAlert, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DEVIG_METHODS, type DevigMethod } from "@/lib/quant/odds"
import { payoutMultiple, supportedPickCounts } from "@/lib/quant/payouts"
import { exportState, importState } from "@/lib/store/local"
import { useStore } from "@/lib/store/provider"
import { DEFAULT_SETTINGS } from "@/lib/store/schema"
import { money, pct } from "@/lib/format"

export default function SettingsPage() {
  const { state, setSettings, replaceAll, saveError, ready } = useStore()
  const s = state.settings

  if (!ready) {
    return <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Loading…</p>
  }

  function exportJson() {
    const blob = new Blob([exportState(state)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `wagerwise-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function importJson(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      replaceAll(importState(await file.text()))
      toast.success("Data restored")
    } catch (err) {
      toast.error("Could not read that file", { description: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-mono text-lg font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
          Everything is stored in this browser only. Export regularly: clearing site data deletes your history.
        </p>
      </header>

      {saveError ? (
        <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          {saveError}
        </p>
      ) : null}

      <Tabs defaultValue="bankroll">
        <TabsList className="font-mono text-xs">
          <TabsTrigger value="bankroll">Bankroll</TabsTrigger>
          <TabsTrigger value="model">Model</TabsTrigger>
          <TabsTrigger value="payouts">Payouts</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
        </TabsList>

        <TabsContent value="bankroll" className="mt-4 space-y-4">
          <div className="grid gap-4 rounded-lg border border-border/60 bg-card/40 p-4 md:grid-cols-2">
            <NumberField
              label="Bankroll"
              value={s.bankroll.bankroll}
              onChange={(v) => setSettings((p) => ({ ...p, bankroll: { ...p.bankroll, bankroll: v } }))}
              hint="The total amount you are willing to lose. Stake sizing is a fraction of this, so getting it wrong scales every recommendation."
            />
            <NumberField
              label="Unit size"
              value={s.bankroll.unitSize}
              onChange={(v) => setSettings((p) => ({ ...p, bankroll: { ...p.bankroll, unitSize: v } }))}
              hint="Only used to express stakes in units. It does not affect the maths."
            />
            <SliderRow
              label="Kelly fraction"
              value={s.bankroll.kellyFraction}
              min={0.05}
              max={1}
              step={0.05}
              format={(v) => `${(v * 100).toFixed(0)}%`}
              onChange={(v) => setSettings((p) => ({ ...p, bankroll: { ...p.bankroll, kellyFraction: v } }))}
              hint="Full Kelly is growth-optimal only if your probabilities are exactly right. They are estimates, so a quarter Kelly is the sane default and full Kelly is close to reckless."
            />
            <SliderRow
              label="Max stake per entry"
              value={s.bankroll.maxStakePct}
              min={0.005}
              max={0.1}
              step={0.005}
              format={(v) => `${(v * 100).toFixed(1)}% · ${money(v * s.bankroll.bankroll)}`}
              onChange={(v) => setSettings((p) => ({ ...p, bankroll: { ...p.bankroll, maxStakePct: v } }))}
              hint="A hard ceiling that overrides Kelly. Protects you from a single mispriced projection."
            />
          </div>
        </TabsContent>

        <TabsContent value="model" className="mt-4 space-y-4">
          <div className="grid gap-4 rounded-lg border border-border/60 bg-card/40 p-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Vig removal method
              </Label>
              <Select
                value={s.projection.devigMethod}
                onValueChange={(v) =>
                  setSettings((p) => ({ ...p, projection: { ...p.projection, devigMethod: v as DevigMethod } }))
                }
              >
                <SelectTrigger className="mt-1.5 h-9 font-mono text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DEVIG_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {DEVIG_METHODS.find((m) => m.value === s.projection.devigMethod)?.blurb}
              </p>
            </div>

            <SliderRow
              label="Weight on market prices"
              value={s.projection.weights.market}
              min={0}
              max={1}
              step={0.02}
              format={(v) => v.toFixed(2)}
              onChange={(v) =>
                setSettings((p) => ({ ...p, projection: { ...p.projection, weights: { ...p.projection.weights, market: v } } }))
              }
              hint="A devigged two-way sportsbook price is the strongest free projection available. Lowering this below your own model's weight is a strong claim about your model."
            />
            <SliderRow
              label="Weight on your projections"
              value={s.projection.weights.projection}
              min={0}
              max={1}
              step={0.02}
              format={(v) => v.toFixed(2)}
              onChange={(v) =>
                setSettings((p) => ({ ...p, projection: { ...p.projection, weights: { ...p.projection.weights, projection: v } } }))
              }
              hint="How much to trust an explicit projection column in your import."
            />
            <SliderRow
              label="Weight on recent form"
              value={s.projection.weights.form}
              min={0}
              max={1}
              step={0.02}
              format={(v) => v.toFixed(2)}
              onChange={(v) =>
                setSettings((p) => ({ ...p, projection: { ...p.projection, weights: { ...p.projection.weights, form: v } } }))
              }
              hint="Season, last ten and last five averages. Noisy on its own, and already partly priced into the market number."
            />
            <SliderRow
              label="Outcome spread"
              value={s.projection.dispersion.global ?? 1}
              min={0.7}
              max={1.8}
              step={0.05}
              format={(v) => `${v.toFixed(2)}x`}
              onChange={(v) =>
                setSettings((p) => ({ ...p, projection: { ...p.projection, dispersion: { ...p.projection.dispersion, global: v } } }))
              }
              hint="Scales how volatile every stat is assumed to be. Raise it if the tracker says the model is overconfident: wider outcomes pull every probability toward 50%."
            />
            <SliderRow
              label="Correlation strength"
              value={s.correlation.strength}
              min={0}
              max={1.5}
              step={0.05}
              format={(v) => `${v.toFixed(2)}x`}
              onChange={(v) => setSettings((p) => ({ ...p, correlation: { ...p.correlation, strength: v } }))}
              hint="Scales every correlation between legs. Zero reproduces the naive assumption that legs are independent, which is what most tools do and is wrong."
            />
            <SliderRow
              label="Hit-rate prior"
              value={s.projection.hitRatePrior}
              min={5}
              max={100}
              step={5}
              format={(v) => `${v} games`}
              onChange={(v) => setSettings((p) => ({ ...p, projection: { ...p.projection, hitRatePrior: v } }))}
              hint="How much a small hit-rate sample gets shrunk toward the model. At 30, a 10-game sample carries a quarter of the weight."
            />
          </div>
        </TabsContent>

        <TabsContent value="payouts" className="mt-4 space-y-4">
          <p className="flex items-start gap-2 rounded-lg border border-accent/40 bg-accent/10 p-3 text-xs leading-relaxed text-accent">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              These multipliers ship as defaults and are not verified against any live app. Operators change them by
              state, by promotion and by sport, and boosted picks override them entirely. Every expected-value number in
              this app is only as correct as the table below, so check the real payout in the app before you stake
              anything.
            </span>
          </p>
          <div className="space-y-3">
            {s.apps.map((a) => (
              <div key={a.id} className="rounded-lg border border-border/60 bg-card/40 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-mono text-sm font-semibold">{a.name}</h3>
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {a.kind} · payouts {a.verifiedOn}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{a.notes}</p>
                {a.modes.filter((m) => Object.keys(m.table).length > 0).map((m) => (
                  <div key={m.id} className="mt-2">
                    <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{m.label}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {supportedPickCounts(m).map((n) => (
                        <span key={n} className="rounded border border-border/60 px-1.5 py-0.5 font-mono text-[11px] tabular-nums">
                          {n}: {payoutMultiple(m, n, n)}x
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="data" className="mt-4 space-y-4">
          <div className="space-y-3 rounded-lg border border-border/60 bg-card/40 p-4">
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={exportJson}>
                <Download className="mr-1 size-3.5" /> Export everything
              </Button>
              <Button variant="secondary" size="sm" asChild>
                <label className="cursor-pointer">
                  <Upload className="mr-1 size-3.5" /> Restore from file
                  <input type="file" accept=".json" className="hidden" onChange={importJson} />
                </label>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSettings(() => DEFAULT_SETTINGS)
                  toast.success("Settings reset. Your slate and tracker are untouched.")
                }}
              >
                <RotateCcw className="mr-1 size-3.5" /> Reset settings
              </Button>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Holding {state.slips.length} logged entries and {state.slate?.rows.length ?? 0} slate lines. Export writes
              a single JSON file containing your settings, current slate and full betting history.
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function NumberField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  hint: string
}) {
  return (
    <div>
      <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</Label>
      <Input
        type="number"
        value={value}
        min={0}
        onChange={(e) => {
          const n = Number.parseFloat(e.target.value)
          if (Number.isFinite(n) && n >= 0) onChange(n)
        }}
        className="mt-1.5 font-mono text-xs tabular-nums"
      />
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
    </div>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  hint,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
  hint: string
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</Label>
        <span className="font-mono text-xs tabular-nums">{format(value)}</span>
      </div>
      <Slider className="mt-2.5" value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} />
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
    </div>
  )
}
