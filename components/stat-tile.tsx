import { cn } from "@/lib/utils"

export function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
  className,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  tone?: "neutral" | "good" | "bad" | "warn"
  className?: string
}) {
  return (
    <div className={cn("rounded-lg border border-border/60 bg-card/60 px-3 py-2.5", className)}>
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 font-mono text-lg font-semibold tabular-nums",
          tone === "good" && "text-primary",
          tone === "bad" && "text-destructive",
          tone === "warn" && "text-accent",
        )}
      >
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</div> : null}
    </div>
  )
}
