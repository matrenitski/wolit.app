import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_NETWORK, type NetworkName } from '../config'
import * as drive from '../lib/googleDrive'
import type { ChosenAccount } from '../lib/googleDrive'
import {
  createTransaction,
  deriveAccount,
  deriveAddress,
  generateMnemonic,
  type BuiltTx,
  type DerivedAccount,
} from '../lib/bitcoin'
import {
  fetchFeeRate,
  fetchWalletHistory,
  broadcastTx,
  fetchPriceUsd,
  type AddressStats,
  type TxSummary,
} from '../lib/esplora'
import { scanWallet } from '../lib/walletScan'

export type Status =
  | 'init'
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
  receiveAddress: string | null
  priceUsd: number | null
  history: TxSummary[]
  refreshing: boolean
  justCreated: boolean
  chosenAccount: ChosenAccount | null
  rememberedAccounts: ChosenAccount[]
  signIn: () => Promise<void>
  signInAs: (account: ChosenAccount) => Promise<void>
  useAnotherAccount: () => void
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
  const [receiveAddress, setReceiveAddress] = useState<string | null>(null)
  const [priceUsd, setPriceUsd] = useState<number | null>(null)
  const [history, setHistory] = useState<TxSummary[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [justCreated, setJustCreated] = useState(false)
  const [chosenAccount, setChosenAccount] = useState<ChosenAccount | null>(null)
  const [rememberedAccounts, setRememberedAccounts] = useState<ChosenAccount[]>(() =>
    drive.getRememberedAccounts(),
  )
  const oneTapStarted = useRef(false)

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
      const scan = await scanWallet(account)
      const [hist, price] = await Promise.all([
        fetchWalletHistory(network, scan.addresses).catch(() => [] as TxSummary[]),
        fetchPriceUsd().catch(() => null),
      ])
      setBalance({ confirmed: scan.confirmed, pending: scan.pending })
      setReceiveAddress(deriveAddress(account, 0, scan.receiveIndex).address)
      setHistory(hist)
      setPriceUsd(price)
    } catch {
      /* keep prior data on transient failures */
    } finally {
      setRefreshing(false)
    }
  }, [account, network])

  useEffect(() => {
    if (status === 'ready' && account) void refresh()
  }, [status, account, refresh])

  const afterAuthorized = useCallback(async () => {
    setChosenAccount(null)
    setStatus('loadingWallet')
    const file = await drive.loadWallet()
    if (file) {
      setAccount(deriveAccount(file.mnemonic, network, file.addressType ?? 'p2wpkh'))
      setJustCreated(false)
      setStatus('ready')
      return
    }
    setStatus('creating')
    const mnemonic = generateMnemonic()
    const acct = deriveAccount(mnemonic, network, 'p2tr')
    await drive.saveWallet({
      version: 2,
      network,
      mnemonic,
      addressType: 'p2tr',
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

  const remember = useCallback((acct: ChosenAccount) => {
    drive.rememberAccount(acct)
    setRememberedAccounts(drive.getRememberedAccounts())
  }, [])

  // Authorize a specific account (silent if already granted, else consent), then open its wallet.
  const authorizeAccount = useCallback(
    async (acct: ChosenAccount) => {
      try {
        setError(null)
        setStatus('authorizing')
        try {
          await drive.authorizeSilently(acct.email)
        } catch {
          await drive.authorizeWithConsent(acct.email)
        }
        remember(acct)
        await afterAuthorized()
      } catch (e) {
        setError(errMsg(e))
        setStatus('error')
      }
    },
    [afterAuthorized, remember],
  )

  const signInAs = useCallback(
    (acct: ChosenAccount) => authorizeAccount(acct),
    [authorizeAccount],
  )

  const continueWithChosen = useCallback(async () => {
    if (chosenAccount) await authorizeAccount(chosenAccount)
  }, [chosenAccount, authorizeAccount])

  // Show Google's One Tap chooser (gives us name + photo) to pick or add an account.
  const promptOneTap = useCallback(() => {
    drive.promptAccountChooser(async (acct) => {
      setError(null)
      setStatus('authorizing')
      try {
        try {
          await drive.authorizeSilently(acct.email)
        } catch {
          await drive.authorizeWithConsent(acct.email)
        }
        remember(acct)
        await afterAuthorized()
      } catch {
        // Consent popup blocked → offer a one-click "Continue as …".
        remember(acct)
        setChosenAccount(acct)
        setStatus('signedOut')
      }
    })
  }, [afterAuthorized, remember])

  const useAnotherAccount = useCallback(() => promptOneTap(), [promptOneTap])

  // The plain fallback button: full Google account chooser (used when One Tap can't show).
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

  // First arrival with no remembered accounts → auto-show the One Tap chooser.
  useEffect(() => {
    if (status !== 'signedOut' || oneTapStarted.current) return
    oneTapStarted.current = true
    if (rememberedAccounts.length === 0) promptOneTap()
  }, [status, rememberedAccounts.length, promptOneTap])

  const retry = useCallback(() => {
    setError(null)
    setStatus(account ? 'ready' : 'signedOut')
  }, [account])

  const buildTransaction = useCallback(
    async (toAddress: string, amountSats: number, sendMax: boolean): Promise<BuiltTx> => {
      if (!account) throw new Error('Wallet is not ready yet.')
      const [scan, feeRate] = await Promise.all([scanWallet(account), fetchFeeRate(network)])
      const changeAddress = deriveAddress(account, 1, scan.changeIndex).address
      return createTransaction({
        account,
        toAddress,
        amountSats,
        utxos: scan.utxos,
        feeRate,
        changeAddress,
        sendMax,
      })
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
    setReceiveAddress(null)
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
    setReceiveAddress(null)
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
    receiveAddress,
    priceUsd,
    history,
    refreshing,
    justCreated,
    chosenAccount,
    rememberedAccounts,
    signIn,
    signInAs,
    useAnotherAccount,
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
