"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

const LINKS = [
  { href: "/", label: "Today" },
  { href: "/board", label: "Board" },
  { href: "/build", label: "Build" },
  { href: "/import", label: "Capture" },
  { href: "/tracker", label: "Tracker" },
  { href: "/settings", label: "Settings" },
]

export function NavLinks() {
  const pathname = usePathname()
  return (
    // Six links do not fit beside the logo below lg, and a sideways-scrolling
    // row hid Tracker and Settings off the edge of a phone. Below lg the links
    // get their own row, as a 3x2 grid at phone width.
    <nav className="grid w-full grid-cols-3 gap-1 text-sm sm:flex sm:items-center lg:w-auto">
      {LINKS.map((l) => {
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href)
        return (
          <Link
            key={l.href}
            href={l.href}
            className={cn(
              "shrink-0 rounded-md px-2.5 py-1.5 text-center font-mono text-xs uppercase tracking-wider transition-colors md:px-3",
              active
                ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            {l.label}
          </Link>
        )
      })}
    </nav>
  )
}
