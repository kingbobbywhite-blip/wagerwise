import type { CandidateLeg } from "./optimizer"
import type { ProjectedProp } from "./projection"
import { normalizeName } from "./correlation"
import { probToAmerican } from "./odds"

/**
 * Slate assembly and line shopping.
 *
 * A player's points prop can be posted at 24.5 on one app and 25.5 on another.
 * That one-point gap is frequently a larger edge than anything a projection
 * model will find, and it is free: the same opinion is simply worth more on the
 * app with the better number. This module groups every posted line for a
 * player/market, works out which app offers the best price on each side, and
 * flags the spread between apps.
 */

export interface BoardOffer {
  app: string | null
  line: number
  pOver: number
  pUnder: number
  pPush: number
  source: string | null
  propId: string
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

  /** Consensus projection across every offer for this player and market. */
  mean: number
  sd: number
  confidence: number

  offers: BoardOffer[]
  /** Best line to take if you want the over, and the app offering it. */
  bestOver: { offer: BoardOffer; pWin: number } | null
  bestUnder: { offer: BoardOffer; pWin: number } | null

  /** The side the model actually likes, with the best available number. */
  recommended: {
    side: "OVER" | "UNDER"
    offer: BoardOffer
    pWin: number
    fairAmerican: number
    lineEdge: number
    lineEdgeZ: number
  } | null

  /** Difference between the widest and narrowest line posted across apps. */
  lineSpread: number
  /** Probability gained by taking the best number instead of the worst. */
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

    // Weight the consensus mean by each offer's confidence: a line derived from
    // a real two-way market should dominate one derived from season averages.
    const wTotal = items.reduce((a, p) => a + Math.max(p.confidence, 1), 0)
    const mean = items.reduce((a, p) => a + p.mean * Math.max(p.confidence, 1), 0) / wTotal
    const sd = items.reduce((a, p) => a + p.sd * Math.max(p.confidence, 1), 0) / wTotal
    const confidence = Math.round(items.reduce((a, p) => a + p.confidence, 0) / items.length)

    const offers: BoardOffer[] = items.map((p) => ({
      app: p.app,
      line: p.line,
      pOver: p.pOver,
      pUnder: p.pUnder,
      pPush: p.pPush,
      source: p.source,
      propId: p.id,
    }))

    // Best over is the lowest line; best under is the highest line.
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

    const warnings = Array.from(new Set(items.flatMap((p) => p.warnings)))
    const sources = Array.from(new Set(items.flatMap((p) => p.sources)))

    rows.push({
      key,
      player: base.player,
      team: base.team,
      opponent: base.opponent,
      gameId: base.gameId,
      gameTime: base.gameTime,
      marketKey: base.marketKey,
      marketLabel: base.marketLabel,
      mean,
      sd,
      confidence,
      offers,
      bestOver,
      bestUnder,
      recommended,
      lineSpread,
      shoppingGainPct,
      warnings,
      sources,
    })
  }

  return rows.sort((a, b) => (b.recommended?.pWin ?? 0) - (a.recommended?.pWin ?? 0))
}

/**
 * Turn board rows into optimizer candidates.
 * Only the recommended side of each row becomes a candidate: offering both sides
 * of the same number to the optimizer invites it to build slips that cannot all
 * win.
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
