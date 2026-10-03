import type { OddsFeedSettings } from "@/lib/store/schema"

/**
 * Which feed keys the server holds in its own environment.
 *
 * The routes read ODDS_API_KEY and PROPLINE_API_KEY first and fall back to a
 * key sent from Settings, so a local install configured only through
 * .env.local has a working feed while Settings stays empty. The page cannot see
 * the environment, so the server tells it which keys exist. Booleans only: a
 * key value never leaves the server.
 */
export interface ServerKeys {
  oddsApi: boolean
  propline: boolean
}

export const NO_SERVER_KEYS: ServerKeys = { oddsApi: false, propline: false }

/** Same test the routes apply before they use an environment key. */
function present(value: string | undefined): boolean {
  return !!value && value.trim().length > 0
}

/** Read from the server's environment. Server-side only: pass `process.env`. */
export function serverKeysFrom(env: Record<string, string | undefined>): ServerKeys {
  return { oddsApi: present(env.ODDS_API_KEY), propline: present(env.PROPLINE_API_KEY) }
}

/** The /api/keys response, read defensively: anything but a literal true is no key. */
export function parseServerKeys(json: unknown): ServerKeys {
  if (!json || typeof json !== "object") return NO_SERVER_KEYS
  const o = json as Record<string, unknown>
  return { oddsApi: o.oddsApi === true, propline: o.propline === true }
}

/**
 * Whether the selected provider has a key from either place, so a pull can
 * work. Mirrors the routes: the provider decides which key is needed.
 */
export function hasFeedKey(
  feed: Pick<OddsFeedSettings, "provider" | "apiKey" | "proplineKey">,
  server: ServerKeys,
): boolean {
  return feed.provider === "propline"
    ? present(feed.proplineKey) || server.propline
    : present(feed.apiKey) || server.oddsApi
}
