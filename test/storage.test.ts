import { describe, expect, it } from "vitest"
import { packRows, unpackRows } from "@/lib/store/pack"
import { createPersister, reduceForQuota, type StorageLike } from "@/lib/store/local"
import { EMPTY_STATE, migrate, type AppState, type DailyCache, type LineSnapshot } from "@/lib/store/schema"
import type { FeedQuote } from "@/lib/quant/valuebets"
import type { MarketKey } from "@/lib/nba/markets"
import type { LeagueId } from "@/lib/leagues"

/**
 * Browser storage, against a fake that enforces a quota the way browsers do:
 * key plus value, in UTF-16 code units, across every key on the origin.
 *
 * The failure this guards against was real. A full NFL pull was bigger than
 * the whole quota on its own, so every save failed, the shed loop deleted
 * line history, then the other leagues' slates, then the imported board, then
 * the pull itself — from the screen as well as from storage — and the banner
 * read as though that had been done to keep something.
 */

class QuotaStorage implements StorageLike {
  map = new Map<string, string>()
  writes: string[] = []
  constructor(public quota = Infinity) {}
  get length() {
    return this.map.size
  }
  key(i: number) {
    return Array.from(this.map.keys())[i] ?? null
  }
  getItem(k: string) {
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string) {
    const used = this.used() - (this.map.has(k) ? k.length + this.map.get(k)!.length : 0)
    if (used + k.length + v.length > this.quota) {
      const err = new Error("The quota has been exceeded.")
      err.name = "QuotaExceededError"
      throw err
    }
    this.writes.push(k)
    this.map.set(k, v)
  }
  removeItem(k: string) {
    this.map.delete(k)
  }
  used() {
    let n = 0
    for (const [k, v] of this.map) n += k.length + v.length
    return n
  }
}

/** A deterministic pull shaped like a real one: per book, per player, per market, per game. */
function pull(league: LeagueId, games: number, fetchedAt: string, playersPerGame = 20): DailyCache {
  const books = ["pinnacle", "betonlineag", "lowvig", "draftkings", "fanduel", "betmgm", "williamhill_us", "espnbet"]
  const markets: MarketKey[] =
    league === "nba" ? ["PTS", "REB", "AST", "3PM"] : league === "nhl" ? ["SOG", "HKY_PTS", "SAVES"] : ["PASS_YDS", "RUSH_YDS", "REC_YDS", "REC", "RUSH_ATT"]
  let seed = 7
  const rnd = () => {
    seed = (seed * 48271) % 2147483647
    return seed / 2147483647
  }
  const quotes: (FeedQuote & { playerKey: string })[] = []
  const events: DailyCache["events"] = []
  for (let g = 0; g < games; g++) {
    const away = `Away Team ${league.toUpperCase()} ${g}`
    const home = `Home Team ${league.toUpperCase()} ${g}`
    const commence = `2026-10-18T${String(17 + (g % 3) * 3).padStart(2, "0")}:00:00Z`
    events.push({ id: `e${g}`, commence_time: commence, home_team: home, away_team: away })
    for (let p = 0; p < playersPerGame; p++) {
      const player = `Firstname${g}x${p} Lastname-Hyphenated`
      for (const market of markets) {
        for (const book of books) {
          quotes.push({
            book,
            line: Math.round(rnd() * 80) + 0.5,
            overOdds: -100 - Math.round(rnd() * 30),
            underOdds: rnd() < 0.05 ? null : -100 - Math.round(rnd() * 30),
            fetchedAt: `2026-10-15T18:${String(10 + books.indexOf(book)).padStart(2, "0")}:31Z`,
            player,
            playerKey: player.toLowerCase(),
            market,
            gameId: `${away}@${home}`,
            homeTeam: home,
            awayTeam: away,
            commenceTime: commence,
            ...(league === "nfl" && g % 4 === 0 ? { competition: "cfb" as const } : {}),
          })
        }
      }
    }
  }
  return {
    league,
    fetchedAt,
    quotes,
    events,
    requestsRemaining: 412,
    creditsSpent: games * markets.length,
    provider: "theoddsapi",
    pickemLines: [
      { app: "prizepicks", player: "A B", playerKey: "a b", market: markets[0], gameId: "x@y", line: 20.5, pickType: "standard", over: { multiplier: null }, under: null, fetchedAt: null },
    ],
    pickemNote: null,
  }
}

function snapshot(pulledAt: string, n: number): LineSnapshot {
  return {
    pulledAt,
    league: "nfl",
    rows: Array.from({ length: n }, (_, i) => ({
      key: `player ${i}|Away@Home|REC_YDS`,
      player: `Player ${i}`,
      market: "REC_YDS" as const,
      hoursToStart: 30.25,
      startsAt: "2026-10-18T17:00:00Z",
      line: 40.5 + (i % 7),
      mean: i % 5 === 0 ? null : 41.2,
      books: 6,
    })),
  }
}

