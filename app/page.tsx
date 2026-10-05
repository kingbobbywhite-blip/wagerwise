"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import { CalendarDays, KeyRound, Loader2, RefreshCw, TriangleAlert } from "lucide-react"
import { SlipCard } from "@/components/slip-card"
import { StatTile } from "@/components/stat-tile"
import { ValueBetRow } from "@/components/value-bet-row"
import { DfsTargetRow } from "@/components/dfs-target-row"
import { SideBadge } from "@/components/side-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TooltipProvider } from "@/components/ui/tooltip"
import { DEFAULT_CORRELATION } from "@/lib/quant/correlation"
import { bookProfile, isSharp } from "@/lib/quant/books"
import { DEFAULT_APPS, breakEvenLegProb, findApp, findMode } from "@/lib/quant/payouts"
import type { FeedQuote } from "@/lib/quant/valuebets"
import { appAnswered, buildDailyPicks, buildPickemEntry, hasAppLines, hasStarted } from "@/lib/today/build"
import { dailyCacheFrom } from "@/lib/today/cache"
import { entryExpectation } from "@/lib/tracker/entries"
import { marketsForLeague } from "@/lib/odds-feed/theoddsapi"
import { PROPLINE_FREE_DAILY } from "@/lib/odds-feed/propline"
import { NO_SERVER_KEYS, hasFeedKey, parseServerKeys, type ServerKeys } from "@/lib/odds-feed/keys"
import { useStore } from "@/lib/store/provider"
import { LEAGUES, LEAGUE_IDS, creditWarning, inSeason, leagueFor, type LeagueId } from "@/lib/leagues"
import { pct, possessive, shortDate, signedPct } from "@/lib/format"

/** "Minnesota Lynx at New York Liberty, Tue, Sep 29, 8:00 PM" in the viewer's own timezone. */
function nextGameText(e: { commence_time: string; home_team: string; away_team: string }): string {
  const when = new Date(e.commence_time).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
  return `${e.away_team} at ${e.home_team}, ${when}`
}

/** "prizepicks" to "PrizePicks", for the pick'em apps PropLine carries. */
function appName(id: string): string {
  return findApp(DEFAULT_APPS, id)?.name ?? id
}

