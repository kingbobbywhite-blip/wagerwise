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
