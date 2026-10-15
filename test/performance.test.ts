import { describe, expect, it } from "vitest"
import { buildDailyPicks } from "@/lib/today/build"
import type { FeedQuote } from "@/lib/quant/valuebets"
import { DEFAULT_SETTINGS } from "@/lib/store/schema"
import { DEFAULT_CORRELATION } from "@/lib/quant/correlation"

/**
 * A full football Sunday has to price in about a second.
 *
 * The NFL tab once froze the page for thirty to forty seconds on this slate:
 * inverting each book's price into a mean rebuilt a thousand-outcome yardage
 * distribution from logGamma at every step of a bisection, and every
 * leave-one-out consensus did it again for the same prices. The budget below is
 * many times what the build needs today, so a slow CI runner passes it, and a
 * fraction of what it took before, so that cost coming back fails it.
 */

const BOOKS = ["pinnacle", "betonlineag", "lowvig", "draftkings", "fanduel", "betmgm", "caesars", "espnbet"]
const NOW = Date.parse("2026-10-18T15:00:00Z")
const KICK = "2026-10-18T17:00:00Z"

/** Deterministic, letters-only names: the name matcher drops digits. */
function nameOf(id: number): string {
  const letters = (n: number) => {
    let s = ""
    do {
      s = String.fromCharCode(97 + (n % 26)) + s
      n = Math.floor(n / 26)
    } while (n > 0)
    return s
  }
  const a = letters(id * 7 + 3)
  const b = letters(id * 13 + 11)
  return `${a[0].toUpperCase()}${a.slice(1)}o ${b[0].toUpperCase()}${b.slice(1)}son`
}

/** Two quarterbacks, three backs and eight receivers a game, posted by up to eight books. */
function footballSunday(games: number): FeedQuote[] {
  let seed = 12345
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const roster: [number, [FeedQuote["market"], number][]][] = [
    [2, [["PASS_YDS", 235], ["RUSH_YDS", 18]]],
    [3, [["RUSH_YDS", 55], ["REC", 2.5], ["REC_YDS", 18]]],
    [8, [["REC", 4], ["REC_YDS", 45]]],
  ]
  const out: FeedQuote[] = []
  let id = 1
  for (let g = 0; g < games; g++) {
    const gameId = `Away${g}@Home${g}`
    for (const [count, markets] of roster) {
      for (let p = 0; p < count; p++) {
        const player = nameOf(id++)
        for (const [market, typical] of markets) {
          const line = Math.max(0.5, Math.round(typical * (0.6 + rnd() * 0.8)) + 0.5)
          for (const book of BOOKS) {
            if (rnd() < 0.15) continue
            const shift = rnd() < 0.2 ? (rnd() < 0.5 ? -1 : 1) : 0
            const skew = Math.round((rnd() - 0.5) * 40)
            out.push({
              book, line: Math.max(0.5, line + shift), overOdds: -110 + skew, underOdds: -110 - skew,
              fetchedAt: KICK, player, market, gameId, homeTeam: `Home${g}`, awayTeam: `Away${g}`, commenceTime: KICK,
            })
          }
        }
      }
    }
  }
  return out
}

describe("pricing a full slate", () => {
  it("builds a fourteen-game NFL Sunday well inside the budget", () => {
    const s = DEFAULT_SETTINGS
    const quotes = footballSunday(14)
    const started = performance.now()
    const picks = buildDailyPicks(quotes, {
      value: {
        projection: { ...s.projection, league: "nfl" },
        minEdge: s.daily.minEdge,
        suspiciousEdge: 0.12,
        requireSharpReference: s.daily.requireSharpReference,
        maxAmerican: 400,
        commission: {},
      },
      correlation: s.correlation ?? DEFAULT_CORRELATION,
      constraints: { ...s.constraints, picks: s.daily.parlayLegs },
      dfsBreakEven: 0.56,
      pickemMaxProb: s.daily.pickemMaxProb,
      parlayCount: 4,
      bettableBooks: s.oddsFeed.bettable,
      now: NOW,
    })
    const elapsed = performance.now() - started
    expect(picks.stats.props).toBeGreaterThan(400)
    expect(picks.stats.pricedProps).toBeGreaterThan(400)
    // About one second here; thirty before.
    expect(elapsed).toBeLessThan(10_000)
  }, 60_000)
})
