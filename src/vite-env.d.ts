/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string
  readonly VITE_BITCOIN_NETWORK?: 'testnet' | 'mainnet'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Minimal typings for the Google Identity Services token client.
interface GoogleTokenResponse {
  access_token: string
  expires_in: number
  scope: string
  token_type: string
  error?: string
  error_description?: string
}

interface GoogleTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void
}

interface Window {
  google?: {
    accounts: {
      oauth2: {
        initTokenClient: (config: {
          client_id: string
          scope: string
          prompt?: string
          callback: (response: GoogleTokenResponse) => void
          error_callback?: (error: { type: string; message?: string }) => void
        }) => GoogleTokenClient
        revoke: (accessToken: string, done?: () => void) => void
      }
    }
  }
}
