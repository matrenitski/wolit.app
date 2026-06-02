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

function purposeFor(addressType: AddressType): number {
  return addressType === 'p2tr' ? 86 : 84
}

function addressFromNode(
  node: BIP32Interface,
  addressType: AddressType,
  network: bitcoin.networks.Network,
): string {
  const address =
    addressType === 'p2tr'
      ? bitcoin.payments.p2tr({ internalPubkey: toXOnly(node.publicKey), network }).address
      : bitcoin.payments.p2wpkh({ pubkey: node.publicKey, network }).address
  if (!address) throw new Error('Could not derive a Bitcoin address')
  return address
}

function scriptForNode(
  node: BIP32Interface,
  addressType: AddressType,
  network: bitcoin.networks.Network,
): Buffer {
  const output =
    addressType === 'p2tr'
      ? bitcoin.payments.p2tr({ internalPubkey: toXOnly(node.publicKey), network }).output
      : bitcoin.payments.p2wpkh({ pubkey: node.publicKey, network }).output
  if (!output) throw new Error('Could not derive output script')
  return Buffer.from(output)
}

/** An HD account: the account-level node from which receive/change addresses derive. */
export interface DerivedAccount {
  mnemonic: string
  network: NetworkName
  addressType: AddressType
  accountNode: BIP32Interface // m/purpose'/coin'/0'
  address: string // primary receive address (external/0) — for first display
  path: string
}

/** A derived address + the key that controls it. chain: 0 = receive, 1 = change. */
export interface AddressKey {
  address: string
  chain: 0 | 1
  index: number
  node: BIP32Interface
}

export interface Utxo {
  txid: string
  vout: number
  value: number // satoshis
}

/** A UTXO tagged with the address/key that controls it (so we can sign it). */
export interface OwnedUtxo extends Utxo {
  key: AddressKey
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

export function generateMnemonic(): string {
  return bip39.generateMnemonic(128)
}

export function isValidMnemonic(m: string): boolean {
  return bip39.validateMnemonic(m.trim())
}

/**
 * Derive an HD account from a mnemonic.
 *  - 'p2tr'   → BIP86 Taproot,       m/86'/coin'/0'/…  bc1p…  (new wallets)
 *  - 'p2wpkh' → BIP84 native SegWit, m/84'/coin'/0'/…  bc1q…  (existing wallets)
 */
export function deriveAccount(
  mnemonic: string,
  net: NetworkName,
  addressType: AddressType = 'p2wpkh',
): DerivedAccount {
  const seed = bip39.mnemonicToSeedSync(mnemonic.trim())
  const network = getNetwork(net)
  const root = bip32.fromSeed(seed, network)
  const purpose = purposeFor(addressType)
  const accountNode = root.derivePath(`m/${purpose}'/${coinType(net)}'/0'`)
  const first = accountNode.derive(0).derive(0)
  const address = addressFromNode(first, addressType, network)
  const path = `m/${purpose}'/${coinType(net)}'/0'/0/0`
  return { mnemonic, network: net, addressType, accountNode, address, path }
}

/** Derive the address + signing key at (chain, index). chain: 0 = receive, 1 = change. */
export function deriveAddress(account: DerivedAccount, chain: 0 | 1, index: number): AddressKey {
  const node = account.accountNode.derive(chain).derive(index)
  const address = addressFromNode(node, account.addressType, getNetwork(account.network))
  return { address, chain, index, node }
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
 * Select coins from across the wallet's addresses, build, and sign a transaction.
 * Each input is signed with the key that controls it (P2WPKH or P2TR key-path).
 * Change goes to `changeAddress` (a fresh change address). Throws a friendly Error
 * if funds are insufficient or the recipient address is invalid.
 */
export function createTransaction(params: {
  account: DerivedAccount
  toAddress: string
  amountSats: number
  utxos: OwnedUtxo[]
  feeRate: number // sat/vByte
  changeAddress: string
  sendMax?: boolean
}): BuiltTx {
  const { account, toAddress, amountSats, utxos, feeRate, changeAddress, sendMax } = params
  const network = getNetwork(account.network)
  const isTaproot = account.addressType === 'p2tr'

  if (!isValidAddress(toAddress, account.network)) {
    throw new Error('That doesn’t look like a valid address for this network.')
  }
  if (utxos.length === 0) throw new Error('No spendable coins yet.')

  const sorted = [...utxos].sort((a, b) => b.value - a.value)
  const totalAvailable = sorted.reduce((s, u) => s + u.value, 0)

  let selected: OwnedUtxo[] = []
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
      fee += change
      change = 0
      outputs = 1
    }
  }

  const psbt = new bitcoin.Psbt({ network })
  for (const u of selected) {
    const script = scriptForNode(u.key.node, account.addressType, network)
    psbt.addInput({
      hash: u.txid,
      index: u.vout,
      witnessUtxo: { script, value: u.value },
      ...(isTaproot ? { tapInternalKey: toXOnly(u.key.node.publicKey) } : {}),
    })
  }
  psbt.addOutput({ address: toAddress, value: sendAmount })
  if (change > 0) psbt.addOutput({ address: changeAddress, value: change })

  for (let i = 0; i < selected.length; i++) {
    const node = selected[i].key.node
    if (isTaproot) {
      const tweaked = ECPair.fromPrivateKey(node.privateKey!, { network }).tweak(
        bitcoin.crypto.taggedHash('TapTweak', toXOnly(node.publicKey)),
      )
      psbt.signInput(i, tweaked)
    } else {
      psbt.signInput(i, node)
    }
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
