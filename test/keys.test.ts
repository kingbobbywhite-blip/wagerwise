import { describe, expect, it } from "vitest"
import { NO_SERVER_KEYS, hasFeedKey, parseServerKeys, serverKeysFrom } from "@/lib/odds-feed/keys"
import type { OddsFeedSettings } from "@/lib/store/schema"

type Feed = Pick<OddsFeedSettings, "provider" | "apiKey" | "proplineKey">

const oddsApi = (apiKey = "", proplineKey = ""): Feed => ({ provider: "theoddsapi", apiKey, proplineKey })
const propline = (proplineKey = "", apiKey = ""): Feed => ({ provider: "propline", apiKey, proplineKey })

describe("serverKeysFrom", () => {
  it("reports which keys the environment holds", () => {
    expect(serverKeysFrom({ ODDS_API_KEY: "abc" })).toEqual({ oddsApi: true, propline: false })
    expect(serverKeysFrom({ PROPLINE_API_KEY: "xyz" })).toEqual({ oddsApi: false, propline: true })
    expect(serverKeysFrom({ ODDS_API_KEY: "abc", PROPLINE_API_KEY: "xyz" })).toEqual({ oddsApi: true, propline: true })
    expect(serverKeysFrom({})).toEqual(NO_SERVER_KEYS)
  })

  it("treats a blank variable as unset, the way the routes do", () => {
    expect(serverKeysFrom({ ODDS_API_KEY: "", PROPLINE_API_KEY: "   " })).toEqual(NO_SERVER_KEYS)
  })

  it("returns booleans only, never a key", () => {
    const out = serverKeysFrom({ ODDS_API_KEY: "secret-odds", PROPLINE_API_KEY: "secret-propline" })
    expect(Object.keys(out).sort()).toEqual(["oddsApi", "propline"])
    expect(JSON.stringify(out)).not.toContain("secret")
  })
})

describe("parseServerKeys", () => {
  it("reads a well-formed response", () => {
    expect(parseServerKeys({ oddsApi: true, propline: false })).toEqual({ oddsApi: true, propline: false })
  })

  it("counts anything but a literal true as no key", () => {
    expect(parseServerKeys(null)).toEqual(NO_SERVER_KEYS)
    expect(parseServerKeys("yes")).toEqual(NO_SERVER_KEYS)
    expect(parseServerKeys({ oddsApi: "true", propline: 1 })).toEqual(NO_SERVER_KEYS)
  })
})

describe("hasFeedKey", () => {
  it("is ready with only ODDS_API_KEY in the environment and nothing in Settings", () => {
    expect(hasFeedKey(oddsApi(), { oddsApi: true, propline: false })).toBe(true)
  })

  it("is ready with only a key in Settings", () => {
    expect(hasFeedKey(oddsApi("abc"), NO_SERVER_KEYS)).toBe(true)
    expect(hasFeedKey(propline("xyz"), NO_SERVER_KEYS)).toBe(true)
  })

  it("is not ready with neither", () => {
    expect(hasFeedKey(oddsApi(), NO_SERVER_KEYS)).toBe(false)
    expect(hasFeedKey(oddsApi("   "), NO_SERVER_KEYS)).toBe(false)
    expect(hasFeedKey(propline(), NO_SERVER_KEYS)).toBe(false)
  })

  it("needs the key for the selected provider, not the other one", () => {
    expect(hasFeedKey(propline(), { oddsApi: true, propline: false })).toBe(false)
    expect(hasFeedKey(propline("", "abc"), NO_SERVER_KEYS)).toBe(false)
    expect(hasFeedKey(oddsApi(), { oddsApi: false, propline: true })).toBe(false)
    expect(hasFeedKey(oddsApi("", "xyz"), NO_SERVER_KEYS)).toBe(false)
  })

  it("is ready for PropLine with only PROPLINE_API_KEY in the environment", () => {
    expect(hasFeedKey(propline(), { oddsApi: false, propline: true })).toBe(true)
  })
})
