import { describe, expect, it } from "vitest"
import { crossSiteRejection } from "@/lib/odds-feed/same-origin"

function req(headers: Record<string, string>): Request {
  return new Request("http://localhost:3000/api/today", { method: "POST", headers, body: "{}" })
}

describe("crossSiteRejection", () => {
  it("lets the app's own JSON request through", () => {
    expect(
      crossSiteRejection(
        req({ "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000", "sec-fetch-site": "same-origin" }),
      ),
    ).toBeNull()
    // Older browsers and server-side callers send neither header.
    expect(crossSiteRejection(req({ "content-type": "application/json; charset=utf-8", host: "localhost:3000" }))).toBeNull()
  })

  it("refuses a text/plain body, the kind another site can send without asking first", () => {
    expect(crossSiteRejection(req({ "content-type": "text/plain", host: "localhost:3000" }))?.status).toBe(415)
  })

  it("refuses a request the browser marks as cross-site, or from another origin", () => {
    expect(
      crossSiteRejection(req({ "content-type": "application/json", host: "localhost:3000", "sec-fetch-site": "cross-site" }))?.status,
    ).toBe(403)
    expect(
      crossSiteRejection(req({ "content-type": "application/json", host: "localhost:3000", origin: "https://evil.example" }))?.status,
    ).toBe(403)
    expect(crossSiteRejection(req({ "content-type": "application/json", host: "localhost:3000", origin: "null" }))?.status).toBe(403)
  })
})
