import * as bitcoin from 'bitcoinjs-lib'
import { BIP32Factory, type BIP32Interface } from 'bip32'
import { ECPairFactory } from 'ecpair'
import * as ecc from '@bitcoinerlab/secp256k1'
import * as bip39 from 'bip39'
import type { NetworkName } from '../config'

const bip32 = BIP32Factory(ecc)
const ECPair = ECPairFactory(ecc)

// Taproot (P2TR) needs an ECC backend for address validation and Schnorr signing.
bitcoin.initEccLib(ecc)

export type AddressType = 'p2wpkh' | 'p2tr'

/** Compressed pubkey → 32-byte x-only key (the Taproot internal key). */
function toXOnly(pubkey: Uint8Array): Buffer {
  return Buffer.from(pubkey.subarray(1, 33))
}

export function getNetwork(net: NetworkName): bitcoin.networks.Network {
  return net === 'mainnet' ? bitcoin.networks.bitcoin : bitcoin.networks.testnet
}

// BIP coin type: 0' for mainnet, 1' for all testnets.
function coinType(net: NetworkName): number {
  return net === 'mainnet' ? 0 : 1
}

export interface DerivedAccount {
  mnemonic: string
  network: NetworkName
  addressType: AddressType
  address: string // BIP86 bc1p… (new) or BIP84 bc1q… (legacy)
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
 * Derive the first receive account from a mnemonic.
 *  - 'p2tr'   → BIP86 Taproot,      m/86'/coin'/0'/0/0, bc1p…  (new wallets)
 *  - 'p2wpkh' → BIP84 native SegWit, m/84'/coin'/0'/0/0, bc1q…  (existing wallets)
 * Same seed, different address type — so a legacy wallet stays on its original bc1q address.
 */
export function deriveAccount(
  mnemonic: string,
  net: NetworkName,
  addressType: AddressType = 'p2wpkh',
): DerivedAccount {
  const seed = bip39.mnemonicToSeedSync(mnemonic.trim())
  const network = getNetwork(net)
  const root = bip32.fromSeed(seed, network)
  const purpose = addressType === 'p2tr' ? 86 : 84
  const path = `m/${purpose}'/${coinType(net)}'/0'/0/0`
  const node = root.derivePath(path)

  const address =
    addressType === 'p2tr'
      ? bitcoin.payments.p2tr({ internalPubkey: toXOnly(node.publicKey), network }).address
      : bitcoin.payments.p2wpkh({ pubkey: node.publicKey, network }).address
  if (!address) throw new Error('Could not derive a Bitcoin address')
  return { mnemonic, network: net, addressType, address, path, node }
}

export function isValidAddress(address: string, net: NetworkName): boolean {
  try {
    bitcoin.address.toOutputScript(address, getNetwork(net))
    return true
  } catch {
    return false
  }
}

/** Rough vsize estimate for fee planning: inputs * 68 + outputs * 31 + 11 overhead. */
function estimateVsize(nIn: number, nOut: number): number {
  return Math.ceil(nIn * 68 + nOut * 31 + 11)
}

/**
 * Select coins, build, and sign a transaction spending from our single address.
 * Handles both P2WPKH (legacy) and P2TR key-path (new) wallets.
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
  const isTaproot = account.addressType === 'p2tr'
  const xonly = isTaproot ? toXOnly(account.node.publicKey) : undefined
  const ownScript = isTaproot
    ? bitcoin.payments.p2tr({ internalPubkey: xonly!, network }).output!
    : bitcoin.address.toOutputScript(account.address, network)

  for (const u of selected) {
    psbt.addInput({
      hash: u.txid,
      index: u.vout,
      witnessUtxo: { script: ownScript, value: u.value },
      ...(isTaproot ? { tapInternalKey: xonly! } : {}),
    })
  }
  psbt.addOutput({ address: toAddress, value: sendAmount })
  if (change > 0) psbt.addOutput({ address: account.address, value: change })

  if (isTaproot) {
    // BIP86 key-path spend: tweak the internal key by taggedHash('TapTweak', internalKey),
    // then sign each input with a Schnorr signature.
    const tweaked = ECPair.fromPrivateKey(account.node.privateKey!, { network }).tweak(
      bitcoin.crypto.taggedHash('TapTweak', xonly!),
    )
    for (let i = 0; i < selected.length; i++) psbt.signInput(i, tweaked)
  } else {
    psbt.signAllInputs(account.node)
  }
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
