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

export interface OcrBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface OcrLine {
  text: string
  /** 0-100 from the OCR engine, when available. */
  confidence?: number
  /**
   * Where the line sits in the image, when it came from OCR. Typed text has
   * none. With it, a stat is paired to the name beside or above it on screen;
   * without it, to the nearest name in reading order.
   */
  bbox?: OcrBox
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
  // Other phrasings the boards print. "Blocked Shots" matters most: missing
  // from this list, it reads as a two-word name and gets pinned to the wrong
  // player's line.
  "blocked shots", "blocked shot", "3-pointers", "3 pointers", "three pointers", "3pt", "3pm",
  "fg made", "ft made", "free throws", "fantasy pts", "stls+blks", "reb+asts", "pts+asts",
]

/** Words that look like names to a regex but never are. */
const NOT_NAMES = new Set([
  "higher", "lower", "more", "less", "over", "under", "final", "live", "today", "tonight",
  "power", "flex", "play", "entry", "lineup", "picks", "pick", "board", "all", "sports",
  "nba", "wnba", "nfl", "mlb", "nhl", "ncaa", "quick", "demon", "goblin", "boost", "boosted",
  "my", "promo", "special", "combo", "vs", "at", "home", "away", "projection", "proj",
])

const TEAM_CODES = new Set([
  // NBA
  "atl","bos","bkn","bkl","cha","chi","cle","dal","den","det","gsw","hou","ind","lac","lal",
  "mem","mia","mil","min","nop","nyk","okc","orl","phi","phx","por","sac","sas","tor","uta","was",
  // WNBA codes that are not already NBA codes
  "lva","lv","nyl","ny","sea","con","conn","las","la","gsv",
])

// Single positions plus the combined tags boards print, such as "G/F" or "F-C",
// which reach here with the separator stripped.
const POSITIONS = new Set(["pg", "sg", "sf", "pf", "c", "g", "f", "gf", "fg", "fc", "cf", "gc"])

/** Direction words a person might type beside a line. Stripped, never a name. */
const SIDE_WORDS = new Set(["over", "under", "o", "u", "ov", "un", "more", "less", "higher", "lower"])

/** Tokens that separate parts of a typed line and carry no meaning of their own. */
const SEPARATOR = /^[-\u2013\u2014:|\u2022\u00b7,/]+$/

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

/**
 * Drop tokens with no letters or digits from the ends of a line.
 *
 * OCR on dark cards often picks up a stray "." or "|" from a card edge, turning
 * "Caitlin Clark" into "Caitlin Clark ." That then fails an exact name match
 * against the odds feed, so the prop silently never prices.
 */
function trimNoise(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean)
  while (words.length > 0 && !/[A-Za-z0-9]/.test(words[0])) words.shift()
  while (words.length > 0 && !/[A-Za-z0-9]/.test(words[words.length - 1])) words.pop()
  return words.join(" ")
}

/**
 * Could this be a player name?
 *
 * Strict mode is for OCR lines, where a board capitalises names and a stray
 * capitalised word is the main source of false positives. Lenient mode is for a
 * line someone typed, where "lebron james" is obviously a name and one word
 * ("Jokic") is common enough to accept, flagged for review.
 */
