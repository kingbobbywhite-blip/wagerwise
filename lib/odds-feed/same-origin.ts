import { NextResponse } from "next/server"

/**
 * Refuse a feed request that did not come from this app's own pages.
 *
 * The feed routes spend a key the server holds (ODDS_API_KEY, PROPLINE_API_KEY)
 * whenever one is set. A page on any other site can POST to them: a text/plain
 * body is a "simple" request, so the browser sends it without asking first, and
 * the server would pull a slate on the visitor's quota. Requiring a JSON body
 * forces the browser to ask first, which these routes never answer, and the
 * Origin and Sec-Fetch-Site checks turn away anything a browser marks as
 * coming from elsewhere. The app's own fetches send JSON from the same origin.
 *
 * This guards against other pages in your browser, not against someone calling
 * a public deployment directly: that is why the README says to leave the keys
 * out of the environment on an unprotected URL.
 */
export function crossSiteRejection(request: Request): NextResponse | null {
  const type = (request.headers.get("content-type") ?? "").toLowerCase()
  if (!type.startsWith("application/json")) {
    return NextResponse.json({ error: "Send the request as application/json." }, { status: 415 })
  }
  const site = request.headers.get("sec-fetch-site")
  if (site && site !== "same-origin" && site !== "none") {
    return NextResponse.json({ error: "Cross-site requests are not accepted." }, { status: 403 })
  }
  const origin = request.headers.get("origin")
  if (origin) {
    let originHost: string | null = null
    try {
      originHost = new URL(origin).host
    } catch {
      originHost = null
    }
    if (!originHost || originHost !== request.headers.get("host")) {
      return NextResponse.json({ error: "Cross-site requests are not accepted." }, { status: 403 })
    }
  }
  return null
}
