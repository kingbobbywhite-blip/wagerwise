import type { CandidateLeg } from "./optimizer"
import type { PricingStatus, ProjectedProp } from "./projection"
import { normalizeName } from "./correlation"
import { probToAmerican } from "./odds"

/**
 * Slate assembly and line shopping.
 *
 * A player's points prop can be posted at 24.5 on one app and 25.5 on another.
 * That one-point gap is frequently a larger edge than anything a projection
 * model will find, and it is free: the same opinion is simply worth more on the
 * app with the better number.
 *
 * Rows carry a pricing status through to the board. A row with no sportsbook
 * price behind it is shown, because knowing what is on the board is useful, but
 * it is marked unpriced and never becomes a candidate leg.
 */

export interface BoardOffer {
  app: string | null
  line: number
  pOver: number
  pUnder: number
  pPush: number
  source: string | null
  propId: string
  status: PricingStatus
}

export interface BoardRow {
  key: string
  player: string
  team: string | null
  opponent: string | null
  gameId: string | null
  gameTime: string | null
  marketKey: ProjectedProp["marketKey"]
  marketLabel: string

  /** Priced when at least one contributing offer had a sportsbook price. */
  status: PricingStatus
  unpricedReason: string | null
  /**
   * False when no projection exists for this row at all, priced or otherwise.
   * The UI shows dashes rather than numbers, because a placeholder rendered as
   * a probability is worse than an empty cell.
   */
  hasEstimate: boolean

  mean: number
  sd: number
  confidence: number

  /** Books behind the consensus, best first. */
  books: ProjectedProp["books"]
  hasSharpBook: boolean
  bookDisagreement: number
  quoteAgeMinutes: number | null
  isStale: boolean
  holdPct: number | null

  offers: BoardOffer[]
  bestOver: { offer: BoardOffer; pWin: number } | null
  bestUnder: { offer: BoardOffer; pWin: number } | null

  recommended: {
    side: "OVER" | "UNDER"
    offer: BoardOffer
    pWin: number
    fairAmerican: number
    lineEdge: number
    lineEdgeZ: number
  } | null

  lineSpread: number
  shoppingGainPct: number
  warnings: string[]
  sources: ProjectedProp["sources"]
}

function groupKey(p: ProjectedProp): string {
  return `${normalizeName(p.player)}|${p.marketKey ?? p.marketLabel}`
}

