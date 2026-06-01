import { ESPLORA_BASE, type NetworkName } from '../config'
import type { Utxo } from './bitcoin'

function base(net: NetworkName): string {
  return ESPLORA_BASE[net]
}

export interface AddressStats {
  confirmed: number // sats
  pending: number // sats (unconfirmed mempool delta, can be negative)
}

export async function fetchBalance(net: NetworkName, address: string): Promise<AddressStats> {
  const res = await fetch(`${base(net)}/address/${address}`)
  if (!res.ok) throw new Error(`Couldn’t fetch balance (${res.status})`)
  const j = await res.json()
  const confirmed = j.chain_stats.funded_txo_sum - j.chain_stats.spent_txo_sum
  const pending = j.mempool_stats.funded_txo_sum - j.mempool_stats.spent_txo_sum
  return { confirmed, pending }
}

export async function fetchUtxos(net: NetworkName, address: string): Promise<Utxo[]> {
  const res = await fetch(`${base(net)}/address/${address}/utxo`)
  if (!res.ok) throw new Error(`Couldn’t fetch coins (${res.status})`)
  const j = await res.json()
  return (j as any[]).map((u) => ({ txid: u.txid, vout: u.vout, value: u.value }))
}

/** Recommended fee in sat/vByte (half-hour target), with sane fallbacks. */
export async function fetchFeeRate(net: NetworkName): Promise<number> {
  try {
    const res = await fetch(`${base(net)}/v1/fees/recommended`)
    if (res.ok) {
      const j = await res.json()
      const rate = j.halfHourFee ?? j.hourFee ?? j.economyFee
      if (typeof rate === 'number' && rate > 0) return rate
    }
  } catch {
    /* fall through to default */
  }
  return net === 'mainnet' ? 8 : 1
}

/** Current BTC price in USD from mempool.space, or null if unavailable. */
export async function fetchPriceUsd(): Promise<number | null> {
  try {
    const res = await fetch('https://mempool.space/api/v1/prices')
    if (!res.ok) return null
    const j = await res.json()
    return typeof j.USD === 'number' && j.USD > 0 ? j.USD : null
  } catch {
    return null
  }
}

export async function broadcastTx(net: NetworkName, hex: string): Promise<string> {
  const res = await fetch(`${base(net)}/tx`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: hex,
  })
  const text = (await res.text()).trim()
  if (!res.ok) throw new Error(text || `Broadcast failed (${res.status})`)
  return text // txid
}

export interface TxSummary {
  txid: string
  delta: number // net effect on the address: + received, - sent (sats)
  confirmed: boolean
  blockTime?: number
}

export async function fetchHistory(net: NetworkName, address: string): Promise<TxSummary[]> {
  const res = await fetch(`${base(net)}/address/${address}/txs`)
  if (!res.ok) throw new Error(`Couldn’t fetch history (${res.status})`)
  const txs = await res.json()
  return (txs as any[]).map((tx) => {
    let delta = 0
    for (const o of tx.vout) if (o.scriptpubkey_address === address) delta += o.value
    for (const i of tx.vin) if (i.prevout?.scriptpubkey_address === address) delta -= i.prevout.value
    return {
      txid: tx.txid,
      delta,
      confirmed: tx.status?.confirmed ?? false,
      blockTime: tx.status?.block_time,
    }
  })
}