function withSlip(state: AppState): AppState {
  return {
    ...state,
    slips: [
      {
        id: "s1",
        createdAt: "2026-10-01T00:00:00Z",
        settledAt: null,
        appId: "prizepicks",
        modeId: "power",
        legs: [],
        stake: 10,
        capturedPayout: null,
        evAtEntry: null,
        pAllHitAtEntry: null,
        topMultiple: 3,
        status: "PENDING",
        actualMultiple: null,
        notes: "",
      },
    ],
  }
}

describe("packing a pull for storage", () => {
  it("gives back exactly the rows that went in", () => {
    const rows = [
      { a: "x", b: 1, c: null, d: { m: 2 } },
      { a: "x", b: 2.5, d: null },
      { a: null, b: -110, c: "y", e: "only here" },
      { b: 3 },
    ]
    expect(unpackRows(JSON.parse(JSON.stringify(packRows(rows))))).toEqual(rows)
    // Null and absent stay apart, which toEqual alone would not show.
    const back = unpackRows<Record<string, unknown>>(JSON.parse(JSON.stringify(packRows(rows))))
    expect("c" in back[1]).toBe(false)
    expect(back[0].c).toBeNull()
    expect(unpackRows(packRows([]))).toEqual([])
  })

  it("makes a full NFL Sunday a small fraction of the quota it used to overflow", () => {
    const quotes = pull("nfl", 14, "2026-10-18T12:00:00Z").quotes
    const raw = JSON.stringify(quotes).length
    const packed = JSON.stringify(packRows(quotes)).length
    expect(unpackRows(JSON.parse(JSON.stringify(packRows(quotes))))).toEqual(quotes)
    // Raw, this is over 2.5 million characters, which is all of Safari's 5MB.
    expect(raw).toBeGreaterThan(2_500_000)
    expect(packed * 10).toBeLessThan(raw)
  })

  it("refuses a damaged table rather than inventing rows", () => {
    expect(() => unpackRows({ n: 2, c: [{ k: "a", s: ["x"], i: [0] }] })).toThrow()
    expect(() => unpackRows({ n: 1, c: [{ k: "a", s: ["x"], i: [5] }] })).toThrow()
    expect(() => unpackRows({ n: 2, c: [{ k: "a", s: ["x"], r: [0, 1e9] }] })).toThrow()
    expect(() => unpackRows("not a table")).toThrow()
  })
})

