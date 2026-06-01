import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_NETWORK, type NetworkName } from '../config'
import * as drive from '../lib/googleDrive'
import type { ChosenAccount } from '../lib/googleDrive'
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
  fetchPriceUsd,
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
  priceUsd: number | null
  history: TxSummary[]
  refreshing: boolean
  justCreated: boolean
  chosenAccount: ChosenAccount | null
  signIn: () => Promise<void>
  continueWithChosen: () => Promise<void>
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
  const [priceUsd, setPriceUsd] = useState<number | null>(null)
  const [history, setHistory] = useState<TxSummary[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [justCreated, setJustCreated] = useState(false)
  const [chosenAccount, setChosenAccount] = useState<ChosenAccount | null>(null)
  const oneTapStarted = useRef(false)

  // Wait for the Google script, then offer sign-in.
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
      const [bal, hist, price] = await Promise.all([
        fetchBalance(network, account.address),
        fetchHistory(network, account.address).catch(() => [] as TxSummary[]),
        fetchPriceUsd().catch(() => null),
      ])
      setBalance(bal)
      setHistory(hist)
      setPriceUsd(price)
    } catch {
      // Keep whatever we had; a transient explorer hiccup shouldn't blank the UI.
    } finally {
      setRefreshing(false)
    }
  }, [account, network])

  useEffect(() => {
    if (status === 'ready' && account) void refresh()
  }, [status, account, refresh])

  // After a Drive token is obtained, load the existing wallet or create a new one.
  const afterAuthorized = useCallback(async () => {
    setChosenAccount(null)
    setStatus('loadingWallet')
    const file = await drive.loadWallet()
    if (file) {
      setAccount(deriveAccount(file.mnemonic, network))
      setJustCreated(false)
      setStatus('ready')
      return
    }
    setStatus('creating')
    const mnemonic = generateMnemonic()
    const acct = deriveAccount(mnemonic, network)
    await drive.saveWallet({
      version: 1,
      network,
      mnemonic,
      createdAt: new Date().toISOString(),
    })
    const saved = await drive.loadWallet()
    if (!saved || saved.mnemonic !== mnemonic) {
      throw new Error('Your wallet was created but Google Drive did not confirm it saved. Please try again.')
    }
    setAccount(acct)
    setJustCreated(true)
    setStatus('ready')
  }, [network])

  // The fallback button: full account chooser.
  const signIn = useCallback(async () => {
    try {
      setError(null)
      setChosenAccount(null)
      setStatus('authorizing')
      await drive.signIn('select_account')
      await afterAuthorized()
    } catch (e) {
      setError(errMsg(e))
      setStatus('error')
    }
  }, [afterAuthorized])

  // Continue with the account picked from the One Tap chooser (shows consent if needed).
  const continueWithChosen = useCallback(async () => {
    const acct = chosenAccount
    if (!acct) return
    try {
      setError(null)
      setStatus('authorizing')
      await drive.authorizeWithConsent(acct.email)
      await afterAuthorized()
    } catch (e) {
      setError(errMsg(e))
      setStatus('error')
    }
  }, [chosenAccount, afterAuthorized])

  // Auto-show the Google account chooser (One Tap) once we're ready for sign-in.
  useEffect(() => {
    if (status !== 'signedOut' || oneTapStarted.current) return
    oneTapStarted.current = true
    drive.promptAccountChooser(async (acct) => {
      // The user picked an account from the list.
      try {
        setError(null)
        setStatus('authorizing')
        // Returning users (already granted Drive) get a token with no popup.
        await drive.authorizeSilently(acct.email)
        await afterAuthorized()
      } catch {
        // First-time / consent needed: surface a one-click "Continue as …".
        setChosenAccount(acct)
        setStatus('signedOut')
      }
    })
  }, [status, afterAuthorized])

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
    setChosenAccount(null)
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
    setChosenAccount(null)
    setStatus('signedOut')
  }, [])

  const dismissJustCreated = useCallback(() => setJustCreated(false), [])

  return {
    status,
    error,
    network,
    account,
    balance,
    priceUsd,
    history,
    refreshing,
    justCreated,
    chosenAccount,
    signIn,
    continueWithChosen,
    retry,
    refresh,
    buildTransaction,
    broadcast,
    signOut,
    deleteWallet,
    dismissJustCreated,
  }
}
