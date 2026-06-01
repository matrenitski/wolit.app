import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_NETWORK, type NetworkName } from '../config'
import * as drive from '../lib/googleDrive'
import {
  createTransaction,
  deriveAccount,
  generateMnemonic,
  type BuiltTx,
  type DerivedAccount,
} from '../lib/bitcoin'
import {
  fetchBalance,
  fetchFeeRate,
  fetchHistory,
  fetchUtxos,
  broadcastTx,
  type AddressStats,
  type TxSummary,
} from '../lib/esplora'

export type Status =
  | 'init' // waiting for Google Identity Services to load
  | 'signedOut'
  | 'authorizing'
  | 'loadingWallet'
  | 'creating'
  | 'ready'
  | 'error'

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export interface UseWallet {
  status: Status
  error: string | null
  network: NetworkName
  account: DerivedAccount | null
  balance: AddressStats | null
  history: TxSummary[]
  refreshing: boolean
  justCreated: boolean
  signIn: () => Promise<void>
  retry: () => void
  refresh: () => Promise<void>
  buildTransaction: (toAddress: string, amountSats: number, sendMax: boolean) => Promise<BuiltTx>
  broadcast: (hex: string) => Promise<string>
  signOut: () => void
  deleteWallet: () => Promise<void>
  dismissJustCreated: () => void
}

export function useWallet(): UseWallet {
  const network = DEFAULT_NETWORK
  const [status, setStatus] = useState<Status>('init')
  const [error, setError] = useState<string | null>(null)
  const [account, setAccount] = useState<DerivedAccount | null>(null)
  const [balance, setBalance] = useState<AddressStats | null>(null)
  const [history, setHistory] = useState<TxSummary[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [justCreated, setJustCreated] = useState(false)

  // Wait for the Google script before offering sign-in.
  useEffect(() => {
    let cancelled = false
    drive
      .waitForGis()
      .then(() => {
        if (!cancelled) setStatus((s) => (s === 'init' ? 'signedOut' : s))
      })
      .catch((e) => {
        if (!cancelled) {
          setError(errMsg(e))
          setStatus('error')
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!account) return
    setRefreshing(true)
    try {
      const [bal, hist] = await Promise.all([
        fetchBalance(network, account.address),
        fetchHistory(network, account.address).catch(() => [] as TxSummary[]),
      ])
      setBalance(bal)
      setHistory(hist)
    } catch {
      // Keep whatever we had; a transient explorer hiccup shouldn't blank the UI.
    } finally {
      setRefreshing(false)
    }
  }, [account, network])

  // Load chain data once the wallet is ready.
  useEffect(() => {
    if (status === 'ready' && account) void refresh()
  }, [status, account, refresh])

  const signIn = useCallback(async () => {
    try {
      setError(null)
      setStatus('authorizing')
      await drive.signIn('select_account')

      setStatus('loadingWallet')
      const file = await drive.loadWallet()

      if (file) {
        setAccount(deriveAccount(file.mnemonic, network))
        setJustCreated(false)
        setStatus('ready')
      } else {
        setStatus('creating')
        const mnemonic = generateMnemonic()
        const acct = deriveAccount(mnemonic, network)
        await drive.saveWallet({
          version: 1,
          network,
          mnemonic,
          createdAt: new Date().toISOString(),
        })
        // Read the key back from Drive and confirm it round-trips BEFORE we ever
        // show a fundable wallet. This is the safeguard against the old build's
        // fatal bug, where a key could exist only in the session and vanish on
        // refresh. Here the durable Drive file is the single source of truth.
        const saved = await drive.loadWallet()
        if (!saved || saved.mnemonic !== mnemonic) {
          throw new Error(
            'Your wallet was created but Google Drive did not confirm it saved. Please try again.',
          )
        }
        setAccount(acct)
        setJustCreated(true)
        setStatus('ready')
      }
    } catch (e) {
      setError(errMsg(e))
      setStatus('error')
    }
  }, [network])

  const retry = useCallback(() => {
    setError(null)
    setStatus(account ? 'ready' : 'signedOut')
  }, [account])

  const buildTransaction = useCallback(
    async (toAddress: string, amountSats: number, sendMax: boolean): Promise<BuiltTx> => {
      if (!account) throw new Error('Wallet is not ready yet.')
      const [utxos, feeRate] = await Promise.all([
        fetchUtxos(network, account.address),
        fetchFeeRate(network),
      ])
      return createTransaction({ account, toAddress, amountSats, utxos, feeRate, sendMax })
    },
    [account, network],
  )

  const broadcast = useCallback(
    async (hex: string): Promise<string> => {
      const txid = await broadcastTx(network, hex)
      // Give the explorer a moment to register the tx, then refresh balances.
      setTimeout(() => void refresh(), 1500)
      return txid
    },
    [network, refresh],
  )

  const signOut = useCallback(() => {
    drive.signOut()
    setAccount(null)
    setBalance(null)
    setHistory([])
    setJustCreated(false)
    setError(null)
    setStatus('signedOut')
  }, [])

  const deleteWallet = useCallback(async () => {
    await drive.deleteWallet()
    drive.signOut()
    setAccount(null)
    setBalance(null)
    setHistory([])
    setJustCreated(false)
    setStatus('signedOut')
  }, [])

  const dismissJustCreated = useCallback(() => setJustCreated(false), [])

  return {
    status,
    error,
    network,
    account,
    balance,
    history,
    refreshing,
    justCreated,
    signIn,
    retry,
    refresh,
    buildTransaction,
    broadcast,
    signOut,
    deleteWallet,
    dismissJustCreated,
  }
}
