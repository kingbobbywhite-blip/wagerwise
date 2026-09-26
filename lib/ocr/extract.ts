import { normalizeMarket, type MarketKey } from "@/lib/nba/markets"

/**
 * Turn OCR text from a DFS board screenshot into candidate props.
 *
 * This exists instead of scraping. Scraping a pick'em app's endpoints is against
 * their terms and gets accounts restricted, and the board is the half of the
 * data that carries no signal anyway: it tells you what is on offer, not what it
 * is worth. Reading your own screen is the honest way to get the offer side in.
 *
 * Nothing here is trusted. Every candidate lands in a review table where a human
 * confirms or corrects it before it becomes a prop, because OCR on a dense
 * mobile screenshot is wrong often enough that silently accepting it would
 * quietly poison the whole board.
 */

export interface OcrLine {
  text: string
  /** 0-100 from the OCR engine, when available. */
  confidence?: number
}

export interface PropCandidate {
  player: string
  marketKey: MarketKey | null
  marketLabel: string
  rawMarket: string
  line: number
  /** 0-1, how much of the candidate was read cleanly. */
  confidence: number
  /** Source line indices, so the review table can show the context. */
  sourceLines: number[]
  issues: string[]
}

export interface ExtractResult {
  candidates: PropCandidate[]
  /** Lines the extractor could not place, for the review screen. */
  leftover: { index: number; text: string }[]
}

const STAT_WORDS = [
  "points", "pts", "rebounds", "rebs", "reb", "assists", "ast", "asts",
  "3-pointers made", "3 pointers made", "three pointers made", "3-pt made", "3pt made", "threes",
  "steals", "stl", "blocks", "blk", "turnovers", "tov",
  "pts+rebs+asts", "pts+reb+ast", "points+rebounds+assists", "pra",
  "pts+rebs", "pts+reb", "pts+asts", "pts+ast", "rebs+asts", "reb+ast",
  "blks+stls", "blocks+steals", "steals+blocks", "stocks",
  "fantasy score", "fantasy points",
  "free throws made", "ftm", "field goals made", "fgm",
  "3-pointers attempted", "minutes",
]

/** Words that look like names to a regex but never are. */
const NOT_NAMES = new Set([
  "higher", "lower", "more", "less", "over", "under", "final", "live", "today", "tonight",
  "power", "flex", "play", "entry", "lineup", "picks", "pick", "board", "all", "sports",
  "nba", "wnba", "nfl", "mlb", "nhl", "ncaa", "quick", "demon", "goblin", "boost", "boosted",
  "my", "promo", "special", "combo", "vs", "at", "home", "away", "projection", "proj",
])

const TEAM_CODES = new Set([
  "atl","bos","bkn","bkl","cha","chi","cle","dal","den","det","gsw","hou","ind","lac","lal",
  "mem","mia","mil","min","nop","nyk","okc","orl","phi","phx","por","sac","sas","tor","uta","was",
])

const POSITIONS = new Set(["pg", "sg", "sf", "pf", "c", "g", "f"])

/**
 * Common OCR confusions in numbers. Applied only to strings that are otherwise
 * numeric, so a name containing an O is never mangled.
 */
function repairNumeric(raw: string): string {
  return raw
    .replace(/[Oo]/g, "0")
    .replace(/[lI|]/g, "1")
    .replace(/[Ss]/g, "5")
    .replace(/[,]/g, ".")
    .replace(/\s+/g, "")
}

/** Extract a plausible prop line from a fragment. */
export function parseLineValue(raw: string): { value: number; repaired: boolean } | null {
  const t = raw.trim()
  if (!t) return null

  const direct = t.match(/^(\d{1,2}(?:\.\d)?)$/)
  if (direct) {
    const v = Number.parseFloat(direct[1])
    return Number.isFinite(v) ? { value: v, repaired: false } : null
  }

  const looksNumeric = /^[\d.,OolIS|s]{1,5}$/.test(t)
  if (looksNumeric) {
    const fixed = repairNumeric(t)
    const m = fixed.match(/^(\d{1,2}(?:\.\d)?)$/)
    if (m) {
      const v = Number.parseFloat(m[1])
      if (Number.isFinite(v)) return { value: v, repaired: fixed !== t }
    }
  }
  return null
}

function isStatLine(text: string): { label: string; key: MarketKey | null } | null {
  const lower = text.toLowerCase().trim().replace(/\s+/g, " ")
  if (!lower) return null
  // Strip a leading number so "24.5 Points" is recognised as a stat line.
  const withoutNumber = lower.replace(/^[\d.,ols|]+\s+/, "").trim()
  for (const candidate of [lower, withoutNumber]) {
    if (!candidate) continue
    if (STAT_WORDS.some((w) => candidate === w || candidate.startsWith(w + " ") || candidate === w + "s")) {
      const norm = normalizeMarket(candidate)
      return { label: norm.label, key: norm.key }
    }
  }
  return null
}

