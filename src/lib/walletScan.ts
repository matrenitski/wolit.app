import { deriveAddress, type DerivedAccount, type OwnedUtxo } from './bitcoin'
import { fetchAddressStats, fetchUtxos } from './esplora'

const GAP_LIMIT = 20
const BATCH = 5 // addresses scanned in parallel per round

export interface WalletScan {
  confirmed: number // sats
  pending: number // sats
  utxos: OwnedUtxo[] // spendable coins across all addresses
  receiveIndex: number // first unused external index → next receive address
  changeIndex: number // first unused change index → change output
  addresses: string[] // all used addresses (external + change), for history
}

interface ChainScan {
  utxos: OwnedUtxo[]
  firstUnused: number
  usedAddresses: string[]
  confirmed: number
  pending: number
}

async function scanChain(account: DerivedAccount, chain: 0 | 1): Promise<ChainScan> {
  let consecutiveUnused = 0
  let index = 0
  let firstUnused = -1
  const utxos: OwnedUtxo[] = []
  const usedAddresses: string[] = []
  let confirmed = 0
  let pending = 0

  while (consecutiveUnused < GAP_LIMIT) {
    const keys = Array.from({ length: BATCH }, (_, k) => deriveAddress(account, chain, index + k))
    const stats = await Promise.all(keys.map((key) => fetchAddressStats(account.network, key.address)))

    let stop = false
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k]
      const s = stats[k]
      if (s.used) {
        usedAddresses.push(key.address)
        confirmed += s.confirmed
        pending += s.pending
        consecutiveUnused = 0
        if (s.confirmed + s.pending > 0) {
          const u = await fetchUtxos(account.network, key.address)
          for (const x of u) utxos.push({ ...x, key })
        }
      } else {
        if (firstUnused < 0) firstUnused = key.index
        consecutiveUnused++
        if (consecutiveUnused >= GAP_LIMIT) {
          stop = true
          break // ignore the rest of this over-scanned batch
        }
      }
    }
    index += BATCH
    if (stop) break
  }
  return { utxos, firstUnused: firstUnused < 0 ? index : firstUnused, usedAddresses, confirmed, pending }
}

/** Gap-limit scan of the receive (0) and change (1) chains → balance, UTXOs, next addresses. */
export async function scanWallet(account: DerivedAccount): Promise<WalletScan> {
  const external = await scanChain(account, 0)
  const change = await scanChain(account, 1)
  return {
    confirmed: external.confirmed + change.confirmed,
    pending: external.pending + change.pending,
    utxos: [...external.utxos, ...change.utxos],
    receiveIndex: external.firstUnused,
    changeIndex: change.firstUnused,
    addresses: [...external.usedAddresses, ...change.usedAddresses],
  }
}
