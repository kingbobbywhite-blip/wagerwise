"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { CheckCircle2, FileUp, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { parseSlate, SAMPLE_CSV, type ImportResult } from "@/lib/import/parse"
import { useStore } from "@/lib/store/provider"
import { projectSlate } from "@/lib/quant/projection"

export default function ImportPage() {
  const router = useRouter()
  const { state, setSlate } = useStore()
  const [text, setText] = React.useState("")
  const [label, setLabel] = React.useState("")
  const [result, setResult] = React.useState<ImportResult | null>(null)

  const preview = React.useMemo(() => {
    if (!result || result.rows.length === 0) return null
    const priced = projectSlate(result.rows, state.settings.projection)
    return { priced: priced.length, dropped: result.rows.length - priced.length }
  }, [result, state.settings.projection])

  function analyse(next: string) {
    setText(next)
    setResult(next.trim() ? parseSlate(next) : null)
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const content = await file.text()
    analyse(content)
    if (!label) setLabel(file.name.replace(/\.[^.]+$/, ""))
  }

  function commit() {
    if (!result || result.rows.length === 0) return
    setSlate({
      id: crypto.randomUUID(),
      label: label.trim() || `Slate ${new Date().toLocaleDateString()}`,
      importedAt: new Date().toISOString(),
      rows: result.rows,
      source: result.format.toUpperCase(),
    })
    toast.success(`Loaded ${result.rows.length} lines`)
    router.push("/")
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-mono text-lg font-semibold tracking-tight">Import slate</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
          Paste CSV, TSV or JSON, or choose a file. Column names are matched loosely, so most scraper output works
          unchanged. Nothing is uploaded anywhere: parsing and pricing both happen in this browser.
        </p>
      </header>

      <div className="rounded-lg border border-border/60 bg-card/40 p-4">
        <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">What to include</h2>
        <div className="mt-3 grid gap-3 text-xs leading-relaxed text-muted-foreground md:grid-cols-3">
          <div>
            <div className="font-medium text-foreground">Required</div>
            <p className="mt-1">
              <code className="font-mono text-[11px]">player</code>,{" "}
              <code className="font-mono text-[11px]">market</code>,{" "}
              <code className="font-mono text-[11px]">line</code>. The line is the number your app is actually offering.
            </p>
          </div>
          <div>
            <div className="font-medium text-foreground">Worth far more than anything else</div>
            <p className="mt-1">
              <code className="font-mono text-[11px]">over_odds</code> and{" "}
              <code className="font-mono text-[11px]">under_odds</code> from a real sportsbook, plus{" "}
              <code className="font-mono text-[11px]">book_line</code> if that book posts a different number. Stripping
              the vig off a two-way price beats every public projection.
            </p>
          </div>
          <div>
            <div className="font-medium text-foreground">Helpful</div>
            <p className="mt-1">
              <code className="font-mono text-[11px]">projection</code>,{" "}
              <code className="font-mono text-[11px]">l5</code>, <code className="font-mono text-[11px]">l10</code>,{" "}
              <code className="font-mono text-[11px]">season</code>,{" "}
              <code className="font-mono text-[11px]">minutes</code>,{" "}
              <code className="font-mono text-[11px]">hit_rate</code>,{" "}
              <code className="font-mono text-[11px]">app</code>,{" "}
              <code className="font-mono text-[11px]">game_id</code>.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => analyse(SAMPLE_CSV)}>
              Load worked example
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <label className="cursor-pointer">
                <FileUp className="mr-1 size-3" />
                Choose file
                <input type="file" accept=".csv,.tsv,.txt,.json" className="hidden" onChange={onFile} />
              </label>
            </Button>
            {text ? (
              <Button variant="ghost" size="sm" onClick={() => analyse("")}>
                Clear
              </Button>
            ) : null}
          </div>
          <Textarea
            value={text}
            onChange={(e) => analyse(e.target.value)}
            placeholder="player,team,opponent,market,line,app,book_line,over_odds,under_odds…"
            className="min-h-72 font-mono text-[11px] leading-relaxed"
            spellCheck={false}
          />
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="label" className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Slate name
            </Label>
            <Input
              id="label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Tuesday main slate"
              className="font-mono text-xs"
            />
          </div>

          {result ? (
            <div className="space-y-3 rounded-lg border border-border/60 bg-card/40 p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Parsed</span>
                <Badge variant="outline" className="font-mono text-[10px]">{result.format.toUpperCase()}</Badge>
              </div>

              <div className="flex items-center gap-2">
                {result.rows.length > 0 ? (
                  <CheckCircle2 className="size-3.5 text-primary" />
                ) : (
                  <TriangleAlert className="size-3.5 text-destructive" />
                )}
                <span className="font-mono tabular-nums">{result.rows.length} lines read</span>
              </div>

              {preview ? (
                <p className="leading-relaxed text-muted-foreground">
                  {preview.priced} can be priced.
                  {preview.dropped > 0 ? (
                    <>
                      {" "}
                      {preview.dropped} carry no odds, projection or form data, so they are dropped rather than turned
                      into a made-up coin flip.
                    </>
                  ) : null}
                </p>
              ) : null}

              {result.skipped.length > 0 ? (
                <div className="space-y-1">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-destructive">
                    {result.skipped.length} unreadable
                  </div>
                  <ul className="space-y-1 text-[11px] text-muted-foreground">
                    {result.skipped.slice(0, 5).map((s, i) => (
                      <li key={i} className="truncate">
                        Line {s.line}: {s.reason}
                      </li>
                    ))}
                    {result.skipped.length > 5 ? <li>and {result.skipped.length - 5} more</li> : null}
                  </ul>
                </div>
              ) : null}

              {result.unmapped.length > 0 ? (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Ignored columns: {result.unmapped.slice(0, 8).join(", ")}
                  {result.unmapped.length > 8 ? "…" : ""}
                </p>
              ) : null}

              <Button className="w-full" disabled={result.rows.length === 0} onClick={commit}>
                Load {result.rows.length} lines
              </Button>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border/60 p-4 text-xs leading-relaxed text-muted-foreground">
              Paste data or load the worked example to see what will be read before anything replaces your current
              slate.
            </p>
          )}

          {state.slate ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Current slate: {state.slate.label} with {state.slate.rows.length} lines. Loading a new one replaces it.
              Entries you have already logged in the tracker are kept.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