export default function TodayPage() {
  const { state, setDaily, setSettings, ready } = useStore()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [needsKey, setNeedsKey] = React.useState(false)
  // Which keys the server holds in its environment, which the routes use
  // before any key from Settings. Null until the server has answered.
  const [serverKeys, setServerKeys] = React.useState<ServerKeys | null>(null)
  // A clock for the entry: a game that tips while this page is open must leave
  // it without waiting for a refresh, because the apps stop taking it at the start.
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  React.useEffect(() => {
    let live = true
    fetch("/api/keys", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (live) setServerKeys(parseServerKeys(json))
      })
      .catch(() => {
        if (live) setServerKeys(NO_SERVER_KEYS)
      })
    return () => {
      live = false
    }
  }, [])

  const s = state.settings
  const usePropline = s.oddsFeed.provider === "propline"
  const hasKey = hasFeedKey(s.oddsFeed, serverKeys ?? NO_SERVER_KEYS)
  // Hold the setup card back until the server has said whether it has a key,
  // so an install set up through .env.local never flashes it.
  const needsSetup = !hasKey && serverKeys !== null
  // The switch decides whether pick'em lines are used at all. The server
  // pulls them only when it has a PropLine key, from Settings or the environment.
  const wantPickem = s.oddsFeed.pickemLines

  const leagueId = s.daily.league
  const league = leagueFor(leagueId)
  // Only ever show the cache belonging to the league on screen. Rendering an
  // NBA pull under a WNBA heading would be worse than showing nothing.
  const daily = state.daily[leagueId] ?? null
  // A PropLine pull carries the lines whatever the switch says; it is honoured here.
  const pickemLines = wantPickem ? daily?.pickemLines : undefined
  const pickemGames = wantPickem ? daily?.pickemGames : undefined
  // Which games PropLine saw under way is a fact about the games, not an app
  // line, so it applies whatever the pick'em switch says.
  const pickemStarted = daily?.pickemStarted
  const markets = marketsForLeague(leagueId, s.daily.markets)
  // Credits are The Odds API's monthly quota. PropLine counts requests per day,
  // one per game whatever the markets, so a slate is never a quota event there.
  const cost = usePropline
    ? { message: null, severe: false }
    : creditWarning(leagueId, Math.min(s.daily.maxGames, league.maxGames), markets.length)

  function selectLeague(next: LeagueId) {
    setSettings((prev) => ({
      ...prev,
      // The game cap travels with the league: a WNBA cap on an NBA slate
      // misses half of it, and each league's cap is sized to its own slate.
      daily: { ...prev.daily, league: next, maxGames: LEAGUES[next].maxGames },
    }))
    setError(null)
    setNeedsKey(false)
  }

  // The bar a pick'em leg has to clear, used only to place the DFS targets.
  // It comes from the stored table, which is a guide, not a priced number.
  const dfsBreakEven = React.useMemo(() => {
    const app = findApp(s.apps, s.defaultAppId)
    const mode = findMode(app, s.defaultModeId)
    if (!mode) return 0.56
    return breakEvenLegProb(mode, s.constraints.picks) ?? 0.56
  }, [s.apps, s.defaultAppId, s.defaultModeId, s.constraints.picks])

  const picks = React.useMemo(() => {
    if (!daily || daily.quotes.length === 0) return null
    return buildDailyPicks(daily.quotes as FeedQuote[], {
      value: {
        projection: { ...s.projection, league: leagueId },
        minEdge: s.daily.minEdge,
        suspiciousEdge: 0.12,
        requireSharpReference: s.daily.requireSharpReference,
        maxAmerican: 400,
        // Exchanges take commission on winnings (ProphetX 2%); the app ids match the feed's book keys.
        commission: Object.fromEntries(s.apps.filter((a) => (a.commission ?? 0) > 0).map((a) => [a.id, a.commission!])),
      },
      correlation: s.correlation ?? DEFAULT_CORRELATION,
      constraints: { ...s.constraints, picks: s.daily.parlayLegs },
      dfsBreakEven,
      parlayCount: 4,
      bettableBooks: s.oddsFeed.bettable,
      pickemLines,
      pickemGames,
      startedGames: pickemStarted,
    })
  }, [daily, pickemLines, pickemGames, pickemStarted, leagueId, s.projection, s.daily, s.correlation, s.constraints, dfsBreakEven, s.oddsFeed.bettable, s.apps])

  // A ready-to-play pick'em entry at the default app's size and table.
  const entryApp = findApp(s.apps, s.defaultAppId)
  const entryMode = findMode(entryApp, s.defaultModeId)
  const entry = React.useMemo(
    () => (picks ? buildPickemEntry(picks.dfsTargets, s.constraints.picks, dfsBreakEven, 2, s.defaultAppId, now) : null),
    [picks, s.constraints.picks, dfsBreakEven, s.defaultAppId, now],
  )
  // Whether the default app answered for any game in this pull, so the entry
  // can say which line each leg is at and that props it was not offering are out.
  const appLinesLive = !!picks && appAnswered(picks.dfsTargets, s.defaultAppId)
  // Whether it posted any lines at all, for the targets table to fill them in.
  const appLinesPosted = !!picks && hasAppLines(picks.dfsTargets, s.defaultAppId)
  // The pick'em note is written at pull time. Once every game has started it is
  // out of date whatever it said, so it says that instead.
  const allStarted = !!daily && daily.events.length > 0 && daily.events.every((e) => Date.parse(e.commence_time) <= now)
  // Props that clear the bar but sit in games already under way: the entry
  // leaves them out, and an empty entry should say that rather than blame the bar.
  const startedClearing = picks
    ? picks.dfsTargets.filter((t) => t.marketProb >= dfsBreakEven && hasStarted(t, now)).length
    : 0
  const anyOpen = !!picks && picks.dfsTargets.some((t) => !hasStarted(t, now))
  const pickemNote = allStarted
    ? "Every game in this pull has started, and the pick'em apps stop taking picks at the start."
    : daily?.pickemNote
  const pickemAppsSeen = Array.from(new Set((pickemLines ?? []).map((l) => l.app)))
  const entryExp = entry && entryMode ? entryExpectation(entry.map((l) => l.prob), entryMode) : null
  // The table shows the 30 likeliest at the books' line, but the entry ranks by
  // the app's own line, so a leg can come from further down. Its row is where
  // its line can be checked and overridden, so it is always shown.
  const shownTargets = React.useMemo(() => {
    if (!picks) return []
    const top = picks.dfsTargets.slice(0, 30)
    const extra = (entry ?? []).map((l) => l.target).filter((t) => !top.includes(t))
    return [...top, ...extra]
  }, [picks, entry])

  // Books you bet at that the cached pull has no prices from, usually because
  // the pull predates adding them. Refreshing brings them in.
  const missingBettable = picks
    ? s.oddsFeed.bettable.filter((id) => !picks.stats.booksSeen.includes(id)).map((id) => bookProfile(id).name)
    : []

  // Today refuses to price without a sharp reference. When the whole pull is
  // retail-only, that, not a lack of edges, is why the screen is empty.
  const noSharpBook =
    !!picks && s.daily.requireSharpReference && picks.stats.pricedProps === 0 && !picks.stats.booksSeen.some(isSharp)

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
          provider: s.oddsFeed.provider,
          proplineKey: s.oddsFeed.proplineKey || undefined,
          pickemLines: wantPickem,
          league: leagueId,
          from: start.toISOString(),
          to: end.toISOString(),
          markets: s.daily.markets ?? undefined,
          // References plus every book you can bet at. The feed bills per ten
          // bookmakers as one region, so up to ten costs the same as five.
          bookmakers: Array.from(new Set([...s.oddsFeed.books, ...s.oddsFeed.bettable])).slice(0, 10),
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
      // Pick'em lines are only kept when they will be used: each pull lives in this browser's storage.
      setDaily(dailyCacheFrom(data, leagueId, s.oddsFeed.provider, { pickem: wantPickem }))
      const n = (data.quotes ?? []).length
      toast.success(
        n > 0
          ? `Pulled ${n} ${league.label} prices`
          : data.nextEvent
            ? `No ${league.label} games today. Next: ${nextGameText(data.nextEvent)}`
            : data.note ?? `No ${league.label} prices for today`,
      )
      if (data.costSevere && data.costWarning) toast.warning(data.costWarning)
      if (data.cappedOut > 0) {
        toast.info(`${data.cappedOut} more games on the slate were not pulled, to protect your feed quota.`)
      }
      if (data.failures?.length) {
        toast.warning(`${data.failures.length} games could not be priced`)
      }
      if (data.pickemNote && wantPickem) {
        toast.info(data.pickemNote)
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
        <header className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="font-mono text-lg font-semibold tracking-tight">Today</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                {daily
                  ? `${daily.events.length} ${league.label} games · pulled ${shortDate(daily.fetchedAt)}${
                      daily.provider === "propline" ? " from PropLine" : ""
                    }${
                      daily.requestsRemaining != null
                        ? daily.provider === "propline"
                          ? ` · ${daily.requestsRemaining} PropLine requests left today`
                          : ` · ${daily.requestsRemaining} feed requests left`
                        : ""
                    }${pickemAppsSeen.length > 0 ? ` · lines from ${pickemAppsSeen.map(appName).join(", ")}` : ""}`
                  : `Pull today's ${league.label} slate and price it.`}
              </p>
            </div>
            <Button onClick={refresh} disabled={busy || !hasKey}>
              {busy ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <RefreshCw className="mr-1 size-3.5" />}
              {daily ? "Refresh" : "Get today's picks"}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div
              role="tablist"
              aria-label="League"
              className="flex items-center gap-1 rounded-lg border border-border/60 bg-card/40 p-1"
            >
              {LEAGUE_IDS.map((id) => {
                const l = LEAGUES[id]
                const active = id === leagueId
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => selectLeague(id)}
                    className={
                      active
                        ? "rounded-md bg-primary/15 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-primary ring-1 ring-primary/30"
                        : "rounded-md px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    }
                  >
                    {l.short}
                    {state.daily[id] ? <span className="ml-1.5 text-[9px] opacity-60">●</span> : null}
                  </button>
                )
              })}
            </div>
            {!inSeason(leagueId) ? (
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                out of season
              </span>
            ) : null}
            {cost.message ? (
              <span
                className={
                  cost.severe
                    ? "text-[11px] text-destructive"
                    : "text-[11px] text-muted-foreground"
                }
              >
                {cost.severe ? <TriangleAlert className="mr-1 inline size-3" /> : null}
                {cost.message}
              </span>
            ) : null}
          </div>

          <p className="max-w-3xl text-[11px] leading-relaxed text-muted-foreground">{league.note}</p>
        </header>

        {needsSetup ? (
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
                  {usePropline ? (
                    <li>
                      Get a free key at{" "}
                      <a
                        href="https://prop-line.com"
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline underline-offset-2"
                      >
                        prop-line.com
                      </a>
                      . The free tier is {PROPLINE_FREE_DAILY.toLocaleString()} requests a day, and it also carries
                      PrizePicks and Underdog lines.
                    </li>
                  ) : (
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
                      . The free tier is 500 requests a month. Or switch the provider to PropLine in Settings: 1,000
                      requests a day, with the pick&apos;em apps&apos; own lines included.
                    </li>
                  )}
                  <li>
                    Paste it into <Link href="/settings" className="text-primary underline underline-offset-2">Settings → Odds feed</Link>,
                    or put{" "}
                    <code className="font-mono">{usePropline ? "PROPLINE_API_KEY" : "ODDS_API_KEY"}=…</code> in a{" "}
                    <code className="font-mono">.env.local</code> file.
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
              <StatTile label="Games" value={String(picks.games.length)} hint={`${picks.stats.pricedProps} of ${picks.stats.props} player props priced.`} />
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
                <p className="max-w-3xl text-[11px] leading-relaxed text-muted-foreground">
                  Most likely to hit first, by win probability; every one also beats the fair price by your minimum
                  edge. A likelier bet is not a bigger one: a short price pays less, which the stake column accounts
                  for. Each bet names the book to place it at. Prices are from {shortDate(daily!.fetchedAt)} and move;
                  if a line is gone or different in the app, refresh before betting.
                  {picks.stats.hiddenOffers > 0
                    ? ` ${picks.stats.hiddenOffers} more edge${picks.stats.hiddenOffers === 1 ? " was" : "s were"} at books you don't bet at, so ${picks.stats.hiddenOffers === 1 ? "it is" : "they are"} hidden. Change that in Settings.`
                    : ""}
                </p>
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
            ) : (
              <section className="rounded-lg border border-dashed border-border/60 p-5 text-xs leading-relaxed text-muted-foreground">
                <span className="font-mono uppercase tracking-[0.14em]">No value bets at your books</span>
                <p className="mt-2 max-w-2xl">
                  {noSharpBook
                    ? `Only retail books (${picks.stats.booksSeen.map((id) => bookProfile(id).name).join(", ")}) posted these props, and none of them is a sharp book like Pinnacle, BetOnline or LowVig. Retail books copy each other, so without a sharp price there is nothing trustworthy to measure them against, and the app prices nothing rather than guess. Sharp books often post ${league.label} props closer to tip, so refresh then; or turn off "Today: require a sharp book" in Settings to price against the retail consensus (weaker). `
                    : picks.stats.hiddenOffers > 0
                    ? `${picks.stats.hiddenOffers} edge${picks.stats.hiddenOffers === 1 ? " was" : "s were"} found, but only at books you don't bet at (${picks.stats.hiddenBooks.map((id) => bookProfile(id).name).join(", ")}), so ${picks.stats.hiddenOffers === 1 ? "it is" : "they are"} not shown. `
                    : "None of the prices in this pull beat the fair value by your minimum edge. "}
                  {missingBettable.length > 0
                    ? `This pull has no prices from ${missingBettable.join(", ")}. Refresh to ask for them; a book that doesn't post ${league.label} props will still be missing. `
                    : ""}
                  Your books: {s.oddsFeed.bettable.map((id) => bookProfile(id).name).join(", ") || "none"}.{" "}
                  <Link href="/settings" className="text-primary underline underline-offset-2">Change in Settings</Link>
                  {picks.dfsTargets.length > 0 ? ". The pick'em targets below still apply to PrizePicks and the other apps." : "."}
                </p>
              </section>
            )}

            {picks.dfsTargets.length > 0 ? (
              <section className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
                <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-primary">
                  Pick&apos;em entry · {entryApp?.name ?? "your app"} {s.constraints.picks}-pick {entryMode?.label ?? ""}
                </h2>
                {entry ? (
                  <>
                    <ul className="divide-y divide-border/40 text-sm">
                      {entry.map((l) => (
                        <li key={l.target.key} className="flex items-center justify-between gap-2 py-1.5">
                          <span className="min-w-0">
                            <span className="font-medium">{l.target.player}</span>{" "}
                            <span className="font-mono text-[10px] text-muted-foreground">{l.target.marketLabel}</span>
                          </span>
                          <span className="flex items-center gap-1.5 font-mono text-xs">
                            <SideBadge side={l.side} /> {l.line} · {pct(l.prob, 0)}
                            {appLinesLive && l.source === "books" ? (
                              <span className="text-[10px] text-muted-foreground">books&apos; line</span>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      {entryExp
                        ? `All ${entry.length} hit ${pct(entryExp.pAllHit, 1)} of the time; at ${possessive(entryApp?.name ?? "the app")} stored ${entryMode?.label ?? ""} table that is ${signedPct(entryExp.ev)} expected per entry. `
                        : ""}
                      One leg per player and at most two per game, so it never holds both sides of a prop.{" "}
                      {appLinesLive
                        ? `Lines are ${possessive(entryApp?.name ?? "the app")} own, read through PropLine at ${shortDate(daily!.fetchedAt)}, and each chance is the books' consensus at that exact line. Props ${entryApp?.name ?? "the app"} was not offering are left out.${entry.some((l) => l.source === "books") ? ` A leg marked "books' line" is from a game ${possessive(entryApp?.name ?? "the app")} lines did not come through for: check its line on your screen before playing it.` : ""} Lines move: if one on your screen differs, check it in the table below.`
                        : `Lines are the books' own, which PrizePicks, Underdog, Sleeper and Real almost always post: if a line in your app differs, check it in the table below before playing it.`}{" "}
                      Standard picks only; a goblin or demon changes the payout. Legs are treated as independent.
                    </p>
                  </>
                ) : (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {!anyOpen && (allStarted || startedClearing > 0) ? (
                      <>
                        Every game on this slate has started, and the pick&apos;em apps stop taking picks at the start.
                        Refresh for later games, or pass.
                      </>
                    ) : (
                      <>
                        {startedClearing > 0
                          ? `${startedClearing} ${startedClearing === 1 ? "prop clears" : "props clear"} the bar in games that have started, which the apps no longer take. `
                          : ""}
                        Fewer than {s.constraints.picks} props clear the {pct(dfsBreakEven)} bar
                        {startedClearing > 0 ? " in games still to start" : " on this slate"}, one per player
                        {appLinesLive ? `, at the lines ${entryApp?.name ?? "the app"} is actually posting` : ""}.
                        Padding the entry with coin flips is the bet the bar exists to stop: play a smaller entry, or pass.
                      </>
                    )}
                  </p>
                )}
              </section>
            ) : null}

            {picks.dfsTargets.length > 0 ? (
              <section className="space-y-3">
                <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  Pick'em targets
                </h2>
                <p className="max-w-3xl text-[11px] leading-relaxed text-muted-foreground">
                  Most likely to hit first. Chance is the side the books favour, at the line they hang, which is
                  the line a pick&apos;em app almost always copies.{" "}
                  {!wantPickem
                    ? "The pick'em apps' own lines are switched off in Settings, so if your app shows a different line, type it in. "
                    : pickemAppsSeen.length > 0
                      ? `The apps' own lines (${pickemAppsSeen.map(appName).join(", ")}) are listed under each player, priced off the same books, and ${
                          appLinesPosted
                            ? `${possessive(entryApp?.name ?? "your app")} line is filled in for you`
                            : pickemAppsSeen.includes(s.defaultAppId)
                              ? `none of ${possessive(entryApp?.name ?? "your app")} lines matched these props, so type its line in`
                              : `${entryApp?.name ?? "your default app"} posted none in this pull, so type its line in`
                        }. `
                      : s.oddsFeed.proplineKey.trim() || serverKeys?.propline
                        ? "No pick'em lines came through in this pull, so if your app shows a different line, type it in. "
                        : "Nothing here can see what PrizePicks or Underdog are offering unless a PropLine key is set in Settings, so if your app shows a different line, type it in. "}
                  You get one answer: the over, the under, or pass. Never both: on a pick&apos;em app one
                  of the two always loses. The bar is a {pct(dfsBreakEven)} per-leg hit rate, from your default{" "}
                  {s.constraints.picks}-pick entry, for standard picks; a goblin or demon pays differently and needs
                  its own bar.
                  {wantPickem && pickemNote ? ` ${pickemNote}` : ""}
                </p>
                <div className="overflow-x-auto rounded-lg border border-border/60">
                  <table className="w-full min-w-[760px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border/60 bg-card/40 text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        <th className="px-3 py-2">Player</th>
                        <th className="px-3 py-2">Market</th>
                        <th className="px-3 py-2 text-right">Projection</th>
                        <th className="px-3 py-2">Chance</th>
                        <th className="px-3 py-2">Your app&apos;s line</th>
                        <th className="px-3 py-2">Play</th>
                        <th className="px-3 py-2 text-right">Conf</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownTargets.map((t) => (
                        <DfsTargetRow key={t.key} t={t} bar={dfsBreakEven} app={s.defaultAppId} />
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
                  <Badge key={g.gameId} variant="outline" className="max-w-full whitespace-normal font-mono text-[11px]">
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
              {daily ? `No ${league.label} prices for today` : "Nothing pulled yet"}
            </p>
            <p className="mx-auto mt-3 max-w-lg text-xs leading-relaxed text-muted-foreground">
              {!daily
                ? "Press the button above to pull today's slate. Player props are billed per market per game, so nothing is fetched until you ask."
                : daily.nextEvent
                  ? `There is no ${league.label} game today, so there is nothing to price. The next game is ${nextGameText(daily.nextEvent)}. Press Refresh that day; props usually go up a few hours before tip.`
                  : daily.nextEvent === null
                    ? `The feed lists no upcoming ${league.label} games at all, so the season looks to be over or the next schedule is not posted yet. Nothing is broken; switch leagues above.`
                    : !inSeason(leagueId)
                  ? `${league.label} is out of season right now, so an empty slate is expected rather than a fault. Switch leagues above, or come back when the season starts.`
                  : `The feed returned no ${league.label} player props in today's window. That usually means no games today, or the books have not posted props yet, which is normal until a few hours before tip.`}
            </p>
          </section>
        ) : null}
      </div>
    </TooltipProvider>
  )
}
