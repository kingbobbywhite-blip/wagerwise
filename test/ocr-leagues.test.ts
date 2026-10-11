import { describe, it, expect } from "vitest"
import { extractProps, leagueFromScreen, linesFromText, teamCodesFor } from "@/lib/ocr/extract"

/**
 * Team codes are a NEGATIVE filter: a word that is a team code disqualifies
 * the whole line from being a player name. That makes the set dangerous to
 * widen, because a code that is also a word inside a real name deletes that
 * player outright — no prop, no unpaired name, nothing to review.
 *
 * None of the capture fixtures can catch this (they pass with the set emptied
 * entirely), so the protection has to be pinned here instead.
 */

const read = (text: string, league?: "nba" | "nfl" | "cfb" | "nhl" | null) =>
  extractProps(linesFromText(text), { league })

describe("what the team-code set is actually for", () => {
  it("refuses to read a bare matchup row as a player", () => {
    // No clock, no "vs", no position: two codes above a line and a stat. This
    // is the one input the set defends against, and the only reason nothing is
    // ever removed from it.
    expect(read("Dal Den\n44.5\nPoints").candidates).toEqual([])
  })

  it("still reads a player whose name contains another sport's team code", () => {
    // "Ga Cade Otton" survives because Georgia's code is not consulted here.
    const out = read("Ga Cade Otton\n65.5\nRec Yards")
    expect(out.candidates.map((c) => c.player)).toEqual(["Ga Cade Otton"])
  })
})

describe("college codes are consulted only on a college read", () => {
  it("adds the college codes for a college screen and nothing else", () => {
    expect(teamCodesFor("cfb").has("uga")).toBe(true)
    expect(teamCodesFor("cfb").has("dal")).toBe(true)
    for (const league of ["nba", "nfl", "nhl", null, undefined] as const) {
      expect(teamCodesFor(league).has("uga"), String(league)).toBe(false)
      expect(teamCodesFor(league).has("dal"), String(league)).toBe(true)
    }
  })

  it("reads a college matchup row as a matchup, not a player", () => {
    expect(read("Uga Bama\n245.5\nPass Yards", "cfb").candidates).toEqual([])
    // And on an unhinted read it is still a name, exactly as before.
    expect(read("Uga Bama\n245.5\nPass Yards").candidates.map((c) => c.player)).toEqual(["Uga Bama"])
  })

  it("reads the college player the apps actually print", () => {
    const out = read("Drew Allar\n245.5\nPass Yards", "cfb")
    expect(out.candidates.map((c) => c.player)).toEqual(["Drew Allar"])
    expect(out.candidates[0].marketKey).toBe("PASS_YDS")
  })

  it("never eats a real player whose name is also a college code", () => {
    // Measured: merging the college codes globally destroyed every one of
    // these, with the name dropped rather than flagged. They are left out of
    // the college set for the same reason, so a college read keeps them too.
    const names = [
      "Rashee Rice",
      "Sam LaPorta",
      "LaMelo Ball",
      "Troy Franklin",
      "Van Jefferson",
      "Duke Johnson",
      "Cal Raleigh",
      "Stan Smith",
    ]
    for (const name of names) {
      for (const league of ["nfl", "cfb", null] as const) {
        const out = read(`${name}\n65.5\nRec Yards`, league)
        expect(out.candidates.map((c) => c.player), `${name} on ${league}`).toEqual([name])
      }
    }
  })

  it("keeps the initials exemption, which a college name already relies on", () => {
    // "KC Concepcion Jr." is a college receiver whose first token spells the
    // Chiefs. Two capitals opening a three-word name are initials.
    expect(read("KC Concepcion Jr.\n55.5\nRec Yards", "cfb").candidates.map((c) => c.player)).toEqual([
      "KC Concepcion Jr.",
    ])
  })
})

describe("reading the league off the screen", () => {
  it("knows what each app calls college football", () => {
    expect(leagueFromScreen("CFB OSU 24 vs PSU 17")).toBe("cfb")
    expect(leagueFromScreen("NCAAF Georgia vs Alabama")).toBe("cfb")
    expect(leagueFromScreen("NCAA FB Texas vs Oklahoma")).toBe("cfb")
    expect(leagueFromScreen("CFP semifinal")).toBe("cfb")
  })

  it("counts rather than taking the first league in key order", () => {
    // The old reading took the first id that appeared anywhere, in the order
    // nba, nfl, cfb, nhl, so one stray "NFL" in the chrome of a college slip
    // pointed the extractor at the wrong codes.
    expect(leagueFromScreen("CFB OSU vs PSU CFB MICH vs UGA Powered by NFL odds")).toBe("cfb")
    expect(leagueFromScreen("NFL KC vs BUF NFL DAL vs PHI CFB promo")).toBe("nfl")
  })

  it("gives no answer for a mixed slip rather than a wrong one", () => {
    expect(leagueFromScreen("NFL KC vs BUF CFB OSU vs PSU")).toBeNull()
  })

  it("does not read WNBA as NBA, and says nothing for a screen with no league", () => {
    expect(leagueFromScreen("WNBA MIN 71 vs NYL 87")).toBeNull()
    expect(leagueFromScreen("2-Pick Power Play $5 for $15")).toBeNull()
  })

  it("still reads the leagues it always did", () => {
    expect(leagueFromScreen("NHL TOR 2 vs BOS 1")).toBe("nhl")
    expect(leagueFromScreen("NBA MIN 110 vs OKC 104")).toBe("nba")
  })
})