export function buildBoard(props: ProjectedProp[]): BoardRow[] {
  const groups = new Map<string, ProjectedProp[]>()
  for (const p of props) {
    const k = groupKey(p)
    const arr = groups.get(k)
    if (arr) arr.push(p)
    else groups.set(k, [p])
  }

  const rows: BoardRow[] = []
  for (const [key, items] of groups) {
    const base = items[0]
    const priced = items.filter((p) => p.status === "priced")
    const status: PricingStatus = priced.length > 0 ? "priced" : "unpriced"

    // Once any offer carries a real market price, the unpriced estimates are
    // discarded from the consensus rather than diluting it.
    const contributing = priced.length > 0 ? priced : items

    /** True when nothing on this row carries any projection at all. */
    const hasEstimate = contributing.some((p) => p.confidence > 0)

    const wTotal = contributing.reduce((a, p) => a + Math.max(p.confidence, 1), 0)
    const mean = contributing.reduce((a, p) => a + p.mean * Math.max(p.confidence, 1), 0) / wTotal
    const sd = contributing.reduce((a, p) => a + p.sd * Math.max(p.confidence, 1), 0) / wTotal
    const confidence = Math.round(contributing.reduce((a, p) => a + p.confidence, 0) / contributing.length)

    // Book metadata comes from whichever contributing prop had the best books.
    const bestBooked = [...contributing].sort((a, b) => b.books.length - a.books.length)[0]

    const offers: BoardOffer[] = items.map((p) => ({
      app: p.app,
      line: p.line,
      pOver: p.pOver,
      pUnder: p.pUnder,
      pPush: p.pPush,
      source: p.source,
      propId: p.id,
      status: p.status,
    }))

    let bestOver: BoardRow["bestOver"] = null
    let bestUnder: BoardRow["bestUnder"] = null
    for (const o of offers) {
      if (!bestOver || o.pOver > bestOver.pWin) bestOver = { offer: o, pWin: o.pOver }
      if (!bestUnder || o.pUnder > bestUnder.pWin) bestUnder = { offer: o, pWin: o.pUnder }
    }

    let recommended: BoardRow["recommended"] = null
    if (bestOver && bestUnder) {
      const takeOver = bestOver.pWin >= bestUnder.pWin
      const pick = takeOver ? bestOver : bestUnder
      const lineEdge = takeOver ? mean - pick.offer.line : pick.offer.line - mean
      recommended = {
        side: takeOver ? "OVER" : "UNDER",
        offer: pick.offer,
        pWin: pick.pWin,
        fairAmerican: probToAmerican(pick.pWin),
        lineEdge,
        lineEdgeZ: lineEdge / Math.max(sd, 1e-9),
      }
    }

    const lines = offers.map((o) => o.line)
    const lineSpread = lines.length > 1 ? Math.max(...lines) - Math.min(...lines) : 0

    let shoppingGainPct = 0
    if (recommended && offers.length > 1) {
      const probs = offers.map((o) => (recommended!.side === "OVER" ? o.pOver : o.pUnder))
      shoppingGainPct = (Math.max(...probs) - Math.min(...probs)) * 100
    }

    rows.push({
      key,
      player: base.player,
      team: base.team,
      opponent: base.opponent,
      gameId: base.gameId,
      gameTime: base.gameTime,
      marketKey: base.marketKey,
      marketLabel: base.marketLabel,
      status,
      unpricedReason: status === "unpriced" ? (base.unpricedReason ?? "No sportsbook price supplied.") : null,
      hasEstimate,
      mean,
      sd,
      confidence,
      books: bestBooked?.books ?? [],
      hasSharpBook: contributing.some((p) => p.hasSharpBook),
      bookDisagreement: Math.max(0, ...contributing.map((p) => p.bookDisagreement)),
      quoteAgeMinutes: contributing.reduce<number | null>(
        (a, p) => (p.quoteAgeMinutes == null ? a : a == null ? p.quoteAgeMinutes : Math.min(a, p.quoteAgeMinutes)),
        null,
      ),
      isStale: contributing.some((p) => p.isStale),
      holdPct: contributing.find((p) => p.holdPct != null)?.holdPct ?? null,
      offers,
      bestOver,
      bestUnder,
      recommended,
      lineSpread,
      shoppingGainPct,
      warnings: Array.from(new Set(items.flatMap((p) => p.warnings))),
      sources: Array.from(new Set(contributing.flatMap((p) => p.sources))),
    })
  }

  return rows.sort((a, b) => {
    // Priced rows first: they are the only ones you can act on. Rows with no
    // projection at all sink to the bottom.
    if (a.status !== b.status) return a.status === "priced" ? -1 : 1
    if (a.hasEstimate !== b.hasEstimate) return a.hasEstimate ? -1 : 1
    return (b.recommended?.pWin ?? 0) - (a.recommended?.pWin ?? 0)
  })
}

/**
 * Turn board rows into optimizer candidates.
 *
 * Only the recommended side of each row becomes a candidate: offering both sides
 * of the same number to the optimizer invites it to build entries that cannot
 * all win. Unpriced rows are carried through with their status so the optimizer
 * can reject them explicitly rather than silently.
 */
export function boardToCandidates(rows: BoardRow[], appFilter?: string | null): CandidateLeg[] {
  const out: CandidateLeg[] = []
  for (const r of rows) {
    if (!r.recommended) continue
    if (appFilter && r.recommended.offer.app && r.recommended.offer.app !== appFilter) continue
    out.push({
      id: r.recommended.offer.propId,
      player: r.player,
      team: r.team,
      opponent: r.opponent,
      gameId: r.gameId ?? gameKey(r.team, r.opponent),
      market: r.marketKey,
      marketLabel: r.marketLabel,
      line: r.recommended.offer.line,
      side: r.recommended.side,
      pWin: r.recommended.pWin,
      pPush: r.recommended.offer.pPush,
      american: null,
      status: r.status,
      confidence: r.confidence,
      lineEdge: r.recommended.lineEdge,
      lineEdgeZ: r.recommended.lineEdgeZ,
      app: r.recommended.offer.app,
    })
  }
  return out
}

function gameKey(team: string | null, opponent: string | null): string | null {
  if (!team && !opponent) return null
  return [team ?? "", opponent ?? ""].map((s) => s.toUpperCase()).sort().join("@")
}

/** Distinct apps that appear anywhere on the board. */
export function appsOnBoard(rows: BoardRow[]): string[] {
  const s = new Set<string>()
  for (const r of rows) for (const o of r.offers) if (o.app) s.add(o.app)
  return Array.from(s).sort()
}
