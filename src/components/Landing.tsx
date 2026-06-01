import { GOOGLE_CLIENT_ID, type NetworkName } from '../config'

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5h-1.9V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8a12 12 0 1 1 0-24c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 1 0 24 44a20 20 0 0 0 19.6-23.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8A12 12 0 0 1 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 0 0 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A12 12 0 0 1 12.7 28l-6.5 5A20 20 0 0 0 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C41 35.7 44 30.4 44 24c0-1.2-.1-2.4-.4-3.5z" />
    </svg>
  )
}

export function Landing({
  network,
  busy,
  statusLabel,
  error,
  onSignIn,
  onRetry,
}: {
  network: NetworkName
  busy: boolean
  statusLabel: string
  error: string | null
  onSignIn: () => void
  onRetry: () => void
}) {
  const configured = !!GOOGLE_CLIENT_ID

  return (
    <div className="card landing">
      <div className="brand">
        wolit<span>.app</span>
      </div>
      <p className="tagline">the simplest Bitcoin wallet</p>

      <p className="muted mt-16">
        Sign in with Google and your wallet is ready. Your private key is created in your browser
        and saved to your own Google&nbsp;Drive — nothing to write down, no password to forget.
      </p>

      {!configured ? (
        <div className="banner warn mt-16">
          <strong>Setup needed.</strong> This app has no Google Client ID yet. Add{' '}
          <code>VITE_GOOGLE_CLIENT_ID</code> to <code>.env.local</code> and reload — see the README.
        </div>
      ) : (
        <button className="btn btn-google mt-16" onClick={onSignIn} disabled={busy}>
          {busy ? (
            <>
              <span className="spinner" /> {statusLabel}
            </>
          ) : (
            <>
              <GoogleG /> Continue with Google
            </>
          )}
        </button>
      )}

      {error && (
        <div className="banner error mt-8">
          {error}{' '}
          <button className="muted-link" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}

      <div className={`net-note mt-16 ${network}`}>
        {network === 'testnet'
          ? 'Testnet mode — these are practice coins, not real money.'
          : 'Mainnet — this wallet holds real Bitcoin.'}
      </div>
    </div>
  )
}
