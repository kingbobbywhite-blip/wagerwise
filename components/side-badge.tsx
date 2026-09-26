import { cn } from "@/lib/utils"

export function SideBadge({ side, className }: { side: "OVER" | "UNDER"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ring-1",
        side === "OVER"
          ? "bg-primary/10 text-primary ring-primary/30"
          : "bg-accent/10 text-accent ring-accent/30",
        className,
      )}
    >
      {side}
    </span>
  )
}
