import { normalizeName } from "@/lib/quant/correlation"

/**
 * Matching the same fixture across two feeds.
 *
 * Its own module because both feed adapters need it and neither should have to
 * import the other: the prices can come from The Odds API while the pick'em
 * lines come from PropLine, and something has to decide whether the two are
 * talking about the same game.
 */

/**
 * "Minnesota Timberwolves" to "timberwolves".
 *
 * In the professional leagues the nickname IS the identity and it survives the
 * differences between feeds ("LA Clippers" against "Los Angeles Clippers")
 * where the full name does not. In college football it is nothing of the kind:
 * there are a dozen Bulldogs, Tigers and Wildcats, so a nickname alone names a
 * set of teams rather than a team. See sameTeamName.
 */
export function teamNickname(name: string): string {
  const words = normalizeName(name).split(" ").filter(Boolean)
  return words[words.length - 1] ?? ""
}

function tokens(name: string): string[] {
  return normalizeName(name).split(" ").filter(Boolean)
}

/** "los angeles" to "la", the one abbreviation style the feeds disagree on. */
function initials(words: string[]): string {
  return words.map((w) => w[0]).join("")
}

/** Equal, or one an abbreviation of the other: "st" for "state", "mich" for "michigan". */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return short.length >= 2 && long.startsWith(short)
}

/**
 * Do two spellings name the same team?
 *
 * Every word of the shorter spelling has to find a word in the longer one,
 * allowing for abbreviation. That is what tells "Ohio St" and "Ohio State
 * Buckeyes" apart from "Georgia Bulldogs" and "Mississippi State Bulldogs":
 * the first pair agrees on everything the shorter one says, and the second
 * agrees only on the nickname, which in college football names a dozen teams.
 *
 * This is the whole reason a nickname cannot be the identity. There are
 * Bulldogs, Tigers and Wildcats in every conference, and there is also a
 * Georgia and a Georgia Tech, a Miami and a Miami (OH), a Washington and a
 * Washington State — so a shared word is not agreement either, unless nothing
 * the shorter name says is contradicted.
 *
 * The initials clause covers the one case word-matching cannot: a feed writing
 * "LA Clippers" where the other writes "Los Angeles Clippers".
 */
export function sameTeamName(a: string, b: string): boolean {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.length === 0 || tb.length === 0) return false
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  if (short.every((w) => long.some((v) => sameWord(w, v)))) return true
  // Same nickname, and the rest of one name abbreviates the rest of the other.
  if (ta[ta.length - 1] !== tb[tb.length - 1]) return false
  const restA = ta.slice(0, -1)
  const restB = tb.slice(0, -1)
  if (restA.length === 0 || restB.length === 0) return true
  return initials(restA) === restB.join("") || initials(restB) === restA.join("")
}

/**
 * Do two game ids name the same fixture?
 *
 * Game ids are built as "away@home" from whatever the feed called the teams,
 * and two feeds rarely agree, so the comparison cannot be character by
 * character. Home and away must line up, because a team pair alone cannot tell
 * this week's fixture from the reverse one later in the season.
 *
 * This is a heuristic and it can still be wrong: two distinct fixtures whose
 * four team names happen to corroborate pairwise would compare equal. Callers
 * matching one player's line therefore have to handle an ambiguous answer —
 * see pickemLinesFor — rather than trusting a single match.
 */
export function sameGameId(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const left = a.split("@")
  const right = b.split("@")
  if (left.length !== 2 || right.length !== 2) return false
  return sameTeamName(left[0], right[0]) && sameTeamName(left[1], right[1])
}
