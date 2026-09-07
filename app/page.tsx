"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { CalendarDays, KeyRound, Loader2, RefreshCw, TriangleAlert } from "lucide-react"
import { SlipCard } from "@/components/slip-card"
import { StatTile } from "@/components/stat-tile"
import { ValueBetRow } from "@/components/value-bet-row"
import { SideBadge } from "@/components/side-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip"
import { DEFAULT_CORRELATION } from "@/lib/quant/correlation"
import { formatAmerican } from "@/lib/quant/odds"
import { breakEvenLegProb, capturedFromMode, findApp, findMode } from "@/lib/quant/payouts"
import type { FeedQuote } from "@/lib/quant/valuebets"
import { buildDailyPicks } from "@/lib/today/build"
import { useStore } from "@/lib/store/provider"
import { money, pct, shortDate, signedPct } from "@/lib/format"

export default function TodayPage() {
  const { state, setDaily, ready } = useStore()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [needsKey, setNeedsKey] = React.useState(false)

  const s = state.settings
  const hasKey = s.oddsFeed.apiKey.trim().length > 0

  // The bar a pick'em leg has to clear, used only to place the DFS targets.
  // It comes from the stored table, which is a guide, not a priced number.
  const dfsBreakEven = React.useMemo(() => {
    const app = findApp(s.apps, s.defaultAppId)
    const mode = findMode(app, s.defaultModeId)
    if (!mode) return 0.56
    return breakEvenLegProb(mode, s.constraints.picks) ?? 0.56
  }, [s.apps, s.defaultAppId, s.defaultModeId, s.constraints.picks])

  const picks = React.useMemo(() => {
    if (!state.daily || state.daily.quotes.length === 0) return null
    return buildDailyPicks(state.daily.quotes as FeedQuote[], {
      value: {
        projection: s.projection,
        minEdge: s.daily.minEdge,
        suspiciousEdge: 0.12,
        requireSharpReference: s.daily.requireSharpReference,
        maxAmerican: 400,
      },
      correlation: s.correlation ?? DEFAULT_CORRELATION,
      constraints: { ...s.constraints, picks: s.daily.parlayLegs },
      dfsBreakEven,
      parlayCount: 4,
    })
  }, [state.daily, s.projection, s.daily, s.correlation, s.constraints, dfsBreakEven])

  async function refresh() {
    setBusy(true)
    setError(null)
    setNeedsKey(false)
    try {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      const end = new Date(start)
      end.setDate(end.getDate() + 1)
      end.setHours(11, 0, 0, 0) // catch late tips that roll past midnight UTC

      const res = await fetch("/api/today", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiKey: s.oddsFeed.apiKey || undefined,
          from: start.toISOString(),
          to: end.toISOString(),
          markets: s.daily.markets,
          bookmakers: s.oddsFeed.books,
          regions: s.oddsFeed.regions,
          maxGames: s.daily.maxGames,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setNeedsKey(!!data.needsKey)
        setError(data.error ?? `Request failed (${res.status}).`)
        return
      }
      setDaily({
        fetchedAt: data.fetchedAt ?? new Date().toISOString(),
        quotes: data.quotes ?? [],
        events: data.events ?? [],
        requestsRemaining: data.requestsRemaining ?? null,
        creditsSpent: data.estimatedCredits ?? 0,
      })
      const n = (data.quotes ?? []).length
      toast.success(n > 0 ? `Pulled ${n} prices` : "No prices found for today")
      if (data.failures?.length) {
        toast.warning(`${data.failures.length} games could not be priced`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!ready) {
    return <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Loading…</p>
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-mono text-lg font-semibold tracking-tight">Today</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {state.daily
                ? `${state.daily.events.length} NBA games · pulled ${shortDate(state.daily.fetchedAt)}${
                    state.daily.requestsRemaining != null
                      ? ` · ${state.daily.requestsRemaining} feed requests left`
                      : ""
                  }`
                : "Pull today's NBA slate and price it."}
            </p>
          </div>
          <Button onClick={refresh} disabled={busy || !hasKey}>
            {busy ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <RefreshCw className="mr-1 size-3.5" />}
            {state.daily ? "Refresh" : "Get today's picks"}
          </Button>
        </header>

        {!hasKey ? (
          <div className="rounded-xl border border-accent/40 bg-accent/5 p-5">
            <div className="flex items-start gap-3">
              <KeyRound className="mt-0.5 size-4 shrink-0 text-accent" />
              <div>
                <h2 className="font-mono text-sm font-semibold">One thing to set up</h2>
                <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                  This app needs sportsbook prices. Without them there is nothing to compare a line against, and it
                  will refuse to guess rather than invent an edge for you.
                </p>
                <ol className="mt-3 max-w-2xl list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-muted-foreground">
                  <li>
                    Get a free key at{" "}
                    <a
                      href="https://the-odds-api.com"
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline underline-offset-2"
                    >
                      the-odds-api.com
                    </a>
                    . The free tier is 500 requests a month.
                  </li>
                  <li>
                    Paste it into <Link href="/settings" className="text-primary underline underline-offset-2">Settings → Odds feed</Link>,
                    or put <code className="font-mono">ODDS_API_KEY=…</code> in a <code className="font-mono">.env.local</code> file.
                  </li>
                  <li>Come back here and press the button.</li>
                </ol>
              </div>
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs leading-relaxed text-destructive">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {error}
              {needsKey ? (
                <>
                  {" "}
                  <Link href="/settings" className="underline underline-offset-2">Open settings</Link>.
                </>
              ) : null}
            </span>
          </p>
        ) : null}

        {picks ? (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatTile label="Games" value={String(picks.games.length)} hint={`${picks.stats.props} player props priced.`} />
              <StatTile
                label="Value bets"
                value={String(picks.valueBets.length)}
                tone={picks.valueBets.length > 0 ? "good" : "neutral"}
                hint="Offers priced better than the sharp consensus of the other books."
              />
              <StatTile
                label="Parlays"
                value={String(picks.parlays.length)}
                tone={picks.parlays.length > 0 ? "good" : "neutral"}
                hint="Built only from legs that are individually positive expected value."
              />
              <StatTile
                label="Books seen"
                value={String(picks.stats.booksSeen.length)}
                hint={picks.stats.booksSeen.join(", ")}
              />
            </div>

            {picks.parlays.length > 0 ? (
              <section className="space-y-3">
                <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  Best parlays today
                </h2>
                <div className="grid gap-4 lg:grid-cols-2">
                  {picks.parlays.map((p) => (
                    <SlipCard
                      key={p.id}
                      slip={p}
                      appId="sportsbook"
                      modeId="parlay"
                      capturedPayout={{
                        picks: p.legs.length,
                        tiers: { [p.legs.length]: p.evaluation.topMultiple },
                        confirmed: true,
                        capturedAt: new Date().toISOString(),
                      }}
                    />
                  ))}
                </div>
              </section>
            ) : (
              <section className="rounded-lg border border-dashed border-border/60 p-5 text-xs leading-relaxed text-muted-foreground">
                <span className="font-mono uppercase tracking-[0.14em]">No parlay worth playing</span>
                <p className="mt-2 max-w-2xl">
                  A parlay is only worth building from legs that are each positive expected value on their own. There
                  are {picks.valueBets.length} such legs on this slate, and{" "}
                  {picks.valueBets.length < s.daily.parlayLegs
                    ? `a ${s.daily.parlayLegs}-leg parlay needs at least that many.`
                    : "none of the combinations cleared the correlation and diversification limits."}{" "}
                  Betting them singly is the correct move.
                </p>
              </section>
            )}

            {picks.valueBets.length > 0 ? (
              <section className="space-y-3">
                <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  Best single bets
                </h2>
                <div className="overflow-x-auto rounded-lg border border-border/60">
                  <table className="w-full min-w-[820px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border/60 bg-card/40 text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        <th className="px-3 py-2">Player</th>
                        <th className="px-3 py-2">Market</th>
                        <th className="px-3 py-2">Book</th>
                        <th className="px-3 py-2">Side</th>
                        <th className="px-3 py-2 text-right">Line</th>
                        <th className="px-3 py-2 text-right">Price</th>
                        <th className="px-3 py-2 text-right">Fair</th>
                        <th className="px-3 py-2 text-right">Win prob</th>
                        <th className="px-3 py-2 text-right">Edge</th>
                        <th className="px-3 py-2 text-right">Stake</th>
                      </tr>
                    </thead>
                    <tbody>
                      {picks.valueBets.slice(0, 25).map((b) => (
                        <ValueBetRow key={b.id} bet={b} bankroll={s.bankroll} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            {picks.dfsTargets.length > 0 ? (
              <section className="space-y-3">
                <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  Pick'em targets
                </h2>
                <p className="max-w-3xl text-[11px] leading-relaxed text-muted-foreground">
                  Nothing here can see what PrizePicks or Underdog are offering, so instead these are the numbers to
                  look for. Open your app, find the player, and take the side only if their line is at or beyond the
                  number below. The bar is a {pct(dfsBreakEven)} per-leg hit rate, from your default{" "}
                  {s.constraints.picks}-pick entry.
                </p>
                <div className="overflow-x-auto rounded-lg border border-border/60">
                  <table className="w-full min-w-[760px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border/60 bg-card/40 text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        <th className="px-3 py-2">Player</th>
                        <th className="px-3 py-2">Market</th>
                        <th className="px-3 py-2 text-right">Projection</th>
                        <th className="px-3 py-2 text-right">Fair line</th>
                        <th className="px-3 py-2">Take OVER at</th>
                        <th className="px-3 py-2">Take UNDER at</th>
                        <th className="px-3 py-2 text-right">Conf</th>
                      </tr>
                    </thead>
                    <tbody>
                      {picks.dfsTargets.slice(0, 30).map((t) => (
                        <tr key={t.key} className="border-b border-border/40 last:border-0 hover:bg-card/40">
                          <td className="px-3 py-2">
                            <div className="font-medium leading-tight">{t.player}</div>
                            <div className="font-mono text-[10px] text-muted-foreground">
                              {t.gameId.replace("@", " at ")}
                            </div>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">{t.marketLabel}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {t.mean.toFixed(1)}
                            <span className="ml-1 text-[10px] text-muted-foreground">±{t.sd.toFixed(1)}</span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                            {t.fairLine}
                          </td>
                          <td className="px-3 py-2">
                            {t.overAt != null ? (
                              <span className="flex items-center gap-1.5">
                                <SideBadge side="OVER" />
                                <span className="font-mono tabular-nums">{t.overAt} or lower</span>
                                <span className="font-mono text-[10px] text-muted-foreground">
                                  {pct(t.overProb ?? 0, 0)}
                                </span>
                              </span>
                            ) : (
                              <span className="font-mono text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {t.underAt != null ? (
                              <span className="flex items-center gap-1.5">
                                <SideBadge side="UNDER" />
                                <span className="font-mono tabular-nums">{t.underAt} or higher</span>
                                <span className="font-mono text-[10px] text-muted-foreground">
                                  {pct(t.underProb ?? 0, 0)}
                                </span>
                              </span>
                            ) : (
                              <span className="font-mono text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                            {t.confidence}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            <section className="rounded-lg border border-border/60 bg-card/40 p-4">
              <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">Games</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {picks.games.map((g) => (
                  <Badge key={g.gameId} variant="outline" className="font-mono text-[11px]">
                    <CalendarDays className="mr-1 size-3" />
                    {g.awayTeam} at {g.homeTeam}
                    <span className="ml-1.5 text-muted-foreground">{g.propCount}</span>
                  </Badge>
                ))}
              </div>
            </section>
          </>
        ) : hasKey && !busy ? (
          <section className="rounded-xl border border-dashed border-border/70 bg-card/30 p-8 text-center">
            <p className="font-mono text-sm uppercase tracking-[0.14em] text-muted-foreground">
              {state.daily ? "No prices for today" : "Nothing pulled yet"}
            </p>
            <p className="mx-auto mt-3 max-w-lg text-xs leading-relaxed text-muted-foreground">
              {state.daily
                ? "The feed returned no player props in today's window. That usually means no NBA games today, or the books have not posted props yet, which is normal until a few hours before tip."
                : "Press the button above to pull today's slate. Player props are billed per market per game, so nothing is fetched until you ask."}
            </p>
          </section>
        ) : null}
      </div>
    </TooltipProvider>
  )
}