describe("storing the state in pieces", () => {
  const full = (): AppState =>
    withSlip({
      ...EMPTY_STATE,
      daily: { nfl: pull("nfl", 14, "2026-10-18T12:00:00Z"), nba: pull("nba", 8, "2026-10-17T12:00:00Z") },
      lines: [snapshot("2026-10-18T12:00:00Z", 900), snapshot("2026-10-16T12:00:00Z", 900)],
      slate: { id: "b", label: "Board", importedAt: "2026-10-18T00:00:00Z", rows: [{ player: "P", market: "PTS", line: 20.5 }], source: "ocr" },
    })

  it("reads back what it wrote", () => {
    const storage = new QuotaStorage()
    const state = full()
    expect(createPersister(storage).save(state)).toEqual({ ok: true, unsaved: [] })
    const back = createPersister(storage).load()
    expect(back).toEqual(migrate(JSON.parse(JSON.stringify(state))))
  })

  it("writes only what changed, so a setting does not re-serialise every slate", () => {
    const storage = new QuotaStorage()
    const p = createPersister(storage)
    const state = full()
    p.save(state)
    storage.writes = []
    p.save({ ...state, settings: { ...state.settings, defaultAppId: "underdog" } })
    expect(storage.writes).toEqual(["wagerwise.state.v1"])
    // And a freshly loaded state writes nothing at all.
    const q = createPersister(storage)
    const loaded = q.load()
    storage.writes = []
    q.save(loaded)
    expect(storage.writes).toEqual([])
  })

  it("splits a blob written by the old version, even when that blob nearly fills the quota", () => {
    const old = full()
    const blob = JSON.stringify(old)
    const storage = new QuotaStorage(blob.length + 100_000)
    storage.map.set("wagerwise.state.v1", blob)
    const p = createPersister(storage)
    const loaded = p.load()
    expect(loaded.daily.nfl?.quotes).toHaveLength(old.daily.nfl!.quotes.length)
    expect(p.save(loaded)).toEqual({ ok: true, unsaved: [] })
    // The core no longer carries the caches, and the whole thing is far smaller.
    expect(JSON.parse(storage.getItem("wagerwise.state.v1")!)).not.toHaveProperty("daily")
    expect(storage.used() * 4).toBeLessThan(blob.length)
    expect(createPersister(storage).load()).toEqual(loaded)
  })

  it("prefers the old blob over split keys a downgrade left behind, and clears a league nothing reads", () => {
    const storage = new QuotaStorage()
    createPersister(storage).save(full())
    storage.map.set("wagerwise.daily.v1.wnba", "{}")
    // An older version ran since, and wrote its single blob without the NBA pull.
    const older = { ...full(), daily: { nfl: pull("nfl", 2, "2026-10-19T12:00:00Z") } }
    storage.map.set("wagerwise.state.v1", JSON.stringify(older))
    const p = createPersister(storage)
    const loaded = p.load()
    expect(Object.keys(loaded.daily)).toEqual(["nfl"])
    p.save(loaded)
    expect(storage.getItem("wagerwise.daily.v1.nba")).toBeNull()
    expect(storage.getItem("wagerwise.daily.v1.wnba")).toBeNull()
    expect(createPersister(storage).load().daily.nfl?.quotes).toHaveLength(older.daily.nfl.quotes.length)
  })

  it("drops a cache or board the screens would crash on", () => {
    const m = migrate({
      daily: { nfl: { quotes: [] }, nba: { quotes: [], events: [], fetchedAt: "2026-10-17T12:00:00Z" } },
      slate: { id: "x" },
    })
    expect(Object.keys(m.daily)).toEqual(["nba"])
    expect(m.slate).toBeNull()
  })

  it("replaces a core that is valid JSON but not a state", () => {
    const storage = new QuotaStorage()
    storage.map.set("wagerwise.state.v1", "42")
    const p = createPersister(storage)
    p.save(p.load())
    expect(JSON.parse(storage.getItem("wagerwise.state.v1")!)).toHaveProperty("settings")
  })

  it("loses one unreadable piece, not the app", () => {
    const storage = new QuotaStorage()
    createPersister(storage).save(full())
    storage.map.set("wagerwise.daily.v1.nba", '{"f":1,"cache":{},"quotes":{"n":3,"c":[{"k":"x","s":[],"i":[9]}]}}')
    const p = createPersister(storage)
    const loaded = p.load()
    expect(loaded.daily.nba).toBeUndefined()
    expect(loaded.daily.nfl).toBeDefined()
    expect(loaded.slips).toHaveLength(1)
    p.save(loaded)
    expect(storage.getItem("wagerwise.daily.v1.nba")).toBeNull()
  })
})

