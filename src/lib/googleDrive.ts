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

/** Interactive Google authorization for the drive.appdata scope. Must be called from a click. */
export function signIn(prompt: '' | 'consent' | 'select_account' = ''): Promise<string> {
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
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error_description || resp.error || 'Authorization failed.'))
          return
        }
        accessToken = resp.access_token
        tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000
        resolve(accessToken)
      },
      error_callback: (err) =>
        reject(new Error(err.message || 'Sign-in was cancelled.')),
    })
    client.requestAccessToken({ prompt })
  })
}

export function signOut(): void {
  if (accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(accessToken)
  }
  accessToken = null
  tokenExpiry = 0
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
