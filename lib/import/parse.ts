import type { RawPropRow } from "@/lib/quant/projection"

/**
 * Slate import.
 *
 * Accepts JSON (an array, or an object wrapping one under a common key) and
 * delimited text (CSV or TSV) with a header row. Column names are matched
 * loosely because no two scrapers agree on them.
 */

export interface ImportResult {
  rows: RawPropRow[]
  /** Rows that could not be read, with the reason. */
  skipped: { line: number; reason: string; raw: string }[]
  format: "json" | "csv" | "tsv"
  /** Header columns that were recognised, for display after an import. */
  mapped: Record<string, string>
  /** Header columns that were present but not understood. */
  unmapped: string[]
}

const FIELD_ALIASES: Record<keyof RawPropRow | string, string[]> = {
  player: ["player", "playername", "player_name", "name", "athlete", "subject"],
  team: ["team", "teamabbr", "team_abbr", "teamcode", "playerteam", "tm"],
  opponent: ["opponent", "opp", "vs", "versus", "opp_team", "against"],
  gameId: ["gameid", "game_id", "game", "matchup", "event", "eventid", "event_id"],
  gameTime: ["gametime", "game_time", "starttime", "start_time", "commencetime", "tipoff", "date"],
  market: ["market", "proptype", "prop_type", "stat", "stattype", "stat_type", "category", "prop"],
  line: ["line", "point", "value", "total", "handicap", "number", "dfsline", "dfs_line"],
  overOdds: ["overodds", "over_odds", "oddsover", "odds_over", "over", "americanover", "over_price", "overprice"],
  underOdds: ["underodds", "under_odds", "oddsunder", "odds_under", "under", "americanunder", "under_price", "underprice"],
  bookLine: ["bookline", "book_line", "sportsbookline", "sportsbook_line", "consensusline", "consensus_line", "marketline", "market_line"],
  projection: ["projection", "proj", "model", "forecast", "predicted", "expected", "modelvalue", "model_value"],
  seasonAvg: ["seasonavg", "season_avg", "season", "avg", "average", "seasonaverage"],
  l10Avg: ["l10avg", "l10_avg", "l10", "last10", "last_10", "l10average"],
  l5Avg: ["l5avg", "l5_avg", "l5", "last5", "last_5", "l5average"],
  minutesAvg: ["minutesavg", "minutes_avg", "min", "minutes", "mpg", "minavg"],
  minutesProj: ["minutesproj", "minutes_proj", "projminutes", "proj_minutes", "minproj"],
  hitRate: ["hitrate", "hit_rate", "hitrate_season", "hit", "hitpct", "hit_pct"],
  l10HitRate: ["l10hitrate", "l10_hit_rate", "l10hit", "hitratel10"],
  l5HitRate: ["l5hitrate", "l5_hit_rate", "l5hit", "hitratel5"],
  app: ["app", "operator", "site", "platform", "dfs", "dfsapp"],
  book: ["book", "sportsbook", "bookmaker", "sourcebook"],
  source: ["source", "provider", "feed"],
  notes: ["notes", "note", "comment"],
}

function canon(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function fieldFor(header: string): string | null {
  const c = canon(header)
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.some((a) => canon(a) === c)) return field
  }
  return null
}

function toNumber(v: unknown): number | null {
  if (v == null || v === "") return null
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  const cleaned = String(v).replace(/[$,\s]/g, "").replace(/^\+/, "")
  const n = Number.parseFloat(cleaned)
  return Number.isFinite(n) ? n : null
}

/**
 * Odds sometimes arrive as decimals. Anything strictly between 1 and 10 is
 * decimal odds, because American prices never live in that range.
 */
function toAmerican(v: unknown): number | null {
  const n = toNumber(v)
  if (n == null) return null
  if (n > 1 && n < 10) {
    return n >= 2 ? Math.round((n - 1) * 100) : Math.round(-100 / (n - 1))
  }
  return Math.round(n)
}

function buildRow(obj: Record<string, unknown>): RawPropRow | { error: string } {
  const get = (field: string): unknown => {
    if (obj[field] != null && obj[field] !== "") return obj[field]
    for (const key of Object.keys(obj)) {
      if (fieldFor(key) === field && obj[key] != null && obj[key] !== "") return obj[key]
    }
    return undefined
  }

  const player = get("player")
  const market = get("market")
  const line = toNumber(get("line"))
  if (!player) return { error: "no player column" }
  if (!market) return { error: "no market column" }
  if (line == null) return { error: "no numeric line" }

  const str = (v: unknown) => (v == null || v === "" ? null : String(v).trim())

  return {
    player: String(player).trim(),
    book: str(get("book")),
    team: str(get("team")),
    opponent: str(get("opponent")),
    gameId: str(get("gameId")),
    gameTime: str(get("gameTime")),
    market: String(market).trim(),
    line,
    overOdds: toAmerican(get("overOdds")),
    underOdds: toAmerican(get("underOdds")),
    bookLine: toNumber(get("bookLine")),
    projection: toNumber(get("projection")),
    seasonAvg: toNumber(get("seasonAvg")),
    l10Avg: toNumber(get("l10Avg")),
    l5Avg: toNumber(get("l5Avg")),
    minutesAvg: toNumber(get("minutesAvg")),
    minutesProj: toNumber(get("minutesProj")),
    hitRate: str(get("hitRate")),
    l10HitRate: str(get("l10HitRate")),
    l5HitRate: str(get("l5HitRate")),
    app: str(get("app")),
    source: str(get("source")),
    notes: str(get("notes")),
  }
}

