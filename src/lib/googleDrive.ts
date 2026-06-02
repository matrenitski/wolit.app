import { DRIVE_SCOPE, GOOGLE_CLIENT_ID, WALLET_FILE_NAME, type NetworkName } from '../config'

// The Google access token lives only in memory for the session. It is short-lived
// (~1 hour) and never persisted — the app's backend (there isn't one) never sees it.
let accessToken: string | null = null
let tokenExpiry = 0

export interface WalletFile {
  version: number
  network: NetworkName
  mnemonic: string
  createdAt: string
  /** 'p2tr' = BIP86 Taproot (new wallets). Absent/'p2wpkh' = BIP84 legacy. */
  addressType?: 'p2wpkh' | 'p2tr'
}

function gisReady(): boolean {
  return !!window.google?.accounts?.oauth2
}

/** Wait for the Google Identity Services script to finish loading. */
export async function waitForGis(timeoutMs = 8000): Promise<void> {
  const start = Date.now()
  while (!gisReady()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Google sign-in failed to load. Check your connection and refresh.')
    }
    await new Promise((r) => setTimeout(r, 100))
  }
}

export function isSignedIn(): boolean {
  return !!accessToken && Date.now() < tokenExpiry
}

/** Low-level: request a Drive access token, optionally targeting a specific account. */
function tokenRequest(opts: {
  prompt: '' | 'consent' | 'select_account'
  hint?: string
}): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!GOOGLE_CLIENT_ID) {
      reject(
        new Error(
          'This app has not been configured yet: missing Google Client ID (VITE_GOOGLE_CLIENT_ID).',
        ),
      )
      return
    }
    if (!gisReady()) {
      reject(new Error('Google sign-in is not ready yet. Please try again in a moment.'))
      return
    }
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      hint: opts.hint,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error_description || resp.error || 'Authorization failed.'))
          return
        }
        accessToken = resp.access_token
        tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000
        resolve(accessToken)
      },
      error_callback: (err) => reject(new Error(err.message || 'Sign-in was cancelled.')),
    })
    client.requestAccessToken({ prompt: opts.prompt })
  })
}

/** Interactive Google authorization (account chooser). Must be called from a click. */
export function signIn(prompt: '' | 'consent' | 'select_account' = ''): Promise<string> {
  return tokenRequest({ prompt })
}

/** Authorize Drive for a specific account silently (no popup); rejects if consent is required. */
export function authorizeSilently(email: string): Promise<string> {
  return tokenRequest({ prompt: '', hint: email })
}

/** Authorize Drive for a specific account, showing consent. Must be called from a click. */
export function authorizeWithConsent(email: string): Promise<string> {
  return tokenRequest({ prompt: 'consent', hint: email })
}

export function signOut(): void {
  if (accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(accessToken)
  }
  window.google?.accounts?.id?.disableAutoSelect()
  accessToken = null
  tokenExpiry = 0
}

// ---- Google One Tap / FedCM: show the list of Google accounts automatically ----
export interface ChosenAccount {
  email: string
  name?: string
  picture?: string
}

const ACCOUNTS_KEY = 'wolit_accounts'

/** Accounts that have signed in before, remembered locally (name + photo) to offer quick re-sign-in. */
export function getRememberedAccounts(): ChosenAccount[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list.filter((a) => a && a.email) : []
  } catch {
    return []
  }
}

export function rememberAccount(a: ChosenAccount): void {
  try {
    const list = getRememberedAccounts().filter((x) => x.email !== a.email)
    list.unshift({ email: a.email, name: a.name, picture: a.picture })
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list.slice(0, 5)))
  } catch {
    /* ignore storage errors */
  }
}

export function forgetAccount(email: string): void {
  try {
    localStorage.setItem(
      ACCOUNTS_KEY,
      JSON.stringify(getRememberedAccounts().filter((x) => x.email !== email)),
    )
  } catch {
    /* ignore */
  }
}

let oneTapInited = false

function decodeJwtPayload(jwt: string): { email?: string; name?: string; picture?: string } {
  try {
    const b64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(
      atob(b64)
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    )
    return JSON.parse(json)
  } catch {
    return {}
  }
}

/** Show Google's account chooser (One Tap / FedCM) automatically. No-op if unavailable. */
export function promptAccountChooser(onAccount: (a: ChosenAccount) => void): void {
  if (!GOOGLE_CLIENT_ID || !window.google?.accounts?.id) return
  if (!oneTapInited) {
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      auto_select: false,
      cancel_on_tap_outside: false,
      use_fedcm_for_prompt: true,
      callback: (resp) => {
        const p = decodeJwtPayload(resp.credential)
        if (p.email) onAccount({ email: p.email, name: p.name, picture: p.picture })
      },
    })
    oneTapInited = true
  }
  try {
    window.google.accounts.id.prompt()
  } catch {
    /* If One Tap can't show, the fallback button remains available. */
  }
}

async function token(): Promise<string> {
  if (isSignedIn()) return accessToken!
  return signIn('')
}

async function driveFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const t = await token()
  const url = `https://www.googleapis.com/${path}`
  const headers = { ...(init.headers || {}), Authorization: `Bearer ${t}` }
  let res = await fetch(url, { ...init, headers })
  if (res.status === 401) {
    accessToken = null
    const t2 = await signIn('')
    res = await fetch(url, { ...init, headers: { ...headers, Authorization: `Bearer ${t2}` } })
  }
  return res
}

async function findWalletFileId(): Promise<string | null> {
  const q = encodeURIComponent(`name='${WALLET_FILE_NAME}'`)
  const res = await driveFetch(`drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,name)`)
  if (!res.ok) throw new Error(`Drive query failed (${res.status})`)
  const j = await res.json()
  return j.files?.[0]?.id ?? null
}

export async function loadWallet(): Promise<WalletFile | null> {
  const id = await findWalletFileId()
  if (!id) return null
  const res = await driveFetch(`drive/v3/files/${id}?alt=media`)
  if (!res.ok) throw new Error(`Drive read failed (${res.status})`)
  return res.json()
}

export async function saveWallet(data: WalletFile): Promise<void> {
  const existingId = await findWalletFileId()
  const content = JSON.stringify(data)

  if (existingId) {
    const res = await driveFetch(`upload/drive/v3/files/${existingId}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: content,
    })
    if (!res.ok) throw new Error(`Drive update failed (${res.status})`)
    return
  }

  const boundary = 'wolit' + Math.random().toString(36).slice(2)
  const metadata = { name: WALLET_FILE_NAME, parents: ['appDataFolder'] }
  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\n` +
    'Content-Type: application/json\r\n\r\n' +
    content +
    `\r\n--${boundary}--`

  const res = await driveFetch('upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  if (!res.ok) throw new Error(`Drive save failed (${res.status})`)
}

export async function deleteWallet(): Promise<void> {
  const id = await findWalletFileId()
  if (!id) return
  const res = await driveFetch(`drive/v3/files/${id}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 204) throw new Error(`Drive delete failed (${res.status})`)
}
