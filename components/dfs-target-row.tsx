"use client"

import * as React from "react"
import { Input } from "@/components/ui/input"
import { SideBadge } from "@/components/side-badge"
import { dfsVerdict, type DfsTarget } from "@/lib/today/build"

/**
 * One pick'em target: type the line your app is showing and get one answer.
 *
 * The thresholds stay visible as a rule ("over at 9.5 or lower, under at 16.5
 * or higher"), but never as two picks side by side, which is how both sides of
 * one prop ended up in two entries.
 */
export function DfsTargetRow({ t }: { t: DfsTarget }) {
  const [line, setLine] = React.useState("")
  const value = Number.parseFloat(line)
  const verdict = line.trim() === "" ? null : dfsVerdict(t, value)

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
      </td>
      <td className="px-3 py-2 font-mono text-xs">{t.marketLabel}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">
        {t.mean.toFixed(1)}
        <span className="ml-1 text-[10px] text-muted-foreground">±{t.sd.toFixed(1)}</span>
        <div className="text-[10px] text-muted-foreground">fair {t.fairLine}</div>
      </td>
      <td className="px-3 py-2">
        <Input
          inputMode="decimal"
          value={line}
          onChange={(e) => setLine(e.target.value)}
          placeholder={String(t.fairLine)}
          className="h-7 w-20 font-mono text-xs"
          aria-label={`Line your app shows for ${t.player} ${t.marketLabel}`}
        />
      </td>
      <td className="px-3 py-2">
        {verdict == null ? (
          <span className="font-mono text-[10px] text-muted-foreground">{rule}; pass between</span>
        ) : verdict === "PASS" ? (
          <span className="font-mono text-xs text-muted-foreground">Pass: neither side clears at {value}</span>
        ) : (
          <span className="flex items-center gap-1.5">
            <SideBadge side={verdict} />
            <span className="font-mono text-xs">only</span>
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">{t.confidence}</td>
    </tr>
  )
}
