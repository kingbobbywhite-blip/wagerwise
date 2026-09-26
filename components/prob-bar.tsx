import { cn } from "@/lib/utils"

/** Horizontal probability meter with a break-even marker. */
export function ProbBar({ value, breakEven, className }: { value: number; breakEven?: number; className?: string }) {
  const pctValue = Math.max(0, Math.min(1, value)) * 100
  const good = breakEven == null || value >= breakEven
  return (
    <div className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-secondary", className)}>
      <div
        className={cn("h-full rounded-full transition-all", good ? "bg-primary" : "bg-muted-foreground/60")}
        style={{ width: `${pctValue}%` }}
      />
      {breakEven != null ? (
        <div
          className="absolute top-0 h-full w-px bg-accent"
          style={{ left: `${Math.max(0, Math.min(1, breakEven)) * 100}%` }}
          aria-hidden
        />
      ) : null}
    </div>
  )
}
