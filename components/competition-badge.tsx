import { Badge } from "@/components/ui/badge"
import { LEAGUES, type LeagueId } from "@/lib/leagues"

/**
 * Marks a row that came from a companion competition, so a college game is
 * never mistaken for an NFL one in a table that holds both. Renders nothing
 * for the section's own league, which needs no label.
 */
export function CompetitionBadge({ competition }: { competition?: LeagueId }) {
  if (!competition || !LEAGUES[competition]?.companionOnly) return null
  return (
    <Badge variant="outline" className="h-4 shrink-0 px-1 py-0 font-mono text-[9px] text-accent">
      {LEAGUES[competition].short}
    </Badge>
  )
}
