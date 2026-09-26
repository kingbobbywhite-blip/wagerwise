"use client"

import { TriangleAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { SideBadge } from "@/components/side-badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { formatAmerican } from "@/lib/quant/odds"
import { recommendStake } from "@/lib/quant/staking"
import type { ValueBet } from "@/lib/quant/valuebets"
import type { BankrollSettings } from "@/lib/store/schema"
import { money, pct, signedPct } from "@/lib/format"
import { cn } from "@/lib/utils"

export function ValueBetRow({ bet, bankroll }: { bet: ValueBet; bankroll: BankrollSettings }) {
  const advice = recommendStake(bet.kelly, bankroll)
  const suspicious = bet.warnings.some((w) => w.includes("larger than these markets normally offer"))

  return (
    <tr className={cn("border-b border-border/40 last:border-0 hover:bg-card/40", suspicious && "opacity-70")}>
      <td className="px-3 py-2">
        <div className="font-medium leading-tight">{bet.player}</div>
        <div className="font-mono text-[10px] text-muted-foreground">{bet.gameId.replace("@", " at ")}</div>
      </td>
      <td className="px-3 py-2 font-mono text-xs">{bet.marketLabel}</td>
      <td className="px-3 py-2">
        <Badge
          variant="outline"
          className={cn(
            "h-4 px-1 py-0 font-mono text-[9px]",
            bet.bookTier === "retail" ? "text-accent" : "border-primary/40 text-primary",
          )}
        >
          {bet.bookName}
        </Badge>
      </td>
      <td className="px-3 py-2">
        <SideBadge side={bet.side} />
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{bet.line}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{formatAmerican(bet.price)}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
        {formatAmerican(bet.fairPrice)}
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">{pct(bet.fairProb)}</td>
      <td className={cn("px-3 py-2 text-right font-mono tabular-nums", suspicious ? "text-accent" : "text-primary")}>
        {signedPct(bet.edge)}
        {suspicious ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <TriangleAlert className="ml-1 inline size-3" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">{bet.warnings[0]}</TooltipContent>
          </Tooltip>
        ) : null}
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{money(advice.stake)}</td>
    </tr>
  )
}