function looksLikeName(text: string, opts: { lenient?: boolean } = {}): boolean {
  const t = trimNoise(text)
  if (t.length < (opts.lenient ? 3 : 4) || t.length > 40) return false
  if (/\d/.test(t)) return false
  const words = t.split(/\s+/).filter(Boolean)
  if (words.length < (opts.lenient ? 1 : 2) || words.length > 4) return false
  for (const w of words) {
    const bare = w.replace(/[^A-Za-z.'-]/g, "")
    if (bare.length === 0) return false
    const lower = bare.toLowerCase().replace(/[.'-]/g, "")
    if (lower.length === 0) return false
    if (NOT_NAMES.has(lower)) return false
    if (TEAM_CODES.has(lower)) return false
    if (POSITIONS.has(lower)) return false
    if (SIDE_WORDS.has(lower)) return false
    // Names are capitalised on these boards; typed input may not be.
    if (!opts.lenient && bare[0] !== bare[0].toUpperCase()) return false
  }
  return true
}

function isNameLine(text: string): boolean {
  return looksLikeName(text)
}

/**
 * "lebron james" -> "Lebron James", leaving already-capitalised names alone.
 * Strips punctuation a typed separator leaves on the last word ("James:"), but
 * not a full stop, which belongs to "Jr." and "P.J.".
 */
function tidyName(text: string): string {
  const t = trimNoise(text).replace(/[:;,|]+$/, "")
  if (t !== t.toLowerCase()) return t
  return t.replace(/\b([a-z])/g, (m) => m.toUpperCase())
}

/** A standalone line value, allowing a typed "o24.5" or "u8.5" prefix. */
function valueToken(tok: string): number | null {
  const m = tok.match(/^[ou]?(\d{1,2}(?:\.\d)?)$/i)
  if (!m) return null
  const v = Number.parseFloat(m[1])
  return Number.isFinite(v) ? v : null
}

function stripSides(tokens: string[]): string[] {
  return tokens.filter((t) => !SIDE_WORDS.has(t.toLowerCase()))
}

/**
 * The player in the text before a line value, if there is one.
 *
 * Takes the whole prefix when it reads as a name. Otherwise takes the longest
 * run of two to four name-like words at its end, so "Tue Sep 26 Anthony
 * Edwards" still yields the player. A matchup such as "IND vs CON 7:00PM"
 * yields nothing, which is right: its name is on the row above.
 */
function nameFromPrefix(prefix: string): string | null {
  if (!prefix) return null
  if (looksLikeName(prefix, { lenient: true })) return prefix
  const words = prefix.split(/\s+/).filter(Boolean)
  for (let k = Math.min(4, words.length - 1); k >= 2; k--) {
    const tail = words.slice(words.length - k).join(" ")
    if (looksLikeName(tail, { lenient: true })) return tail
  }
  return null
}

interface InlineMatch {
  value: number
  stat: { label: string; key: MarketKey | null }
  statText: string
  /** Whatever precedes the value and stat, cleaned: a name, a matchup, or nothing. */
  prefix: string
}

/**
 * Find a line value and a stat inside one line.
 *
 * Covers the layouts that put both on a single row:
 *   "24.5 Points"                        stacked boards, value then stat
 *   "LeBron James 24.5 Points"           typed, name first
 *   "LeBron James over 24.5 points"      typed with a direction
 *   "LeBron James o24.5 pts"             shorthand
 *   "LeBron James: Points 24.5"          stat before value
 *   "IND vs CON 7:00PM 8.5 Assists"      a list board whose right-aligned value
 *                                        OCR fuses onto the matchup line
 */
function findInline(text: string): InlineMatch | null {
  const tokens = trimNoise(text)
    .split(/[\s,;]+/)
    .filter((t) => t.length > 0 && !SEPARATOR.test(t))
  if (tokens.length === 0) return null

  for (let i = 0; i < tokens.length; i++) {
    const value = valueToken(tokens[i])
    if (value == null) continue

    // Value then stat: "24.5 Points", "LeBron James 24.5 Pts + Rebs + Asts".
    const after = stripSides(tokens.slice(i + 1))
    if (after.length > 0) {
      const statText = after.join(" ")
      const stat = isStatLine(statText)
      if (stat) {
        return { value, stat, statText, prefix: stripSides(tokens.slice(0, i)).join(" ") }
      }
    }

    // Stat then value: "LeBron James Points 24.5". Try the longest stat suffix.
    const before = stripSides(tokens.slice(0, i))
    for (let k = Math.min(5, before.length); k >= 1; k--) {
      const statText = before.slice(before.length - k).join(" ")
      const stat = isStatLine(statText)
      if (stat) {
        return { value, stat, statText, prefix: before.slice(0, before.length - k).join(" ") }
      }
    }
  }
  return null
}

interface Classified {
  index: number
  text: string
  confidence: number
  /** "prop" is a whole prop on one line: name, value and stat together. */
  kind: "prop" | "name" | "stat" | "number" | "noise"
  stat?: { label: string; key: MarketKey | null }
  statText?: string
  number?: { value: number; repaired: boolean }
  name?: string
  bbox?: OcrBox
}

function classify(lines: OcrLine[]): Classified[] {
  return lines.map((l, index) => {
    const text = trimNoise(l.text)
    const confidence = (l.confidence ?? 80) / 100
    const bbox = l.bbox

    const inline = findInline(text)
    if (inline) {
      const number = { value: inline.value, repaired: false }
      const player = nameFromPrefix(inline.prefix)
      if (player) {
        return {
          index, text, confidence, bbox, kind: "prop" as const,
          stat: inline.stat, statText: inline.statText, number, name: tidyName(player),
        }
      }
      // Value and stat but no name on this line: a stacked card, or a list row
      // whose matchup text got fused on. The name comes from a nearby line.
      return { index, text, confidence, bbox, kind: "stat" as const, stat: inline.stat, statText: inline.statText, number }
    }

    const stat = isStatLine(text)
    if (stat) {
      // A stat line may still carry an OCR-damaged number, e.g. "24.S Points".
      const numMatch = text.match(/^([\d.,OolIS|s]{1,5})\s+/)
      const number = numMatch ? parseLineValue(numMatch[1]) : null
      return { index, text, confidence, bbox, kind: "stat" as const, stat, number: number ?? undefined }
    }
    const num = parseLineValue(text)
    if (num) return { index, text, confidence, bbox, kind: "number" as const, number: num }
    if (isNameLine(text)) return { index, text, confidence, bbox, kind: "name" as const, name: trimNoise(text) }
    return { index, text, confidence, bbox, kind: "noise" as const }
  })
}

const cy = (b: OcrBox) => (b.y0 + b.y1) / 2
const overlapsX = (a: OcrBox, b: OcrBox) => a.x0 < b.x1 && b.x0 < a.x1

/**
 * The best line of a kind for a stat, judged by position on screen.
 *
 * Candidates must sit above or level with the stat, never below it, and within
 * a few card-heights. The one in the same column wins; failing that, the
 * closest one vertically. That handles both layouts that broke order-based
 * pairing:
 *
 *   Two-column grid: a stat has a name above it in its own column and another,
 *   equally high, in the other column. Same-column wins.
 *
 *   List with right-aligned values: the value sits level with its name but in
 *   a different column, and AUTO segmentation emits all the values after all
 *   the names. Nearest-above wins, and "below" is ruled out, so the value can
 *   never reach down to the next player.
 */
function pickByPosition(
  items: Classified[],
  stat: Classified,
  kind: "name" | "number",
  used: Set<number>,
  lineHeight: number,
  maxLines: number,
): number | null {
  const box = stat.bbox
  if (!box) return null
  const statCy = cy(box)

  const inRange = items.filter((c) => {
    if (c.kind !== kind || used.has(c.index) || !c.bbox) return false
    if (cy(c.bbox) > box.y1) return false // below the stat
    return statCy - cy(c.bbox) <= maxLines * lineHeight // not too far above
  })

  // Same column is a hard rule, not a preference. A soft penalty got tuned
  // wrong: in a grid, the name sits five lines up its own card, and a stray
  // capitalised label level with the stat in the next column scored closer.
  // Only when nothing in range shares the stat's column, as on a list board
  // with right-aligned values, does position across columns decide.
  const sameColumn = inRange.filter((c) => overlapsX(c.bbox!, box))
  const pool = sameColumn.length > 0 ? sameColumn : inRange

  let best: number | null = null
  let bestDy = Infinity
  for (const c of pool) {
    const dy = Math.max(0, statCy - cy(c.bbox!))
    if (dy < bestDy) {
      bestDy = dy
      best = c.index
    }
  }
  return best
}

function medianLineHeight(items: Classified[]): number {
  const hs = items.flatMap((i) => (i.bbox ? [i.bbox.y1 - i.bbox.y0] : [])).sort((a, b) => a - b)
  return hs.length > 0 ? Math.max(1, hs[Math.floor(hs.length / 2)]) : 1
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

  // Whole props on one line need no neighbours.
  for (const item of items) {
    if (item.kind !== "prop" || !item.stat || !item.number || !item.name) continue
    const issues: string[] = []
    if (!item.stat.key) issues.push(`Stat "${item.statText}" was not recognised.`)
    if (!item.name.includes(" ")) {
      issues.push("Only one name was given. Use the full name, or the odds feed cannot match it.")
    }
    used.add(item.index)
    candidates.push({
      player: item.name,
      marketKey: item.stat.key,
      marketLabel: item.stat.label,
      rawMarket: item.statText ?? item.text,
      line: item.number.value,
      confidence: Math.max(0.05, Math.min(1, item.confidence - issues.length * 0.15)),
      sourceLines: [item.index],
      issues,
    })
  }

  // Pair by position when OCR supplied it for every line; otherwise by order.
  const geometric = items.length > 0 && items.every((i) => i.bbox)
  const lineHeight = geometric ? medianLineHeight(items) : 1

  for (const item of items) {
    if (item.kind !== "stat" || !item.stat) continue

    const issues: string[] = []
    const sourceLines = [item.index]

    // Number: on the stat line itself, else the closest unused number within
    // two lines either side, preferring the one before.
    let number = item.number ?? null
    if (!number && geometric) {
      const i = pickByPosition(items, item, "number", used, lineHeight, 3)
      if (i != null) {
        number = items[i].number!
        used.add(i)
        sourceLines.push(i)
      }
    }
    if (!number && !geometric) {
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

    // Name: by position when available, else nearest unused name above, then below.
    let name: string | null = null
    if (geometric) {
      const i = pickByPosition(items, item, "name", used, lineHeight, 8)
      if (i != null) {
        name = items[i].name ?? items[i].text
        used.add(i)
        sourceLines.push(i)
      }
    }
    for (let i = item.index - 1; !geometric && !name && i >= Math.max(0, item.index - 5); i--) {
      const c = items[i]
      if (c && c.kind === "name" && !used.has(i)) {
        name = c.name ?? c.text
        used.add(i)
        sourceLines.push(i)
        break
      }
    }
    if (!name && !geometric) {
      for (let i = item.index + 1; i <= Math.min(items.length - 1, item.index + 3); i++) {
        const c = items[i]
        if (c && c.kind === "name" && !used.has(i)) {
          name = c.name ?? c.text
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
      rawMarket: item.statText ?? item.text,
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
