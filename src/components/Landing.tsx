import { useState } from 'react'
import { GOOGLE_CLIENT_ID, type NetworkName } from '../config'
import type { ChosenAccount } from '../lib/googleDrive'

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

function Avatar({ account }: { account: ChosenAccount }) {
  const [failed, setFailed] = useState(false)
  if (account.picture && !failed) {
    return (
      <img
        className="account-avatar"
        src={account.picture}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    )
  }
  const letter = (account.name || account.email || '?').trim().charAt(0).toUpperCase()
  return <span className="account-avatar letter">{letter}</span>
}

function AccountButton({
  account,
  disabled,
  onClick,
}: {
  account: ChosenAccount
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button className="account-btn" onClick={onClick} disabled={disabled}>
      <Avatar account={account} />
      <span className="account-info">
        <span className="account-name">{account.name || account.email}</span>
        {account.name && <span className="account-email">{account.email}</span>}
      </span>
    </button>
  )
}

export function Landing({
  network,
  busy,
  statusLabel,
  error,
  chosenAccount,
  rememberedAccounts,
  onSignIn,
  onSignInAs,
  onUseAnother,
  onContinueAs,
  onRetry,
}: {
  network: NetworkName
  busy: boolean
  statusLabel: string
  error: string | null
  chosenAccount: ChosenAccount | null
  rememberedAccounts: ChosenAccount[]
  onSignIn: () => void
  onSignInAs: (account: ChosenAccount) => void
  onUseAnother: () => void
  onContinueAs: () => void
  onRetry: () => void
}) {
  const configured = !!GOOGLE_CLIENT_ID

  return (
    <div className="card landing">
      <div className="brand">
        wolit<span>.app</span>
      </div>
      <p className="tagline">the simplest Bitcoin wallet</p>

      <div className="uvp-badges">
        <span className="uvp">No servers</span>
        <span className="uvp">Your keys, your coins</span>
        <a
          className="uvp uvp-link"
          href="https://github.com/matrenitski/wolit.app"
          target="_blank"
          rel="noreferrer"
        >
          Open source ↗
        </a>
      </div>

      <p className="value-line">
        Just your <strong>Google account</strong> — no password to lose, no seed phrase to write down.
      </p>

      {!configured ? (
        <div className="banner warn mt-16">
          <strong>Setup needed.</strong> This app has no Google Client ID yet. Add{' '}
          <code>VITE_GOOGLE_CLIENT_ID</code> to <code>.env.local</code> and reload — see the README.
        </div>
      ) : busy ? (
        <div className="signing-in mt-16">
          <span className="spinner" /> {statusLabel}
        </div>
      ) : chosenAccount ? (
        <>
          <button className="btn btn-google mt-16" onClick={onContinueAs}>
            <GoogleG /> Continue as {chosenAccount.name || chosenAccount.email}
          </button>
          <div className="center mt-8">
            <button className="muted-link" onClick={onUseAnother}>
              Use another account
            </button>
          </div>
        </>
      ) : rememberedAccounts.length > 0 ? (
        <>
          <div className="account-list mt-16">
            {rememberedAccounts.map((a) => (
              <AccountButton key={a.email} account={a} disabled={busy} onClick={() => onSignInAs(a)} />
            ))}
          </div>
          <div className="center mt-8">
            <button className="muted-link" onClick={onUseAnother}>
              Use another account
            </button>
          </div>
        </>
      ) : (
        <button className="btn btn-google mt-16" onClick={onSignIn}>
          <GoogleG /> Continue with Google
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

      <div className="how">
        <div className="how-title">How it works</div>
        <div className="how-step">
          <span className="how-num">1</span>
          <span>Sign in with Google — nothing to download, no seed phrase to manage.</span>
        </div>
        <div className="how-step">
          <span className="how-num">2</span>
          <span>
            Your key is created in your browser and saved to a private folder in your own
            Drive. <strong>We never see it.</strong>
          </span>
        </div>
        <div className="how-step">
          <span className="how-num">3</span>
          <span>Send and receive Bitcoin. Export your 12 words anytime — you’re never locked in.</span>
        </div>
      </div>

    </div>
  )
}
