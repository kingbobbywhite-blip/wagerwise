import { MARKETS, normalizeMarket, type MarketKey } from "@/lib/nba/markets"
import type { BookQuote, RawPropRow } from "@/lib/quant/projection"
import type { PropCandidate } from "@/lib/ocr/extract"

/**
 * A prop on its way into the slate, before anyone has confirmed it.
 *
 * Both input paths, screenshot and paste, land here. Nothing reaches the board
 * until a human has seen it in the review table, because the two failure modes
 * this app cares most about, a misread line and a mismatched player, both look
 * completely normal once they are downstream.
 */
export interface DraftProp {
  id: string
  player: string
  marketKey: MarketKey | null
  line: number
  team: string | null
  opponent: string | null
  gameId: string | null
  app: string | null
  /** Sportsbook prices attached from the feed. Empty means unpriced. */
  quotes: BookQuote[]
  /** How the row arrived. */
  origin: "screenshot" | "paste"
  /** OCR confidence, or 1 for typed input. */
  confidence: number
  issues: string[]
  /** Set once a human has looked at the row. */
  confirmed: boolean
}

let counter = 0
function nextId(): string {
  counter += 1
  return `draft-${Date.now().toString(36)}-${counter}`
}

export function draftFromCandidate(c: PropCandidate, app: string | null): DraftProp {
  return {
    id: nextId(),
    player: c.player,
    marketKey: c.marketKey,
    line: c.line,
    team: null,
    opponent: null,
    gameId: null,
    app,
    quotes: [],
    origin: "screenshot",
    confidence: c.confidence,
    issues: [...c.issues],
    confirmed: false,
  }
}

export function draftFromRow(row: RawPropRow): DraftProp {
  const norm = normalizeMarket(row.market ?? "")
  const quotes: BookQuote[] = [...(row.quotes ?? [])]
  if (row.overOdds != null || row.underOdds != null) {
    quotes.push({
      book: row.book ?? "unknown",
      line: row.bookLine ?? row.line,
      overOdds: row.overOdds ?? null,
      underOdds: row.underOdds ?? null,
      fetchedAt: null,
    })
  }
  return {
    id: nextId(),
    player: row.player,
    marketKey: norm.key,
    line: row.line,
    team: row.team ?? null,
    opponent: row.opponent ?? null,
    gameId: row.gameId ?? null,
    app: row.app ?? null,
    quotes,
    origin: "paste",
    confidence: 1,
    issues: norm.key ? [] : [`Market "${row.market}" was not recognised.`],
    // Pasted rows carry their own structure, so they are treated as reviewed.
    confirmed: true,
  }
}

export function emptyDraft(app: string | null): DraftProp {
  return {
    id: nextId(),
    player: "",
    marketKey: "PTS",
    line: 0,
    team: null,
    opponent: null,
    gameId: null,
    app,
    quotes: [],
    origin: "paste",
    confidence: 1,
    issues: [],
    confirmed: false,
  }
}

export function draftToRow(d: DraftProp): RawPropRow {
  return {
    player: d.player.trim(),
    team: d.team,
    opponent: d.opponent,
    gameId: d.gameId,
    market: d.marketKey ? MARKETS[d.marketKey].label : "Unknown",
    line: d.line,
    app: d.app,
    quotes: d.quotes,
    source: d.origin,
  }
}

export interface DraftProblem {
  id: string
  message: string
}

/** Blocking problems. A draft with any of these cannot be loaded. */
export function validateDrafts(drafts: DraftProp[]): DraftProblem[] {
  const problems: DraftProblem[] = []
  const seen = new Map<string, string>()

  for (const d of drafts) {
    if (!d.player.trim()) {
      problems.push({ id: d.id, message: "Player name is empty." })
    }
    if (!d.marketKey) {
      problems.push({ id: d.id, message: "Pick a market." })
    }
    if (!Number.isFinite(d.line) || d.line <= 0) {
      problems.push({ id: d.id, message: "Line must be a positive number." })
    }
    if (d.line > 0 && d.marketKey) {
      const typical = MARKETS[d.marketKey].typicalMean
      if (d.line > typical * 5 + 10) {
        problems.push({ id: d.id, message: `A ${d.line} line for ${MARKETS[d.marketKey].label} is implausible.` })
      }
    }
    if (!d.confirmed) {
      problems.push({ id: d.id, message: "Not reviewed yet." })
    }
    const key = `${d.player.trim().toLowerCase()}|${d.marketKey}|${d.line}|${d.app ?? ""}`
    if (seen.has(key)) {
      problems.push({ id: d.id, message: "Duplicate of another row on the same app." })
    } else {
      seen.set(key, d.id)
    }
  }
  return problems
}

export interface DraftSummary {
  total: number
  confirmed: number
  priced: number
  unpriced: number
  blocking: number
}

export function summariseDrafts(drafts: DraftProp[]): DraftSummary {
  const problems = validateDrafts(drafts)
  return {
    total: drafts.length,
    confirmed: drafts.filter((d) => d.confirmed).length,
    priced: drafts.filter((d) => d.quotes.length > 0).length,
    unpriced: drafts.filter((d) => d.quotes.length === 0).length,
    blocking: new Set(problems.map((p) => p.id)).size,
  }
}
