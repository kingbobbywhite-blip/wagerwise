import Link from "next/link"
import { Activity } from "lucide-react"
import { NavLinks } from "./nav-links"

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3 md:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary/15 text-primary ring-1 ring-primary/30">
            <Activity className="size-4" aria-hidden />
          </span>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-sm font-semibold tracking-tight">WagerWise</span>
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground sm:inline">
              NBA
            </span>
          </div>
        </Link>
        <NavLinks />
      </div>
    </header>
  )
}
