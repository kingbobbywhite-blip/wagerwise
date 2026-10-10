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
 * "Minnesota Timberwolves" to "timberwolves". The nickname is unique within a
 * league and survives the differences between feeds ("LA Clippers" against
 * "Los Angeles Clippers"), where the full name does not.
 */
export function teamNickname(name: string): string {
  const words = normalizeName(name).split(" ").filter(Boolean)
  return words[words.length - 1] ?? ""
}

/**
 * Do two game ids name the same fixture?
 *
 * Game ids are built as "away@home" from whatever the feed called the teams,
 * and two feeds rarely agree: "Ohio St" against "Ohio State Buckeyes". So the
 * strings are compared by nickname rather than character by character. Home
 * and away must still line up, because a nickname pair alone cannot tell this
 * week's fixture from the reverse one later in the season.
 */
export function sameGameId(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const left = a.split("@")
  const right = b.split("@")
  if (left.length !== 2 || right.length !== 2) return false
  return teamNickname(left[0]) === teamNickname(right[0]) && teamNickname(left[1]) === teamNickname(right[1])
}
