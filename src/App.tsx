import { useWallet, type Status } from './hooks/useWallet'
import { Landing } from './components/Landing'
import { WalletHome } from './components/WalletHome'

const STATUS_LABEL: Partial<Record<Status, string>> = {
  init: 'Loading…',
  authorizing: 'Signing in…',
  loadingWallet: 'Opening your wallet…',
  creating: 'Creating your wallet…',
}

export default function App() {
  const w = useWallet()
  const ready = w.status === 'ready' && !!w.account

  const busy =
    w.status === 'init' ||
    w.status === 'authorizing' ||
    w.status === 'loadingWallet' ||
    w.status === 'creating'

  return (
    <div className={`screen${ready ? ' top' : ''}`}>
      <main className="screen-main">
        {w.status === 'ready' && w.account ? (
          <WalletHome
            account={w.account}
            receiveAddress={w.receiveAddress}
            network={w.network}
            balance={w.balance}
            priceUsd={w.priceUsd}
            history={w.history}
            refreshing={w.refreshing}
            justCreated={w.justCreated}
            buildTransaction={w.buildTransaction}
            broadcast={w.broadcast}
            onRefresh={w.refresh}
            onSignOut={w.signOut}
            onDelete={w.deleteWallet}
            dismissJustCreated={w.dismissJustCreated}
          />
        ) : (
          <Landing
            network={w.network}
            busy={busy}
            statusLabel={STATUS_LABEL[w.status] ?? 'Working…'}
            error={w.status === 'error' ? w.error : null}
            chosenAccount={w.chosenAccount}
            rememberedAccounts={w.rememberedAccounts}
            onSignIn={w.signIn}
            onSignInAs={w.signInAs}
            onUseAnother={w.useAnotherAccount}
            onContinueAs={w.continueWithChosen}
            onRetry={w.retry}
          />
        )}
      </main>
      <footer className="copyright">
        <a className="foot-link" href="/privacy">Privacy</a>
        <span className="foot-sep">·</span>
        <a className="foot-link" href="/terms">Terms</a>
        <span className="foot-sep">·</span>
        <span>© Max Matrenitski 2025–2026</span>
      </footer>
    </div>
  )
}
