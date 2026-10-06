"use client"

import * as React from "react"
import { Input } from "@/components/ui/input"
import { SideBadge } from "@/components/side-badge"
import { pct, possessive } from "@/lib/format"
import { DEFAULT_APPS, findApp } from "@/lib/quant/payouts"
import { appVerdict, dfsVerdict, probAt, type AppLine, type DfsTarget } from "@/lib/today/build"

/** "PrizePicks 24.5 over 58%", or the flavour and multiplier when the pick is not standard. */
function describeAppLine(l: AppLine): string {
  const name = findApp(DEFAULT_APPS, l.app)?.name ?? l.app
  const flavour = l.pickType === "standard" ? "" : ` ${l.pickType}`
  const sides: string[] = []
  if (l.overOffered) sides.push(`over ${pct(l.over, 0)}${l.overMultiplier != null ? ` ×${l.overMultiplier}` : ""}`)
  if (l.underOffered) sides.push(`under ${pct(l.under, 0)}${l.underMultiplier != null ? ` ×${l.underMultiplier}` : ""}`)
  return `${name}${flavour} ${l.line}: ${sides.join(", ")}`
}

/**
 * One pick'em target: type the line your app is showing and get one answer.
 *
 * The thresholds stay visible as a rule ("over at 9.5 or lower, under at 16.5
 * or higher"), but never as two picks side by side, which is how both sides of
 * one prop ended up in two entries.
 *
 * When the pull carried the default app's own line, it is filled in, and the
 * answer follows the entry's rule: only a side the app offers as a standard
 * pick is named, so a discounted Underdog side reads as a pass with its reason.
 * Typing a different number still overrides it.
 */
export function DfsTargetRow({ t, bar, app }: { t: DfsTarget; bar: number; app?: string | null }) {
  const atApp = app ? appVerdict(t, app, bar) : null
  const [typed, setTyped] = React.useState<string | null>(null)
  const fromApp = typed == null && atApp != null
  const line = typed ?? (atApp ? String(atApp.line) : "")
  const value = Number.parseFloat(line)
  const verdict = fromApp
    ? (atApp.side ?? "PASS")
    : line.trim() === ""
      ? null
      : dfsVerdict(t, value)
  // The ladder holds only half-point lines; on a whole number the app line
  // priced at that exact number (push included) has the chance.
  const atThisLine = t.appLines?.find((l) => l.app === app && Math.abs(l.line - value) < 1e-9)
  const chance = fromApp
    ? atApp.prob
    : verdict && verdict !== "PASS"
      ? (probAt(t, value, verdict) ?? (atThisLine ? (verdict === "OVER" ? atThisLine.over : atThisLine.under) : null))
      : null
  const passReason = fromApp && atApp.reason ? atApp.reason : `neither side clears at ${value}`

  const rule = [
    t.overAt != null ? `over if ${t.overAt} or lower` : null,
    t.underAt != null ? `under if ${t.underAt} or higher` : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <tr className="border-b border-border/40 last:border-0 hover:bg-card/40">
      <td className="px-3 py-2">
        <div className="font-medium leading-tight">{t.player}</div>
        <div className="font-mono text-[10px] text-muted-foreground">{t.gameId.replace("@", " at ")}</div>
        {t.appLines && t.appLines.length > 0 ? (
          <ul className="mt-1 space-y-0.5 font-mono text-[10px] text-muted-foreground">
            {t.appLines.map((l) => (
              <li key={`${l.app}|${l.line}|${l.pickType}`} className={l.app === app ? "text-foreground/80" : undefined}>
                {describeAppLine(l)}
              </li>
            ))}
          </ul>
        ) : null}
      </td>
      <td className="px-3 py-2 font-mono text-xs">{t.marketLabel}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">
        {t.mean.toFixed(1)}
        <span className="ml-1 text-[10px] text-muted-foreground">±{t.sd.toFixed(1)}</span>
        <div className="text-[10px] text-muted-foreground">fair {t.fairLine}</div>
      </td>
      <td className="px-3 py-2">
        {/* Below the bar, neither side is a pick'em play, so no side is shown:
            a 52% "under" here beside a sportsbook's priced "over" read as two picks. */}
        {t.marketProb >= bar ? (
          <div className="flex items-center gap-1.5">
            <SideBadge side={t.marketSide} />
            <span className="font-mono text-xs tabular-nums">{pct(t.marketProb, 0)}</span>
          </div>
        ) : (
          <div className="font-mono text-xs text-muted-foreground">Pass · {pct(t.marketProb, 0)} at most</div>
        )}
        <div className="font-mono text-[10px] text-muted-foreground">at the books&apos; {t.marketLine}</div>
      </td>
      <td className="px-3 py-2">
        <Input
          inputMode="decimal"
          value={line}
          onChange={(e) => setTyped(e.target.value.trim() === "" ? null : e.target.value)}
          placeholder={String(t.marketLine)}
          className="h-7 w-20 font-mono text-xs"
          aria-label={`Line your app shows for ${t.player} ${t.marketLabel}`}
        />
        {fromApp ? (
          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
            {possessive(findApp(DEFAULT_APPS, app!)?.name ?? app!)} line
          </div>
        ) : null}
      </td>
      <td className="px-3 py-2">
        {verdict == null ? (
          <span className="font-mono text-[10px] text-muted-foreground">{rule}; pass between</span>
        ) : verdict === "PASS" ? (
          <span className="font-mono text-xs text-muted-foreground">Pass: {passReason}</span>
        ) : (
          <span className="flex items-center gap-1.5">
            <SideBadge side={verdict} />
            <span className="font-mono text-xs">only{chance != null ? ` · ${pct(chance, 0)}` : ""}</span>
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">{t.confidence}</td>
    </tr>
  )
}
