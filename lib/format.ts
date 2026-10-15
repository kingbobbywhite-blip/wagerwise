export function pct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`
}

export function signedPct(x: number, digits = 1): string {
  const v = x * 100
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`
}

export function money(x: number): string {
  return x.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 })
}

export function signedNumber(x: number, digits = 1): string {
  return `${x >= 0 ? "+" : ""}${x.toFixed(digits)}`
}

export function multiple(x: number): string {
  return `${Number.isInteger(x) ? x : x.toFixed(2)}x`
}

export function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

/** "PrizePicks'" and "Underdog Fantasy's": names ending in s take a bare apostrophe. */
export function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`
}

/** "a", "a and b", "a, b and c". */
export function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ""
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}

/** A size in characters as UTF-16 bytes, which is how the strictest browsers meter storage: "640 KB", "1.4 MB". */
export function storageSize(chars: number): string {
  const bytes = chars * 2
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