describe("when browser storage is full", () => {
  it("sheds the cheapest thing first and never the slips", () => {
    const state = {
      ...EMPTY_STATE,
      slips: [{ id: "s1" }] as never,
      slate: { id: "x", label: "x", importedAt: "x", rows: [], source: "x" },
      daily: {
        nba: { league: "nba" as const, fetchedAt: "2026-01-01T00:00:00Z", quotes: [], events: [], requestsRemaining: null, creditsSpent: 0 },
        nfl: { league: "nfl" as const, fetchedAt: "2026-01-02T00:00:00Z", quotes: [], events: [], requestsRemaining: null, creditsSpent: 0 },
      },
      lines: Array.from({ length: 5 }, (_, i) => ({ pulledAt: `2026-01-0${i + 1}T00:00:00Z`, league: "nfl" as const, rows: [] })),
    }
    // 1. Line history thins first: it is research, not a paid-for slate.
    const first = reduceForQuota(state, "nfl")!
    expect(first.dropped).toBe("3 older line snapshots")
    expect(first.state.lines).toHaveLength(2)
    // 2. Then another league's slate, oldest, never the one kept.
    const second = reduceForQuota(first.state, "nfl")!
    expect(second.dropped).toBe("the NBA slate")
    expect(second.state.daily.nfl).toBeDefined()
    // 3. Then the rest of the history, then the imported board, then the slate.
    let s = second.state
    const dropped: string[] = []
    for (let i = 0; i < 6; i++) {
      const r = reduceForQuota(s, "nfl")
      if (!r) break
      dropped.push(r.dropped)
      s = r.state
    }
    expect(dropped).toEqual(["the line history", "the imported board", "the NFL slate"])
    // The slips survive every step, because they are the only record of what
    // the model predicted.
    expect(s.slips).toHaveLength(1)
    expect(reduceForQuota(s, "nfl")).toBeNull()
  })

  it("stores the pull it can and leaves the screen alone", () => {
    const nfl = pull("nfl", 14, "2026-10-18T12:00:00Z")
    const nba = pull("nba", 10, "2026-10-17T12:00:00Z")
    const nflChars = JSON.stringify(packRows(nfl.quotes)).length
    // Room for the NFL pull and the core, not for the NBA pull beside them.
    const storage = new QuotaStorage(nflChars + 60_000)
    const p = createPersister(storage)
    const state = withSlip({ ...EMPTY_STATE, daily: { nfl, nba } })
    const r = p.save(state)
    expect(r).toEqual({ ok: true, unsaved: ["the NBA slate"] })
    // The state passed in is untouched: the NBA pull is still there to use.
    expect(state.daily.nba).toBe(nba)
    const back = createPersister(storage).load()
    expect(back.daily.nfl?.quotes).toHaveLength(nfl.quotes.length)
    expect(back.daily.nba).toBeUndefined()
    expect(back.slips).toHaveLength(1)
  })

  it("keeps slips and settings when even the newest pull will not fit", () => {
    const storage = new QuotaStorage(30_000)
    const p = createPersister(storage)
    const state = withSlip({
      ...EMPTY_STATE,
      daily: { nfl: pull("nfl", 14, "2026-10-18T12:00:00Z") },
      lines: [snapshot("2026-10-18T12:00:00Z", 900), snapshot("2026-10-17T12:00:00Z", 900), snapshot("2026-10-16T12:00:00Z", 900)],
    })
    const r = p.save(state)
    expect(r.ok).toBe(true)
    // The older snapshots are not listed separately once the whole history is out.
    expect(r.unsaved).toEqual(["the line history", "the NFL slate"])
    expect(createPersister(storage).load().slips).toHaveLength(1)
  })

  it("does not retry every left-out slate on each small change, and re-plans on a new pull", () => {
    const nfl = pull("nfl", 14, "2026-10-18T12:00:00Z")
    const nba = pull("nba", 10, "2026-10-17T12:00:00Z")
    const storage = new QuotaStorage(JSON.stringify(packRows(nfl.quotes)).length + 60_000)
    const p = createPersister(storage)
    const state = withSlip({ ...EMPTY_STATE, daily: { nfl, nba } })
    p.save(state)
    storage.writes = []
    const r = p.save({ ...state, settings: { ...state.settings, defaultModeId: "flex" } })
    expect(storage.writes).toEqual(["wagerwise.state.v1"])
    expect(r.unsaved).toEqual(["the NBA slate"])
    // Clearing the NFL slate makes room, and the NBA pull still on screen is stored.
    const cleared = p.save({ ...state, daily: { nba } })
    expect(cleared).toEqual({ ok: true, unsaved: [] })
    expect(createPersister(storage).load().daily.nba?.quotes).toHaveLength(nba.quotes.length)
  })

  it("says so when even the slips will not fit", () => {
    const storage = new QuotaStorage(100)
    const p = createPersister(storage)
    const r = p.save(withSlip({ ...EMPTY_STATE, daily: { nba: pull("nba", 1, "2026-10-17T12:00:00Z") } }))
    expect(r.ok).toBe(false)
    expect(r.quota).toBe(true)
    expect(r.error).toMatch(/full/)
    // The next change tries again rather than giving up for the session.
    storage.quota = Infinity
    expect(p.save(withSlip(EMPTY_STATE)).ok).toBe(true)
  })
})

describe("a save that fails for some other reason", () => {
  it("is not a reason to delete anything", () => {
    // Shedding is the right answer to a full quota and the wrong answer to
    // every other failure: storage switched off, or a value that will not
    // serialise, would otherwise have the app delete slate after slate
    // trying to fix a problem that was never about size.
    const storage = new QuotaStorage()
    createPersister(storage).save({ ...EMPTY_STATE, daily: { nba: pull("nba", 2, "2026-10-17T12:00:00Z") } })
    const p = createPersister(storage)
    const loaded = p.load()
    storage.setItem = () => {
      throw new Error("Access is denied for this document.")
    }
    const denied = p.save({ ...loaded, settings: { ...loaded.settings, defaultAppId: "underdog" } })
    expect(denied.ok).toBe(false)
    expect(denied.quota).toBeFalsy()
    expect(denied.error).toContain("Could not save")
    expect(denied.unsaved).toEqual([])
    expect(storage.getItem("wagerwise.daily.v1.nba")).not.toBeNull()
  })

  it("reports no storage at all rather than throwing", () => {
    const p = createPersister(null)
    expect(p.load()).toEqual(EMPTY_STATE)
    expect(p.save(EMPTY_STATE)).toMatchObject({ ok: false, error: "No browser storage available." })
  })
})
