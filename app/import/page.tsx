"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Download, FileUp, ImageUp, Loader2, Plus, TriangleAlert } from "lucide-react"
import { ReviewTable } from "@/components/review-table"
import { StatTile } from "@/components/stat-tile"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { extractProps, linesFromText } from "@/lib/ocr/extract"
import { parseSlate, SAMPLE_CSV } from "@/lib/import/parse"
import {
  draftFromCandidate,
  draftFromRow,
  draftToRow,
  emptyDraft,
  summariseDrafts,
  validateDrafts,
  type DraftProp,
} from "@/lib/import/draft"
import { feedKeyFor } from "@/lib/odds-feed/theoddsapi"
import { attachQuotes, indexQuotes, type NormalizedQuote } from "@/lib/odds-feed/theoddsapi"
import { useStore } from "@/lib/store/provider"

export default function ImportPage() {
  const router = useRouter()
  const { state, setSlate } = useStore()
  const [drafts, setDrafts] = React.useState<DraftProp[]>([])
  const [label, setLabel] = React.useState("")
  const [app, setApp] = React.useState("prizepicks")

  const [ocrBusy, setOcrBusy] = React.useState(false)
  const [ocrStatus, setOcrStatus] = React.useState("")
  const [pasteText, setPasteText] = React.useState("")

  const [oddsBusy, setOddsBusy] = React.useState(false)
  const [oddsReport, setOddsReport] = React.useState<{
    matched: number
    unmatched: { player: string; market: string }[]
    remaining: number | null
    error?: string
  } | null>(null)

  const summary = React.useMemo(() => summariseDrafts(drafts), [drafts])
  const blocking = React.useMemo(
    () => validateDrafts(drafts).filter((p) => p.message !== "Not reviewed yet."),
    [drafts],
  )
  const canLoad = drafts.length > 0 && summary.blocking === 0

  async function onScreenshots(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    setOcrBusy(true)
    try {
      const { readImage } = await import("@/lib/ocr/engine")
      const found: DraftProp[] = []
      for (let i = 0; i < files.length; i++) {
        setOcrStatus(`Reading image ${i + 1} of ${files.length}…`)
        const out = await readImage(files[i], (p) => setOcrStatus(`${p.status} ${Math.round(p.progress * 100)}%`))
        const { candidates } = extractProps(out.lines)
        for (const c of candidates) found.push(draftFromCandidate(c, app))
      }
      setDrafts((d) => [...d, ...found])
      toast.success(`Read ${found.length} props`, { description: "Check every row before loading them." })
    } catch (err) {
      toast.error("Could not read that image", { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setOcrBusy(false)
      setOcrStatus("")
      e.target.value = ""
    }
  }

  function onPaste(text: string) {
    setPasteText(text)
    if (!text.trim()) return
    const looksStructured = /[,\t]/.test(text.split(/\r?\n/)[0] ?? "") || text.trim().startsWith("[") || text.trim().startsWith("{")
    if (looksStructured) {
      const r = parseSlate(text)
      setDrafts((d) => [...d, ...r.rows.map(draftFromRow)])
      toast.success(`Read ${r.rows.length} rows`, {
        description: r.skipped.length > 0 ? `${r.skipped.length} lines could not be read.` : undefined,
      })
    } else {
      const { candidates } = extractProps(linesFromText(text))
      setDrafts((d) => [...d, ...candidates.map((c) => draftFromCandidate(c, app))])
      toast.success(`Found ${candidates.length} props in that text`)
    }
    setPasteText("")
  }

  async function fetchOdds() {
    const wanted = Array.from(new Set(drafts.map((d) => d.marketKey).filter(Boolean)))
      .map((m) => feedKeyFor(m!))
      .filter((k): k is string => !!k)

    if (wanted.length === 0) {
      toast.error("Nothing to price yet")
      return
    }

    setOddsBusy(true)
    setOddsReport(null)
    try {
      const res = await fetch("/api/odds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiKey: state.settings.oddsFeed.apiKey || undefined,
          markets: wanted,
          regions: state.settings.oddsFeed.regions,
          bookmakers: state.settings.oddsFeed.books,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setOddsReport({ matched: 0, unmatched: [], remaining: null, error: data.error ?? `Request failed (${res.status}).` })
        return
      }

      const index = indexQuotes((data.quotes ?? []) as NormalizedQuote[])
      const rows = drafts.map((d) => ({ player: d.player, marketKey: d.marketKey, marketLabel: "", draft: d }))
      const attached = attachQuotes(rows, index)
      setDrafts(attached.rows.map((r) => ({ ...r.draft, quotes: r.quotes })))
      setOddsReport({
        matched: attached.matched,
        unmatched: attached.unmatched,
        remaining: data.requestsRemaining ?? null,
      })
      toast.success(`Priced ${attached.matched} of ${drafts.length} props`)
    } catch (err) {
      setOddsReport({ matched: 0, unmatched: [], remaining: null, error: err instanceof Error ? err.message : String(err) })
    } finally {
      setOddsBusy(false)
    }
  }

  function commit() {
    if (!canLoad) return
    setSlate({
      id: crypto.randomUUID(),
      label: label.trim() || `Slate ${new Date().toLocaleDateString()}`,
      importedAt: new Date().toISOString(),
      rows: drafts.map(draftToRow),
      source: drafts.some((d) => d.origin === "screenshot") ? "screenshot" : "paste",
    })
    toast.success(`Loaded ${drafts.length} props`)
    router.push("/")
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-mono text-lg font-semibold tracking-tight">Capture slate</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
          Read your own screenshots of the board, review every row, then attach sportsbook prices from the odds feed.
          The board tells you what is on offer. The sportsbook side is what tells you whether it is worth taking, and a
          prop without it stays unpriced.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Rows" value={String(summary.total)} hint="Props captured so far." />
        <StatTile
          label="Reviewed"
          value={`${summary.confirmed}/${summary.total}`}
          tone={summary.total > 0 && summary.confirmed === summary.total ? "good" : "warn"}
          hint="Tick each row once you have checked the player, market and line against the screenshot."
        />
        <StatTile
          label="Priced"
          value={String(summary.priced)}
          tone={summary.priced > 0 ? "good" : "neutral"}
          hint="Props with a sportsbook price attached. Only these can be built into entries."
        />
        <StatTile
          label="Blocking problems"
          value={String(summary.blocking)}
          tone={summary.blocking > 0 ? "bad" : "good"}
          hint="Rows that cannot be loaded until they are fixed or reviewed."
        />
      </div>

      <Tabs defaultValue="screenshot">
        <TabsList className="font-mono text-xs">
          <TabsTrigger value="screenshot">Screenshots</TabsTrigger>
          <TabsTrigger value="paste">Paste</TabsTrigger>
        </TabsList>

        <TabsContent value="screenshot" className="mt-4">
          <div className="rounded-lg border border-border/60 bg-card/40 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">App</Label>
                <Input value={app} onChange={(e) => setApp(e.target.value)} className="mt-1.5 h-9 w-40 font-mono text-xs" />
              </div>
              <Button asChild disabled={ocrBusy}>
                <label className="cursor-pointer">
                  {ocrBusy ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <ImageUp className="mr-1 size-3.5" />}
                  {ocrBusy ? "Reading…" : "Add screenshots"}
                  <input type="file" accept="image/*" multiple className="hidden" onChange={onScreenshots} disabled={ocrBusy} />
                </label>
              </Button>
              {ocrStatus ? <span className="font-mono text-[11px] text-muted-foreground">{ocrStatus}</span> : null}
            </div>
            <p className="mt-3 max-w-2xl text-[11px] leading-relaxed text-muted-foreground">
              Screenshot the board on your phone and drop the images here. Reading happens entirely in this browser, so
              nothing is uploaded and no app is scraped. Capture the fifteen or so props you would genuinely consider
              rather than the whole board: every row still has to be checked by eye, and a shorter list gets checked
              properly.
            </p>
          </div>
        </TabsContent>

        <TabsContent value="paste" className="mt-4">
          <div className="space-y-3 rounded-lg border border-border/60 bg-card/40 p-4">
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => onPaste(SAMPLE_CSV)}>
                <Download className="mr-1 size-3" /> Load worked example
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <label className="cursor-pointer">
                  <FileUp className="mr-1 size-3" /> Choose a file
                  <input
                    type="file"
                    accept=".csv,.tsv,.txt,.json"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0]
                      if (f) onPaste(await f.text())
                      e.target.value = ""
                    }}
                  />
                </label>
              </Button>
            </div>
            <Textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={"Paste CSV, JSON, or plain text copied off a board:\n\nAnthony Edwards\n24.5\nPoints"}
              className="min-h-40 font-mono text-[11px] leading-relaxed"
              spellCheck={false}
            />
            <Button size="sm" disabled={!pasteText.trim()} onClick={() => onPaste(pasteText)}>
              Add these rows
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      {drafts.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">Review</h2>
            <Button variant="ghost" size="sm" onClick={() => setDrafts((d) => [...d, emptyDraft(app)])}>
              <Plus className="mr-1 size-3" /> Add row
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDrafts((d) => d.map((x) => ({ ...x, confirmed: true })))}
            >
              Mark all reviewed
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDrafts([])}>
              Clear
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={fetchOdds} disabled={oddsBusy}>
                {oddsBusy ? <Loader2 className="mr-1 size-3 animate-spin" /> : null}
                Attach sportsbook odds
              </Button>
            </div>
          </div>

          {oddsReport ? (
            oddsReport.error ? (
              <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs leading-relaxed text-destructive">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {oddsReport.error} Props stay unpriced until a price is attached, so the optimizer will refuse to build
                  entries from them.
                </span>
              </p>
            ) : (
              <p className="rounded-lg border border-border/60 bg-card/40 p-3 text-xs leading-relaxed text-muted-foreground">
                Priced {oddsReport.matched} of {drafts.length}.
                {oddsReport.remaining != null ? ` ${oddsReport.remaining} feed requests left this period.` : ""}
                {oddsReport.unmatched.length > 0 ? (
                  <>
                    {" "}
                    No price found for: {oddsReport.unmatched.slice(0, 8).map((u) => `${u.player} ${u.market}`).join(", ")}
                    {oddsReport.unmatched.length > 8 ? ` and ${oddsReport.unmatched.length - 8} more` : ""}. Names are
                    matched exactly rather than approximately, so check spelling before assuming the book has no market.
                  </>
                ) : null}
              </p>
            )
          ) : null}

          <ReviewTable drafts={drafts} onChange={setDrafts} />

          {blocking.length > 0 ? (
            <ul className="space-y-1 text-[11px] text-destructive">
              {blocking.slice(0, 6).map((p, i) => (
                <li key={i}>{p.message}</li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Slate name
              </Label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Tuesday main slate"
                className="mt-1.5 h-9 w-56 font-mono text-xs"
              />
            </div>
            <Button onClick={commit} disabled={!canLoad}>
              Load {drafts.length} props
            </Button>
            {!canLoad ? (
              <span className="text-[11px] text-muted-foreground">
                {summary.confirmed < summary.total
                  ? `${summary.total - summary.confirmed} rows still need reviewing.`
                  : "Fix the problems above first."}
              </span>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  )
}
