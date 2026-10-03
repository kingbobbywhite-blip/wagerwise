import { NextResponse } from "next/server"
import { serverKeysFrom } from "@/lib/odds-feed/keys"

export const runtime = "nodejs"
// Read the environment on every request, never at build time: a key added to
// .env.local or the host after a build must still count.
export const dynamic = "force-dynamic"

/**
 * Whether ODDS_API_KEY and PROPLINE_API_KEY are set on the server, so the
 * Today page can enable its button on an install configured only through the
 * environment. Returns booleans and nothing else: never a key, never a prefix.
 */
export function GET() {
  return NextResponse.json(serverKeysFrom(process.env), { headers: { "cache-control": "no-store" } })
}
