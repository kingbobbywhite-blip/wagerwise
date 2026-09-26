import Link from "next/link"
import { Button } from "@/components/ui/button"

export function EmptyState({
  title,
  body,
  actionLabel,
  actionHref,
}: {
  title: string
  body: string
  actionLabel?: string
  actionHref?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-card/30 px-6 py-16 text-center">
      <h2 className="font-mono text-sm uppercase tracking-[0.14em] text-muted-foreground">{title}</h2>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">{body}</p>
      {actionLabel && actionHref ? (
        <Button asChild className="mt-6">
          <Link href={actionHref}>{actionLabel}</Link>
        </Button>
      ) : null}
    </div>
  )
}
