"use client"

import * as React from "react"
import { toast } from "sonner"
import { Camera, Loader2, Plus, TriangleAlert, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { LEAGUES, LEAGUE_IDS, type LeagueId } from "@/lib/leagues"
import { MARKETS, MARKET_KEYS, marketSport, type MarketKey } from "@/lib/nba/markets"
import { extractProps, mergeReads, readEntryHeader } from "@/lib/ocr/extract"
import { normalizeName } from "@/lib/quant/correlation"
import { breakEvenLegProb, findApp } from "@/lib/quant/payouts"
import { DEFAULT_VALUE_SETTINGS } from "@/lib/quant/valuebets"
import { useStore } from "@/lib/store/provider"
import type { LegResult, TrackedSlip } from "@/lib/store/schema"
import {
  draftFromCandidate,
  entryExpectation,
  legsFromText,
  priceLeg,
  settlementMode,
  withResults,
  type DraftLeg,
} from "@/lib/tracker/entries"
import { money, pct } from "@/lib/format"

/**
 * Log an entry placed straight in a pick'em app.
 *
 * Most entries never pass through the build screen, so without this the
 * tracker only ever sees a sliver of what is actually played. Drop in the
 * entry's screenshot, or type the legs, set what happened, and it is scored at
 * the payout the app really showed, goblins, demons and all.
 */
export function LogEntry({ onDone }: { onDone?: () => void }) {
  const { state, addSlip } = useStore()
  const s = state.settings
  const [appId, setAppId] = React.useState(s.defaultAppId)
  const [modeId, setModeId] = React.useState("power")
  const [league, setLeague] = React.useState<LeagueId>(s.daily.league)
  const [stake, setStake] = React.useState("")
  const [payout, setPayout] = React.useState("")
  const [text, setText] = React.useState("")
  const [legs, setLegs] = React.useState<DraftLeg[]>([])
  const [busy, setBusy] = React.useState(false)

  const app = findApp(s.apps, appId)
  const dfsApps = s.apps.filter((a) => a.kind === "dfs")
  const stakeN = Number.parseFloat(stake)
  const payoutN = Number.parseFloat(payout)
  const n = legs.length
  const multiple = stakeN > 0 && payoutN > 0 ? payoutN / stakeN : null

  const capturedPayout = React.useMemo(() => {
    if (!multiple || n < 2) return null
    const stored = app?.modes.find((m) => m.id === modeId)?.table[n] ?? {}
    // Power: the screen's "$X for $Y" is the only tier. Flex: the lower tiers
    // are not on the entry screen, so they come from the stored table.
    const tiers = modeId === "flex" ? { ...stored, [n]: multiple } : { [n]: multiple }
    return { picks: n, tiers, confirmed: modeId !== "flex", capturedAt: new Date().toISOString() }
  }, [multiple, n, modeId, app])

  const breakEven = React.useMemo(() => {
    if (!capturedPayout) return null
    return breakEvenLegProb(settlementMode({ appId, modeId, capturedPayout }, s.apps), n)
  }, [capturedPayout, appId, modeId, s.apps, n])

  const valueSettings = React.useMemo(
    () => ({
      ...DEFAULT_VALUE_SETTINGS,
      projection: { ...s.projection, league },
      requireSharpReference: s.daily.requireSharpReference,
    }),
    [s.projection, s.daily.requireSharpReference, league],
  )
  const quotes = state.daily[league]?.quotes
  const priced = legs.map((l) =>
    l.side && l.marketKey && Number.isFinite(l.line)
      ? priceLeg(quotes, { player: l.player, marketKey: l.marketKey, line: l.line, side: l.side }, valueSettings)
      : null,
  )

  // Players already riding in an open entry.
  const open = React.useMemo(() => {
    const m = new Map<string, number>()
    for (const sl of state.slips) {
      if (sl.status !== "PENDING") continue
      for (const l of sl.legs) if (l.result === "PENDING") m.set(normalizeName(l.player), (m.get(normalizeName(l.player)) ?? 0) + 1)
    }
    return m
  }, [state.slips])

  function readText() {
    const parsed = legsFromText(text)
    if (parsed.length === 0) return toast.error("Type one leg per line first")
    setLegs(parsed)
  }

  async function readScreenshot(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    setBusy(true)
    try {
      const { readImage } = await import("@/lib/ocr/engine")
      const out = await readImage(file)
      const raw = extractProps(out.lines)
      const cleaned = extractProps(out.cleanedLines)
      const merged = mergeReads(raw.candidates, cleaned.candidates)
      const found = merged.map((c) => draftFromCandidate(c))
      const seen = new Set(found.map((l) => normalizeName(l.player)))
      for (const name of [...raw.unpairedNames, ...cleaned.unpairedNames]) {
        if (seen.has(normalizeName(name))) continue
        seen.add(normalizeName(name))
        found.push({ player: name, marketKey: null, marketLabel: "", line: Number.NaN, side: null, result: "PENDING", note: "The line was not readable. Fill in the stat, line and side." })
      }
      const header = readEntryHeader(out.lines) ?? readEntryHeader(out.cleanedLines)
      if (header) {
        setStake(String(header.stake))
        setPayout(String(header.payout))
        if (header.mode) setModeId(header.mode)
      }
      // A football stat on the screen means an NFL entry.
      if (found.some((l) => l.marketKey && marketSport(l.marketKey) === "football")) setLeague("nfl")
      setLegs(found)
      if (found.length === 0) toast.error("No legs read from that screenshot", { description: "Type them in instead." })
      else toast.success(`Read ${found.length} legs`, { description: "Check each one and set what happened." })
    } catch (err) {
      toast.error("Could not read the screenshot", { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  function update(i: number, patch: Partial<DraftLeg>) {
    setLegs((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch, note: null } : l)))
  }

  const problems: string[] = []
  if (!(stakeN > 0)) problems.push("Enter the stake.")
  if (!(payoutN > stakeN)) problems.push("Enter what it pays if every leg hits (more than the stake).")
  if (n < 2) problems.push("An entry needs at least two legs.")
  legs.forEach((l, i) => {
    if (!l.side || !l.marketKey || !Number.isFinite(l.line) || !l.player.trim()) problems.push(`Leg ${i + 1} needs a player, stat, line and side.`)
  })

  function save() {
    if (problems.length > 0 || !capturedPayout) return
    const tracked: TrackedSlip = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      settledAt: null,
      appId,
      modeId,
      legs: legs.map((l, i) => ({
        player: l.player.trim(),
        marketKey: l.marketKey,
        marketLabel: l.marketKey ? MARKETS[l.marketKey].label : l.marketLabel,
        line: l.line,
        side: l.side!,
        pWinAtEntry: priced[i],
        app: appId,
        result: l.result,
        actual: null,
      })),
      stake: stakeN,
      capturedPayout,
      evAtEntry: null,
      pAllHitAtEntry: null,
      topMultiple: multiple!,
      status: "PENDING",
      actualMultiple: null,
      notes: "",
      source: "logged",
    }
    const exp = entryExpectation(priced, settlementMode(tracked, s.apps))
    if (exp) {
      tracked.evAtEntry = exp.ev
      tracked.pAllHitAtEntry = exp.pAllHit
    }
    addSlip(withResults(tracked, tracked.legs, s.apps))
    toast.success("Entry logged", { description: `${n} legs, ${money(stakeN)} to pay ${money(payoutN)}` })
    setLegs([])
    setText("")
    setStake("")
    setPayout("")
    onDone?.()
  }

  const labelCls = "font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground"

  return (
    <section className="space-y-4 rounded-lg border border-border/60 bg-card/40 p-4">
      <div>
        <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">Log an entry you placed</h2>
        <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-muted-foreground">
          Drop in the entry&apos;s screenshot, or type one leg per line, like{" "}
          <code className="font-mono">Jordan Addison under 5.5 Recs win</code>. The payout comes from the entry
          screen (&quot;$2 for $12&quot;), so goblins and demons are scored at what the app actually paid.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div>
          <Label className={labelCls}>App</Label>
          <Select value={appId} onValueChange={setAppId}>
            <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {dfsApps.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className={labelCls}>Type</Label>
          <Select value={modeId} onValueChange={setModeId}>
            <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(app?.modes ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className={labelCls}>League</Label>
          <Select value={league} onValueChange={(v) => setLeague(v as LeagueId)}>
            <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {LEAGUE_IDS.map((id) => <SelectItem key={id} value={id}>{LEAGUES[id].short}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className={labelCls}>Stake $</Label>
          <Input inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value)} placeholder="2" className="mt-1 h-8 text-xs" />
        </div>
        <div>
          <Label className={labelCls}>Pays if all hit $</Label>
          <Input inputMode="decimal" value={payout} onChange={(e) => setPayout(e.target.value)} placeholder="12" className="mt-1 h-8 text-xs" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="secondary" disabled={busy}>
          <label className="cursor-pointer">
            {busy ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <Camera className="mr-1 size-3.5" />}
            {busy ? "Reading…" : "Read a screenshot"}
            <input type="file" accept="image/*" className="hidden" onChange={readScreenshot} disabled={busy} />
          </label>
        </Button>
        <span className="text-[11px] text-muted-foreground">or type the legs:</span>
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Jordan Addison under 5.5 Recs win\nTyler Allgeier over 2.5 Rush Yards loss\nJack Bech over 0.5 Rec Yards dnp"}
        className="min-h-24 font-mono text-[11px]"
        spellCheck={false}
      />
      <Button size="sm" variant="outline" disabled={!text.trim()} onClick={readText}>
        Read these legs
      </Button>

      {legs.length > 0 ? (
        <div className="space-y-2">
          {legs.map((l, i) => (
            <div key={i} className="rounded-md border border-border/50 p-2">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-[1.4fr_1.2fr_0.6fr_0.8fr_1fr_auto]">
                <Input value={l.player} onChange={(e) => update(i, { player: e.target.value })} className="col-span-2 h-8 text-xs md:col-span-1" aria-label="Player" />
                <Select value={l.marketKey ?? ""} onValueChange={(v) => update(i, { marketKey: v as MarketKey, marketLabel: MARKETS[v as MarketKey].label })}>
                  <SelectTrigger className="h-8 text-xs" aria-label="Stat"><SelectValue placeholder="Stat" /></SelectTrigger>
                  <SelectContent>
                    {MARKET_KEYS.filter((k) => marketSport(k) === LEAGUES[league].sport).map((k) => (
                      <SelectItem key={k} value={k}>{MARKETS[k].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  inputMode="decimal"
                  value={Number.isFinite(l.line) ? String(l.line) : ""}
                  onChange={(e) => update(i, { line: e.target.value === "" ? Number.NaN : Number.parseFloat(e.target.value) })}
                  placeholder="Line"
                  className="h-8 text-xs"
                  aria-label="Line"
                />
                <Select value={l.side ?? ""} onValueChange={(v) => update(i, { side: v as "OVER" | "UNDER" })}>
                  <SelectTrigger className="h-8 text-xs" aria-label="Side"><SelectValue placeholder="Side" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OVER">Over</SelectItem>
                    <SelectItem value="UNDER">Under</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={l.result} onValueChange={(v) => update(i, { result: v as LegResult })}>
                  <SelectTrigger className="h-8 text-xs" aria-label="Result"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PENDING">Not settled</SelectItem>
                    <SelectItem value="WIN">Hit</SelectItem>
                    <SelectItem value="LOSS">Missed</SelectItem>
                    <SelectItem value="VOID">Did not play</SelectItem>
                    <SelectItem value="PUSH">Push</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" onClick={() => setLegs((p) => p.filter((_, j) => j !== i))} aria-label="Remove leg">
                  <X className="size-3.5" />
                </Button>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-[10px] text-muted-foreground">
                <span>{priced[i] != null ? `App's price from your last pull: ${pct(priced[i]!)} to hit` : "Not priced by the app"}</span>
                {open.get(normalizeName(l.player)) ? (
                  <span className="text-accent">Already in {open.get(normalizeName(l.player))} open {open.get(normalizeName(l.player)) === 1 ? "entry" : "entries"}</span>
                ) : null}
                {l.note ? <span className="text-accent">{l.note}</span> : null}
              </div>
            </div>
          ))}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setLegs((p) => [...p, { player: "", marketKey: null, marketLabel: "", line: Number.NaN, side: null, result: "PENDING", note: null }])}
          >
            <Plus className="mr-1 size-3.5" /> Add a leg
          </Button>
        </div>
      ) : null}

      {breakEven != null ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {money(stakeN)} to pay {money(payoutN)} is {multiple!.toFixed(2)}x on {n} legs, so each leg had to hit{" "}
          <span className="font-mono text-foreground">{pct(breakEven)}</span> of the time just to break even.
          {modeId === "flex" ? " Lower flex tiers come from the stored table and are unconfirmed." : ""}
        </p>
      ) : null}

      {legs.length > 0 && problems.length > 0 ? (
        <p className="flex items-start gap-1.5 text-[11px] text-accent">
          <TriangleAlert className="mt-0.5 size-3 shrink-0" /> {problems[0]}
        </p>
      ) : null}
      <Button size="sm" onClick={save} disabled={problems.length > 0}>
        Log this entry
      </Button>
    </section>
  )
}
