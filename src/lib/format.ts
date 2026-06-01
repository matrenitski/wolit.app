export const SATS_PER_BTC = 100_000_000

export function satsToBtc(sats: number): number {
  return sats / SATS_PER_BTC
}

export function btcToSats(btc: string | number): number {
  const n = typeof btc === 'string' ? parseFloat(btc) : btc
  if (!isFinite(n)) return NaN
  return Math.round(n * SATS_PER_BTC)
}

/** Format satoshis as a BTC string, trimming trailing zeros (min 1 decimal). */
export function formatBtc(sats: number): string {
  const btc = satsToBtc(Math.abs(sats))
  let s = btc.toFixed(8)
  s = s.replace(/0+$/, '').replace(/\.$/, '.0')
  return (sats < 0 ? '-' : '') + s
}

export function shortAddr(a: string, lead = 10, tail = 6): string {
  return a.length > lead + tail + 1 ? `${a.slice(0, lead)}…${a.slice(-tail)}` : a
}

/** Convert satoshis to a formatted USD string given a BTC/USD price, or null. */
export function formatUsd(sats: number, priceUsd: number | null): string | null {
  if (priceUsd == null) return null
  const usd = (sats / SATS_PER_BTC) * priceUsd
  return usd.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: Math.abs(usd) >= 1000 ? 0 : 2,
  })
}

/** A compact relative time like "3m ago" / "2h ago" from a unix timestamp. */
export function relativeTime(unixSeconds?: number): string {
  if (!unixSeconds) return 'pending'
  const diff = Date.now() / 1000 - unixSeconds
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`
  return new Date(unixSeconds * 1000).toLocaleDateString()
}
