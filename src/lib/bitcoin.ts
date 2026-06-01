import * as bitcoin from 'bitcoinjs-lib'
import { BIP32Factory, type BIP32Interface } from 'bip32'
import * as ecc from '@bitcoinerlab/secp256k1'
import * as bip39 from 'bip39'
import type { NetworkName } from '../config'

const bip32 = BIP32Factory(ecc)

// Enable Taproot (bc1p…) addresses as send recipients. bitcoinjs-lib needs an ECC
// backend to validate witness-v1 (P2TR) outputs; without this, sending to a bc1p
// address throws "No ECC Library provided. You must call initEccLib()".
bitcoin.initEccLib(ecc)

export function getNetwork(net: NetworkName): bitcoin.networks.Network {
  return net === 'mainnet' ? bitcoin.networks.bitcoin : bitcoin.networks.testnet
}

// BIP84 coin type: 0' for mainnet, 1' for all testnets.
function coinType(net: NetworkName): number {
  return net === 'mainnet' ? 0 : 1
}

export interface DerivedAccount {
  mnemonic: string
  network: NetworkName
  address: string // first receive address: m/84'/coin'/0'/0/0
  path: string
  node: BIP32Interface // signing key for that address
}

export interface Utxo {
  txid: string
  vout: number
  value: number // satoshis
}

export interface BuiltTx {
  hex: string
  txid: string
  fee: number // satoshis
  change: number // satoshis
  vsize: number
  amount: number // satoshis actually sent to the recipient
}

const DUST = 546 // sats — below this an output is not worth creating

/** Generate a fresh 12-word BIP39 mnemonic. */
export function generateMnemonic(): string {
  return bip39.generateMnemonic(128)
}

export function isValidMnemonic(m: string): boolean {
  return bip39.validateMnemonic(m.trim())
}

/**
 * Derive the first native-SegWit (BIP84, bc1/tb1) receive account from a mnemonic.
 * For an MVP single-address wallet this is all we need.
 */
export function deriveAccount(mnemonic: string, net: NetworkName): DerivedAccount {
  const seed = bip39.mnemonicToSeedSync(mnemonic.trim())
  const network = getNetwork(net)
  const root = bip32.fromSeed(seed, network)
  const path = `m/84'/${coinType(net)}'/0'/0/0`
  const node = root.derivePath(path)
  const { address } = bitcoin.payments.p2wpkh({ pubkey: node.publicKey, network })
  if (!address) throw new Error('Could not derive a Bitcoin address')
  return { mnemonic, network: net, address, path, node }
}

export function isValidAddress(address: string, net: NetworkName): boolean {
  try {
    bitcoin.address.toOutputScript(address, getNetwork(net))
    return true
  } catch {
    return false
  }
}

/** Rough vsize for a P2WPKH tx: inputs * 68 + outputs * 31 + 11 overhead. */
function estimateVsize(nIn: number, nOut: number): number {
  return Math.ceil(nIn * 68 + nOut * 31 + 11)
}

/**
 * Select coins, build, and sign a transaction spending from our single address.
 * Throws a user-friendly Error if funds are insufficient or the address is bad.
 */
export function createTransaction(params: {
  account: DerivedAccount
  toAddress: string
  amountSats: number
  utxos: Utxo[]
  feeRate: number // sat/vByte
  sendMax?: boolean
}): BuiltTx {
  const { account, toAddress, amountSats, utxos, feeRate, sendMax } = params
  const network = getNetwork(account.network)

  if (!isValidAddress(toAddress, account.network)) {
    throw new Error('That doesn’t look like a valid address for this network.')
  }
  if (utxos.length === 0) throw new Error('No spendable coins yet.')

  const ownScript = bitcoin.address.toOutputScript(account.address, network)
  const sorted = [...utxos].sort((a, b) => b.value - a.value)
  const totalAvailable = sorted.reduce((s, u) => s + u.value, 0)

  let selected: Utxo[] = []
  let inSum = 0

  if (sendMax) {
    selected = sorted
    inSum = totalAvailable
  } else {
    for (const u of sorted) {
      selected.push(u)
      inSum += u.value
      const projectedFee = Math.ceil(estimateVsize(selected.length, 2) * feeRate)
      if (inSum >= amountSats + projectedFee) break
    }
  }

  let outputs = sendMax ? 1 : 2
  let fee = Math.ceil(estimateVsize(selected.length, outputs) * feeRate)
  let sendAmount = amountSats
  let change = 0

  if (sendMax) {
    sendAmount = inSum - fee
    if (sendAmount < DUST) throw new Error('Balance is too low to cover the network fee.')
  } else {
    if (inSum < amountSats + fee) {
      throw new Error('Not enough funds to cover the amount plus the network fee.')
    }
    change = inSum - amountSats - fee
    if (change < DUST) {
      // Not worth a change output — fold the dust into the fee.
      fee += change
      change = 0
      outputs = 1
    }
  }

  const psbt = new bitcoin.Psbt({ network })
  for (const u of selected) {
    psbt.addInput({
      hash: u.txid,
      index: u.vout,
      witnessUtxo: { script: ownScript, value: u.value },
    })
  }
  psbt.addOutput({ address: toAddress, value: sendAmount })
  if (change > 0) psbt.addOutput({ address: account.address, value: change })

  psbt.signAllInputs(account.node)
  psbt.finalizeAllInputs()

  const tx = psbt.extractTransaction()
  return {
    hex: tx.toHex(),
    txid: tx.getId(),
    fee,
    change,
    vsize: tx.virtualSize(),
    amount: sendAmount,
  }
}
