// Passphrase-based encryption for the *downloadable backup file* only.
// Day-to-day, the wallet is gated by the Google account (the user's choice).
// But an exported backup may be stored anywhere, so we encrypt it client-side
// with AES-256-GCM under a user-chosen passphrase (WebCrypto, no dependencies).

function toB64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromB64(b64: string) {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

const ITERATIONS = 250_000

async function deriveKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  usage: KeyUsage[],
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    usage,
  )
}

export interface EncryptedBackup {
  app: 'wolit.app'
  v: 1
  kdf: 'PBKDF2-SHA256'
  iterations: number
  salt: string
  iv: string
  ciphertext: string
}

export async function encryptBackup(plaintext: string, passphrase: string): Promise<EncryptedBackup> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase, salt, ['encrypt'])
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  )
  return {
    app: 'wolit.app',
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS,
    salt: toB64(salt),
    iv: toB64(iv),
    ciphertext: toB64(new Uint8Array(ct)),
  }
}

export async function decryptBackup(backup: EncryptedBackup, passphrase: string): Promise<string> {
  const salt = fromB64(backup.salt)
  const iv = fromB64(backup.iv)
  const key = await deriveKey(passphrase, salt, ['decrypt'])
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    fromB64(backup.ciphertext),
  )
  return new TextDecoder().decode(pt)
}
