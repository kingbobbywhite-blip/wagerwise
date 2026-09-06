"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowUpDown, Info, TriangleAlert } from "lucide-react"
import { EmptyState } from "@/components/empty-state"
import { ProbBar } from "@/components/prob-bar"
import { SideBadge } from "@/components/side-badge"
import { StatTile } from "@/components/stat-tile"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { MARKETS } from "@/lib/nba/markets"
import { formatAmerican } from "@/lib/quant/odds"
import { breakEvenLegProb, findApp, findMode } from "@/lib/quant/payouts"
import { useDerivedSlate } from "@/lib/store/hooks"
import { useStore } from "@/lib/store/provider"
import { pct, shortDate, signedNumber } from "@/lib/format"
import { cn } from "@/lib/utils"

type SortKey = "prob" | "edge" | "shop" | "confidence" | "player"

export default function BoardPage() {
  const { state, ready } = useStore()
  const { rows, unpriceable } = useDerivedSlate()

  const [query, setQuery] = React.useState("")
  const [market, setMarket] = React.useState("ALL")
  const [app, setApp] = React.useState("ALL")
  const [sort, setSort] = React.useState<SortKey>("prob")

  const apps = React.useMemo(() => {
    const s = new Set<string>()
    for (const r of rows) for (const o of r.offers) if (o.app) s.add(o.app)
    return Array.from(s).sort()
  }, [rows])

  const breakEven = React.useMemo(() => {
    const a = findApp(state.settings.apps, state.settings.defaultAppId)
    const m = findMode(a, state.settings.defaultModeId)
    if (!m) return null
    return breakEvenLegProb(m, state.settings.constraints.picks)
  }, [state.settings])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = rows.filter((r) => {
      if (q && !r.player.toLowerCase().includes(q) && !r.marketLabel.toLowerCase().includes(q)) return false
      if (market !== "ALL" && r.marketKey !== market) return false
      if (app !== "ALL" && !r.offers.some((o) => o.app === app)) return false
      return true
    })
    const by: Record<SortKey, (a: typeof out[number], b: typeof out[number]) => number> = {
      prob: (a, b) => (b.recommended?.pWin ?? 0) - (a.recommended?.pWin ?? 0),
      edge: (a, b) => Math.abs(b.recommended?.lineEdgeZ ?? 0) - Math.abs(a.recommended?.lineEdgeZ ?? 0),
      shop: (a, b) => b.shoppingGainPct - a.shoppingGainPct,
      confidence: (a, b) => b.confidence - a.confidence,
      player: (a, b) => a.player.localeCompare(b.player),
    }
    return [...out].sort(by[sort])
  }, [rows, query, market, app, sort])

  const clearing = React.useMemo(
    () => (breakEven == null ? 0 : rows.filter((r) => (r.recommended?.pWin ?? 0) >= breakEven).length),
    [rows, breakEven],
  )
  const shoppable = React.useMemo(() => rows.filter((r) => r.shoppingGainPct >= 2).length, [rows])

  if (!ready) {
    return <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Loading local data…</p>
  }

  if (!state.slate || rows.length === 0) {
    return (
      <EmptyState
        title="No slate loaded"
        body="Import today's NBA lines to price them. The board devigs any sportsbook prices you supply, turns them into a projection, then re-evaluates that projection against whatever number your DFS app is actually offering."
        actionLabel="Import a slate"
        actionHref="/import"
      />
    )
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-mono text-lg font-semibold tracking-tight">Board</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {state.slate.label} · imported {shortDate(state.slate.importedAt)} · {rows.length} player-markets from{" "}
              {state.slate.rows.length} posted lines
            </p>
          </div>
          <Button asChild size="sm" variant="secondary">
            <Link href="/build">Build entries</Link>
          </Button>
        </header>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile
            label="Clearing break-even"
            value={`${clearing}/${rows.length}`}
            tone={clearing > 0 ? "good" : "neutral"}
            hint={
              breakEven == null
                ? "Set a default app and entry size in settings."
                : `A ${state.settings.constraints.picks}-pick entry needs ${pct(breakEven)} per leg just to break even.`
            }
          />
          <StatTile
            label="Line shopping"
            value={String(shoppable)}
            tone={shoppable > 0 ? "warn" : "neutral"}
            hint="Player-markets where one app posts a number worth 2 or more probability points over another."
          />
          <StatTile
            label="Median confidence"
            value={String(median(rows.map((r) => r.confidence)))}
            hint="How much evidence sits behind the projections. Market prices score highest, season averages lowest."
          />
          <StatTile
            label="Unpriceable rows"
            value={String(unpriceable)}
            tone={unpriceable > 0 ? "warn" : "neutral"}
            hint="Imported lines with no odds, projection or form data. They are dropped rather than guessed at."
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter player or market…"
            className="h-9 w-full max-w-56 font-mono text-xs"
          />
          <Select value={market} onValueChange={setMarket}>
            <SelectTrigger className="h-9 w-40 font-mono text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All markets</SelectItem>
              {Object.values(MARKETS).map((m) => (
                <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {apps.length > 1 ? (
            <Select value={app} onValueChange={setApp}>
              <SelectTrigger className="h-9 w-36 font-mono text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All apps</SelectItem>
                {apps.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : null}
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="h-9 w-44 font-mono text-xs">
              <ArrowUpDown className="mr-1 size-3" /><SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="prob">Win probability</SelectItem>
              <SelectItem value="edge">Line edge</SelectItem>
              <SelectItem value="shop">Shopping gain</SelectItem>
              <SelectItem value="confidence">Confidence</SelectItem>
              <SelectItem value="player">Player</SelectItem>
            </SelectContent>
          </Select>
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">{filtered.length} shown</span>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border/60">
          <table className="w-full min-w-[880px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-card/40 text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <th className="px-3 py-2">Player</th>
                <th className="px-3 py-2">Market</th>
                <th className="px-3 py-2 text-right">Best line</th>
                <th className="px-3 py-2">Side</th>
                <th className="px-3 py-2 text-right">Projection</th>
                <th className="px-3 py-2 text-right">Edge</th>
                <th className="px-3 py-2 text-right">Win prob</th>
                <th className="px-3 py-2 text-right">Fair</th>
                <th className="px-3 py-2 text-right">Conf</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const rec = r.recommended
                if (!rec) return null
                const clears = breakEven != null && rec.pWin >= breakEven
                return (
                  <tr key={r.key} className="border-b border-border/40 last:border-0 hover:bg-card/40">
                    <td className="px-3 py-2">
                      <div className="font-medium leading-tight">{r.player}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {r.team ?? "—"}{r.opponent ? ` vs ${r.opponent}` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs">{r.marketLabel}</span>
                      {r.warnings.length > 0 ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <TriangleAlert className="ml-1 inline size-3 text-accent" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-xs">{r.warnings.join(" ")}</TooltipContent>
                        </Tooltip>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="font-mono tabular-nums">{rec.offer.line}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {rec.offer.app ?? "—"}
                        {r.lineSpread > 0 ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="outline" className="ml-1 h-4 px-1 py-0 font-mono text-[9px] text-accent">
                                +{r.shoppingGainPct.toFixed(1)}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs text-xs">
                              {r.offers.map((o) => `${o.app ?? "?"} ${o.line}`).join(" · ")}. Taking the best number is
                              worth {r.shoppingGainPct.toFixed(1)} probability points on this side.
                            </TooltipContent>
                          </Tooltip>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2"><SideBadge side={rec.side} /></td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {r.mean.toFixed(1)}
                      <span className="ml-1 text-[10px] text-muted-foreground">±{r.sd.toFixed(1)}</span>
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right font-mono tabular-nums",
                        Math.abs(rec.lineEdgeZ) >= 0.25 ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      {signedNumber(rec.lineEdge, 1)}
                      <span className="ml-1 text-[10px] opacity-70">{signedNumber(rec.lineEdgeZ, 2)}σ</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className={cn("font-mono tabular-nums", clears ? "text-primary" : "")}>{pct(rec.pWin)}</div>
                      <ProbBar value={rec.pWin} breakEven={breakEven ?? undefined} className="mt-1 w-16 justify-self-end" />
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                      {formatAmerican(rec.fairAmerican)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">{r.confidence}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-3 shrink-0" />
          <span>
            Win probability is the model's own number, not the app's. The vertical marker on each bar is the per-leg rate
            you need just to break even on a {state.settings.constraints.picks}-pick entry. A leg above 50% is not
            automatically a bet.
          </span>
        </p>
      </div>
    </TooltipProvider>
  )
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return Math.round(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2)
}
