/**
 * Lossless packing for the big arrays kept in browser storage.
 *
 * A pull is thousands of quotes that are almost entirely repetition: every
 * quote from one game carries the same two team names, the same game id and
 * the same kick-off time, and every quote for one player carries that
 * player's name twice. Stored verbatim that is about 330 bytes a quote, which
 * is how a single NFL Sunday came to be bigger than the whole storage quota
 * on its own and took every other cache down with it.
 *
 * So the rows are stored by column. A column of strings becomes a dictionary
 * of the distinct values plus an index per row, and where consecutive rows
 * share a value (a game's quotes arrive together) the indexes collapse into
 * runs. Numbers and anything else are kept as they are. The quote that cost
 * 330 bytes costs about 30.
 *
 * Packing is for storage only. The engine never sees a packed table, an
 * export is written unpacked so it stays readable, and unpacking returns
 * exactly the rows that went in: the same keys, the same values, null kept
 * apart from absent.
 */

/** A column of strings: the distinct values, and each row's index into them. */
interface StringColumn {
  k: string
  /** The distinct values, in first-seen order. */
  s: string[]
  /** One index per row: -1 for null, -2 for a row without the field. */
  i?: number[]
  /** The same indexes as runs, [index, count, index, count, ...], when that is shorter. */
  r?: number[]
}

/** Any other column, verbatim. */
interface PlainColumn {
  k: string
  v: unknown[]
  /** Rows that lack the field, which `v` holds as null. */
  a?: number[]
}

type Column = StringColumn | PlainColumn

export interface PackedTable {
  /** Rows. */
  n: number
  /** Columns, in first-seen field order. */
  c: Column[]
}

const NULL = -1
const ABSENT = -2

type Row = Record<string, unknown>

export function packRows(rows: readonly object[]): PackedTable {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k)
        keys.push(k)
      }
    }
  }
  return { n: rows.length, c: keys.map((k) => packColumn(rows as readonly Row[], k)) }
}

function packColumn(rows: readonly Row[], k: string): Column {
  const own = (row: Row) => Object.prototype.hasOwnProperty.call(row, k) && row[k] !== undefined
  const strings = rows.every((row) => !own(row) || row[k] === null || typeof row[k] === "string")
  if (strings) {
    const dict = new Map<string, number>()
    const s: string[] = []
    const i = rows.map((row) => {
      if (!own(row)) return ABSENT
      const v = row[k] as string | null
      if (v === null) return NULL
      let idx = dict.get(v)
      if (idx === undefined) {
        idx = s.length
        dict.set(v, idx)
        s.push(v)
      }
      return idx
    })
    const r = toRuns(i)
    return r.length < i.length ? { k, s, r } : { k, s, i }
  }
  const absent: number[] = []
  const v = rows.map((row, n) => {
    if (own(row)) return row[k]
    absent.push(n)
    return null
  })
  return absent.length > 0 ? { k, v, a: absent } : { k, v }
}

function toRuns(i: number[]): number[] {
  const out: number[] = []
  for (let n = 0; n < i.length; n++) {
    if (out.length > 0 && out[out.length - 2] === i[n]) out[out.length - 1]++
    else out.push(i[n], 1)
  }
  return out
}

/**
 * The rows a table was packed from.
 *
 * Throws on anything that is not a table this module wrote, so the caller can
 * drop one unreadable cache rather than hand the engine half a slate.
 */
export function unpackRows<T = Row>(table: unknown): T[] {
  if (!isTable(table)) throw new Error("Not a packed table")
  const rows: Row[] = Array.from({ length: table.n }, () => ({}))
  for (const col of table.c) {
    if ("s" in col) {
      const idx = col.r ? fromRuns(col.r, table.n) : col.i!
      if (idx.length !== table.n) throw new Error(`Column ${col.k} has ${idx.length} rows, expected ${table.n}`)
      for (let n = 0; n < table.n; n++) {
        const at = idx[n]
        if (at === ABSENT) continue
        if (at === NULL) rows[n][col.k] = null
        else if (Number.isInteger(at) && at >= 0 && at < col.s.length) rows[n][col.k] = col.s[at]
        else throw new Error(`Column ${col.k} points outside its dictionary`)
      }
    } else {
      if (col.v.length !== table.n) throw new Error(`Column ${col.k} has ${col.v.length} rows, expected ${table.n}`)
      const absent = new Set(col.a ?? [])
      for (let n = 0; n < table.n; n++) if (!absent.has(n)) rows[n][col.k] = col.v[n]
    }
  }
  return rows as T[]
}

function fromRuns(r: number[], n: number): number[] {
  const out: number[] = []
  for (let j = 0; j + 1 < r.length; j += 2) {
    const count = r[j + 1]
    // A run longer than the table is corrupt, and filling it would allocate
    // whatever a damaged count says.
    if (!Number.isInteger(count) || count < 0 || out.length + count > n) throw new Error("Bad run length")
    for (let c = 0; c < count; c++) out.push(r[j])
  }
  return out
}

function isTable(t: unknown): t is PackedTable {
  if (!t || typeof t !== "object") return false
  const o = t as Partial<PackedTable>
  if (!Number.isInteger(o.n) || (o.n as number) < 0 || !Array.isArray(o.c)) return false
  return o.c.every((col) => {
    if (!col || typeof col !== "object" || typeof (col as Column).k !== "string") return false
    if ("s" in col) {
      return Array.isArray(col.s) && col.s.every((x) => typeof x === "string") && (Array.isArray(col.r) || Array.isArray(col.i))
    }
    return Array.isArray((col as PlainColumn).v)
  })
}
