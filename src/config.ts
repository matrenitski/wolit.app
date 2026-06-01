export type NetworkName = 'testnet' | 'mainnet'

/** Public Google OAuth client ID (safe to ship in a static site). */
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''

/** Default Bitcoin network. Testnet unless explicitly set to mainnet. */
export const DEFAULT_NETWORK: NetworkName =
  import.meta.env.VITE_BITCOIN_NETWORK === 'mainnet' ? 'mainnet' : 'testnet'

/** Non-sensitive Drive scope: a hidden, per-app folder only this app can read. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata'

/** Name of the wallet file stored in the Drive appDataFolder. */
export const WALLET_FILE_NAME = 'wolit-wallet.json'

/** Esplora-compatible block-explorer API base URLs (via mempool.space). */
export const ESPLORA_BASE: Record<NetworkName, string> = {
  mainnet: 'https://mempool.space/api',
  testnet: 'https://mempool.space/testnet/api',
}

/** Human-facing explorer URLs for linking out to transactions/addresses. */
export const EXPLORER_BASE: Record<NetworkName, string> = {
  mainnet: 'https://mempool.space',
  testnet: 'https://mempool.space/testnet',
}