function isNameLine(text: string): boolean {
  const t = text.trim()
  if (t.length < 4 || t.length > 40) return false
  if (/\d/.test(t)) return false
  const words = t.split(/\s+/).filter(Boolean)
  if (words.length < 2 || words.length > 4) return false
  for (const w of words) {
    const bare = w.replace(/[^A-Za-z.'-]/g, "")
    if (bare.length === 0) return false
    const lower = bare.toLowerCase().replace(/[.'-]/g, "")
    if (NOT_NAMES.has(lower)) return false
    if (TEAM_CODES.has(lower)) return false
    if (POSITIONS.has(lower)) return false
    // Names are capitalised on these boards.
    if (bare[0] !== bare[0].toUpperCase()) return false
  }
  return true
}

interface Classified {
  index: number
  text: string
  confidence: number
  kind: "name" | "stat" | "number" | "noise"
  stat?: { label: string; key: MarketKey | null }
  number?: { value: number; repaired: boolean }
}

function classify(lines: OcrLine[]): Classified[] {
  return lines.map((l, index) => {
    const text = l.text.trim()
    const confidence = (l.confidence ?? 80) / 100
    const stat = isStatLine(text)
    if (stat) {
      // A stat line may also carry the number, e.g. "24.5 Points".
      const numMatch = text.match(/^([\d.,OolIS|s]{1,5})\s+/)
      const number = numMatch ? parseLineValue(numMatch[1]) : null
      return { index, text, confidence, kind: "stat" as const, stat, number: number ?? undefined }
    }
    const num = parseLineValue(text)
    if (num) return { index, text, confidence, kind: "number" as const, number: num }
    if (isNameLine(text)) return { index, text, confidence, kind: "name" as const }
    return { index, text, confidence, kind: "noise" as const }
  })
}

/**
 * Associate each detected stat with the nearest number and name.
 *
 * Boards differ in layout: PrizePicks stacks name, meta, number then stat, while
 * others put the number and stat on one line. Rather than encoding one layout,
 * this searches a small window around each stat, which handles both and degrades
 * predictably when the OCR drops a line.
 */
export function extractProps(lines: OcrLine[]): ExtractResult {
  const items = classify(lines)
  const candidates: PropCandidate[] = []
  const used = new Set<number>()

  for (const item of items) {
    if (item.kind !== "stat" || !item.stat) continue

    const issues: string[] = []
    const sourceLines = [item.index]

    // Number: on the stat line itself, else the closest unused number within
    // two lines either side, preferring the one before.
    let number = item.number ?? null
    if (!number) {
      const order = [item.index - 1, item.index + 1, item.index - 2, item.index + 2]
      for (const i of order) {
        const c = items[i]
        if (c && c.kind === "number" && !used.has(i)) {
          number = c.number!
          used.add(i)
          sourceLines.push(i)
          break
        }
      }
    }
    if (!number) {
      issues.push("No line value found near this stat.")
      continue
    }
    if (number.repaired) issues.push("Line value needed character repair; check it.")

    // Name: nearest unused name above, then below.
    let name: string | null = null
    for (let i = item.index - 1; i >= Math.max(0, item.index - 5); i--) {
      const c = items[i]
      if (c && c.kind === "name" && !used.has(i)) {
        name = c.text
        used.add(i)
        sourceLines.push(i)
        break
      }
    }
    if (!name) {
      for (let i = item.index + 1; i <= Math.min(items.length - 1, item.index + 3); i++) {
        const c = items[i]
        if (c && c.kind === "name" && !used.has(i)) {
          name = c.text
          used.add(i)
          sourceLines.push(i)
          break
        }
      }
    }
    if (!name) {
      issues.push("No player name found near this stat.")
      continue
    }

    used.add(item.index)
    if (!item.stat.key) issues.push(`Stat "${item.text}" was not recognised.`)

    const lineConfidences = sourceLines.map((i) => items[i]?.confidence ?? 0.8)
    const base = lineConfidences.reduce((a, b) => a + b, 0) / lineConfidences.length
    const penalty = issues.length * 0.15
    candidates.push({
      player: name,
      marketKey: item.stat.key,
      marketLabel: item.stat.label,
      rawMarket: item.text,
      line: number.value,
      confidence: Math.max(0.05, Math.min(1, base - penalty)),
      sourceLines: sourceLines.sort((a, b) => a - b),
      issues,
    })
  }

  const leftover = items
    .filter((i) => !used.has(i.index) && i.kind !== "noise")
    .map((i) => ({ index: i.index, text: i.text }))

  return { candidates: dedupe(candidates), leftover }
}

/** Boards repeat props across carousels; keep the highest-confidence copy. */
function dedupe(candidates: PropCandidate[]): PropCandidate[] {
  const best = new Map<string, PropCandidate>()
  for (const c of candidates) {
    const key = `${c.player.toLowerCase()}|${c.marketKey ?? c.marketLabel}|${c.line}`
    const existing = best.get(key)
    if (!existing || c.confidence > existing.confidence) best.set(key, c)
  }
  return Array.from(best.values())
}

/** Split raw OCR output into lines the extractor can work with. */
export function linesFromText(text: string): OcrLine[] {
  return text
    .split(/\r?\n/)
    .map((t) => ({ text: t.trim() }))
    .filter((l) => l.text.length > 0)
}
