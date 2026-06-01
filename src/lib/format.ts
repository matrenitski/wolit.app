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
