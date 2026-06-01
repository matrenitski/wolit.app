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

  if (w.status === 'ready' && w.account) {
    return (
      <div className="screen top">
        <WalletHome
          account={w.account}
          network={w.network}
          balance={w.balance}
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
      </div>
    )
  }

  const busy =
    w.status === 'init' ||
    w.status === 'authorizing' ||
    w.status === 'loadingWallet' ||
    w.status === 'creating'

  return (
    <div className="screen">
      <Landing
        network={w.network}
        busy={busy}
        statusLabel={STATUS_LABEL[w.status] ?? 'Working…'}
        error={w.status === 'error' ? w.error : null}
        onSignIn={w.signIn}
        onRetry={w.retry}
      />
    </div>
  )
}
