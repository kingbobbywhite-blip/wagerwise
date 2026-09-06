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
import { Switch } from "@/components/ui/switch"
import { BOOK_PROFILES, RETAIL_WEIGHT_CAP } from "@/lib/quant/books"
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
          <TabsTrigger value="feed">Odds feed</TabsTrigger>
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
              {s.projection.devigMethod === "multiplicative" ? (
                <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-accent">
                  <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                  Proportional devigging overstates longshot probability, which on a prop board means it overstates
                  exactly the sides furthest from the number. Power is the better default.
                </p>
              ) : null}
            </div>

            <div className="md:col-span-2 flex items-start justify-between gap-3 rounded-lg border border-border/50 p-3">
              <div>
                <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Require a market-making book
                </Label>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  When on, a prop priced only by retail books is treated as unpriced. Retail books follow the sharp
                  market rather than setting it, so their number carries much less information. Strict, and correct if
                  you are betting seriously.
                </p>
              </div>
              <Switch
                checked={s.projection.requireSharpBook}
                onCheckedChange={(v) =>
                  setSettings((p) => ({ ...p, projection: { ...p.projection, requireSharpBook: v } }))
                }
              />
            </div>

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
              label="Stale after"
              value={s.projection.staleQuoteMinutes}
              min={10}
              max={180}
              step={5}
              format={(v) => `${v} min`}
              onChange={(v) => setSettings((p) => ({ ...p, projection: { ...p.projection, staleQuoteMinutes: v } }))}
              hint="Quotes older than this are flagged. Lines move on injury news, so a price from before the inactives were posted is worse than no price."
            />
            <SliderRow
              label="Discard after"
              value={s.projection.maxQuoteAgeMinutes}
              min={30}
              max={720}
              step={30}
              format={(v) => `${(v / 60).toFixed(1)} h`}
              onChange={(v) => setSettings((p) => ({ ...p, projection: { ...p.projection, maxQuoteAgeMinutes: v } }))}
              hint="Quotes older than this are thrown out entirely and the prop reverts to unpriced."
            />
          </div>

          <div className="rounded-lg border border-border/60 bg-card/40 p-4">
            <h3 className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">Book weighting</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Not every price carries the same information. A handful of books make the market; the rest copy them.
              Weighting them equally throws away the point of using market data, and because retail books copy the same
              source, five of them is one opinion counted five times rather than five opinions.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[420px] text-xs">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    <th className="pb-1">Book</th>
                    <th className="pb-1">Tier</th>
                    <th className="pb-1 text-right">Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {BOOK_PROFILES.map((b) => (
                    <tr key={b.id} className="border-t border-border/40">
                      <td className="py-1.5">{b.name}</td>
                      <td className="py-1.5 font-mono text-[11px] text-muted-foreground">{b.tier}</td>
                      <td className="py-1.5 text-right font-mono tabular-nums">{b.weight.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              The combined retail weight is capped at {RETAIL_WEIGHT_CAP.toFixed(2)} regardless of how many retail books
              are present.
            </p>
          </div>
        </TabsContent>

        <TabsContent value="feed" className="mt-4 space-y-4">
          <div className="space-y-4 rounded-lg border border-border/60 bg-card/40 p-4">
            <div>
              <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Odds API key
              </Label>
              <Input
                type="password"
                value={s.oddsFeed.apiKey}
                onChange={(e) => setSettings((p) => ({ ...p, oddsFeed: { ...p.oddsFeed, apiKey: e.target.value } }))}
                placeholder="the-odds-api.com key"
                className="mt-1.5 font-mono text-xs"
              />
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Stored in this browser and sent only to the odds feed, through this app's own server so it never appears
                in page JavaScript. You can also set ODDS_API_KEY in the environment instead, which takes precedence.
              </p>
            </div>

            <div>
              <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Books to request
              </Label>
              <Input
                value={s.oddsFeed.books.join(", ")}
                onChange={(e) =>
                  setSettings((p) => ({
                    ...p,
                    oddsFeed: { ...p.oddsFeed, books: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) },
                  }))
                }
                className="mt-1.5 font-mono text-xs"
              />
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Put Pinnacle first. Player props are billed per market per event, so a narrow book list and a short
                market list is the difference between a usable quota and an exhausted one.
              </p>
            </div>

            <div>
              <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Regions</Label>
              <Input
                value={s.oddsFeed.regions}
                onChange={(e) => setSettings((p) => ({ ...p, oddsFeed: { ...p.oddsFeed, regions: e.target.value } }))}
                className="mt-1.5 font-mono text-xs"
              />
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Pinnacle sits in the eu region, so leaving it out silently removes the most useful price on the board.
              </p>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="payouts" className="mt-4 space-y-4">
          <p className="flex items-start gap-2 rounded-lg border border-border/60 bg-card/40 p-3 text-xs leading-relaxed text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-accent" />
            <span>
              These tables no longer price anything. They only pre-fill the capture form on the build screen, where you
              read the multipliers off the app and confirm them before any expected value is computed. That is the only
              way to be sure the number being used is the number you will actually be paid, since operators change these
              by state, by promotion and by sport, and boosted picks override them outright.
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
