/**
 * Request plumbing shared by the routes that call the odds feeds: reading The
 * Odds API's quota headers and errors, turning a thrown fetch into a sentence,
 * and the two decisions every pull makes the same way (which games are still
 * worth pricing, and whether a pull priced anything at all).
 */

/**
 * A count from a response header, or null when the header is absent or not a
 * number. Number(null) is 0, which read as "no requests left" whenever a
 * response arrived without the header.
 */
export function headerCount(headers: Headers, name: string): number | null {
  const raw = headers.get(name)
  if (raw == null || raw.trim() === "") return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/** A readable sentence from a failed Odds API response, naming an exhausted quota as such. */
export async function oddsApiErrorText(res: Response): Promise<string> {
  const text = await res.text().catch(() => "")
  let detail = text.slice(0, 300)
  let code: string | null = null
  try {
    const body = JSON.parse(text) as { message?: unknown; error_code?: unknown }
    if (typeof body.message === "string") detail = body.message
    if (typeof body.error_code === "string") code = body.error_code
  } catch {
    // Not JSON: the raw text is the best there is.
  }
  if (code === "OUT_OF_USAGE_CREDITS") return `The Odds API quota is used up for this period. ${detail}`.trim()
  if (res.status === 401) return `The Odds API rejected the API key. ${detail}`.trim()
  if (res.status === 429) return `The Odds API is limiting requests. Wait a minute and try again. ${detail}`.trim()
  return `The Odds API returned ${res.status}. ${detail}`.trim()
}

/** GET a JSON payload from The Odds API, with the quota it reports. */
export async function fetchOddsApi<T>(url: string): Promise<{ data: T; remaining: number | null; used: number | null }> {
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) throw new Error(await oddsApiErrorText(res))
  return {
    data: (await res.json()) as T,
    remaining: headerCount(res.headers, "x-requests-remaining"),
    used: headerCount(res.headers, "x-requests-used"),
  }
}

/**
 * The message for an error thrown while calling a feed. fetch reports an
 * unreachable host as a bare "fetch failed" and a non-JSON body as a parser
 * error, neither of which says that the feed, not the app, is the problem.
 */
export function feedErrorText(err: unknown, feed: string): string {
  if (err instanceof TypeError && /fetch failed/i.test(err.message)) {
    return `Could not reach ${feed}. Check the internet connection and try again.`
  }
  if (err instanceof SyntaxError) return `${feed} sent a response this app could not read. Try again in a minute.`
  return err instanceof Error ? err.message : String(err)
}

/**
 * Whether a game is still ahead of us. Once it starts, its lines move with the
 * score and the pick'em apps close it, so a pregame pick on it can no longer be
 * played: pulling it spends quota on prices nobody can use. A start time that
 * cannot be read is kept, because there is no telling.
 */
export function notStarted(commenceTime: string | null | undefined, now: number): boolean {
  const t = commenceTime ? Date.parse(commenceTime) : NaN
  return !Number.isFinite(t) || t > now
}

/**
 * When every game's request failed, the error to answer with instead of an
 * empty slate. An empty 200 reads as "no props posted yet" and replaces the
 * last good pull, which may have cost credits that are now used up.
 */
export function noneCouldBePriced(selected: number, priced: number, failures: { error: string }[]): string | null {
  if (selected === 0 || priced > 0 || failures.length === 0) return null
  return `None of the ${selected} game${selected === 1 ? "" : "s"} could be priced. ${failures[0].error}`
}