/** Split a delimited line, honouring double-quoted fields. */
export function splitDelimited(line: string, delimiter: string): string[] {
  const out: string[] = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQuotes = false
      } else cur += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === delimiter) {
      out.push(cur)
      cur = ""
    } else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

export function parseSlate(text: string): ImportResult {
  const trimmed = text.trim()
  if (!trimmed) {
    return { rows: [], skipped: [], format: "json", mapped: {}, unmapped: [] }
  }

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return parseJson(trimmed)
  return parseDelimited(trimmed)
}

function parseJson(text: string): ImportResult {
  const skipped: ImportResult["skipped"] = []
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    return {
      rows: [],
      skipped: [{ line: 0, reason: e instanceof Error ? e.message : "invalid JSON", raw: text.slice(0, 120) }],
      format: "json",
      mapped: {},
      unmapped: [],
    }
  }

  let arr: unknown[] = []
  if (Array.isArray(parsed)) arr = parsed
  else if (parsed && typeof parsed === "object") {
    const o = parsed as Record<string, unknown>
    const wrapper = ["props", "data", "results", "entries", "rows", "lines", "projections"].find((k) => Array.isArray(o[k]))
    arr = wrapper ? (o[wrapper] as unknown[]) : [o]
  }

  const rows: RawPropRow[] = []
  const mapped: Record<string, string> = {}
  const unmappedSet = new Set<string>()

  arr.forEach((item, i) => {
    if (!item || typeof item !== "object") {
      skipped.push({ line: i + 1, reason: "not an object", raw: String(item).slice(0, 120) })
      return
    }
    const obj = item as Record<string, unknown>
    for (const key of Object.keys(obj)) {
      const f = fieldFor(key)
      if (f) mapped[key] = f
      else unmappedSet.add(key)
    }
    const built = buildRow(obj)
    if ("error" in built) {
      skipped.push({ line: i + 1, reason: built.error, raw: JSON.stringify(obj).slice(0, 120) })
    } else {
      rows.push(built)
    }
  })

  return { rows, skipped, format: "json", mapped, unmapped: Array.from(unmappedSet) }
}

function parseDelimited(text: string): ImportResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  const headerLine = lines[0] ?? ""
  const delimiter = (headerLine.match(/\t/g) ?? []).length > (headerLine.match(/,/g) ?? []).length ? "\t" : ","
  const headers = splitDelimited(headerLine, delimiter)

  const mapped: Record<string, string> = {}
  const unmapped: string[] = []
  for (const h of headers) {
    const f = fieldFor(h)
    if (f) mapped[h] = f
    else if (h) unmapped.push(h)
  }

  const rows: RawPropRow[] = []
  const skipped: ImportResult["skipped"] = []

  for (let i = 1; i < lines.length; i++) {
    const cells = splitDelimited(lines[i], delimiter)
    const obj: Record<string, unknown> = {}
    headers.forEach((h, j) => {
      const f = fieldFor(h)
      if (f) obj[f] = cells[j]
    })
    const built = buildRow(obj)
    if ("error" in built) skipped.push({ line: i + 1, reason: built.error, raw: lines[i].slice(0, 120) })
    else rows.push(built)
  }

  return { rows, skipped, format: delimiter === "\t" ? "tsv" : "csv", mapped, unmapped }
}

/** A worked example the import screen can load with one click. */
export const SAMPLE_CSV = `player,team,opponent,game_id,market,line,app,book,book_line,over_odds,under_odds
Anthony Edwards,MIN,OKC,MIN@OKC,Points,24.5,prizepicks,pinnacle,25.5,-112,-108
Anthony Edwards,MIN,OKC,MIN@OKC,Points,26.5,underdog,pinnacle,25.5,-112,-108
Anthony Edwards,MIN,OKC,MIN@OKC,3-Pointers Made,2.5,prizepicks,pinnacle,2.5,-105,-115
Rudy Gobert,MIN,OKC,MIN@OKC,Rebounds,11.5,prizepicks,pinnacle,11.5,-120,100
Shai Gilgeous-Alexander,OKC,MIN,MIN@OKC,Points,30.5,prizepicks,pinnacle,31.5,-110,-110
Shai Gilgeous-Alexander,OKC,MIN,MIN@OKC,Pts+Reb+Ast,39.5,prizepicks,pinnacle,40.5,-108,-112
Chet Holmgren,OKC,MIN,MIN@OKC,Blocks,1.5,prizepicks,pinnacle,1.5,105,-125
Jalen Brunson,NYK,BOS,NYK@BOS,Points,26.5,prizepicks,pinnacle,27.5,-115,-105
Jalen Brunson,NYK,BOS,NYK@BOS,Assists,6.5,prizepicks,pinnacle,6.5,-118,-102
Jayson Tatum,BOS,NYK,NYK@BOS,Points,27.5,prizepicks,pinnacle,27.5,-110,-110
Jayson Tatum,BOS,NYK,NYK@BOS,Rebounds,8.5,prizepicks,pinnacle,8.5,-112,-108
Derrick White,BOS,NYK,NYK@BOS,3-Pointers Made,2.5,prizepicks,pinnacle,2.5,-125,105
`
