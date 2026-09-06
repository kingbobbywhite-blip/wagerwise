import { NextResponse } from "next/server"
import {
  DEFAULT_FEED_MARKETS,
  estimateCredits,
  eventOddsUrl,
  eventsUrl,
  normalizeMany,
} from "@/lib/odds-feed/theoddsapi"
import type { FeedEvent, FeedEventOdds } from "@/lib/odds-feed/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Server-side proxy for The Odds API.
 *
 * Two reasons this is not called from the browser directly: the feed does not
 * promise CORS headers, and an API key in page JavaScript is a key you have
 * given away. The key is read from ODDS_API_KEY when set, otherwise taken from
 * the request body, which is how the settings screen supplies it on a local
 * install. It is never logged and never returned.
 */

interface RequestBody {
  apiKey?: string
  markets?: string[]
  regions?: string
  bookmakers?: string[]
  /** Limit to these event ids. Omit to fetch the whole slate. */
  eventIds?: string[]
  /** Return the event list only, without pulling any odds. */
  eventsOnly?: boolean
}

function resolveKey(body: RequestBody): string | null {
  const fromEnv = process.env.ODDS_API_KEY
  if (fromEnv && fromEnv.trim()) return fromEnv.trim()
  if (body.apiKey && body.apiKey.trim()) return body.apiKey.trim()
  return null
}

async function fetchJson<T>(url: string): Promise<{ data: T; remaining: number | null; used: number | null }> {
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Feed returned ${res.status}. ${text.slice(0, 300)}`)
  }
  const remaining = Number(res.headers.get("x-requests-remaining"))
  const used = Number(res.headers.get("x-requests-used"))
  return {
    data: (await res.json()) as T,
    remaining: Number.isFinite(remaining) ? remaining : null,
    used: Number.isFinite(used) ? used : null,
  }
}

export async function POST(request: Request) {
  let body: RequestBody
  try {
    body = (await request.json()) as RequestBody
  } catch {
    return NextResponse.json({ error: "Request body was not valid JSON." }, { status: 400 })
  }

  const apiKey = resolveKey(body)
  if (!apiKey) {
    return NextResponse.json(
      { error: "No odds API key. Add one in Settings, or set ODDS_API_KEY in the environment." },
      { status: 400 },
    )
  }

  const markets = body.markets?.length ? body.markets : DEFAULT_FEED_MARKETS
  const regions = body.regions || "us,us2,eu"

  try {
    const events = await fetchJson<FeedEvent[]>(eventsUrl(apiKey))
    const wanted = body.eventIds?.length
      ? events.data.filter((e) => body.eventIds!.includes(e.id))
      : events.data

    if (body.eventsOnly) {
      return NextResponse.json({
        events: wanted,
        estimatedCredits: estimateCredits(wanted.length, markets.length),
        requestsRemaining: events.remaining,
        requestsUsed: events.used,
      })
    }

    // Player props are billed per market per event, so this loop is the
    // expensive part of the whole app. The client is expected to narrow the
    // event list and the market list before calling.
    const payloads: FeedEventOdds[] = []
    const failures: { eventId: string; error: string }[] = []
    let remaining: number | null = events.remaining
    let used: number | null = events.used

    for (const e of wanted) {
      try {
        const r = await fetchJson<FeedEventOdds>(
          eventOddsUrl(apiKey, e.id, { markets, regions, bookmakers: body.bookmakers }),
        )
        payloads.push(r.data)
        if (r.remaining != null) remaining = r.remaining
        if (r.used != null) used = r.used
      } catch (err) {
        failures.push({ eventId: e.id, error: err instanceof Error ? err.message : String(err) })
      }
    }

    const normalized = normalizeMany(payloads)

    return NextResponse.json({
      events: wanted,
      quotes: normalized.quotes,
      unknownMarkets: normalized.unknownMarkets,
      dropped: normalized.dropped.slice(0, 50),
      droppedCount: normalized.dropped.length,
      failures,
      requestsRemaining: remaining,
      requestsUsed: used,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not reach the odds feed." },
      { status: 502 },
    )
  }
}
