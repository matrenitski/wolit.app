import { useState } from 'react'
import { EXPLORER_BASE, type NetworkName } from '../config'
import { formatBtc, formatUsd, relativeTime } from '../lib/format'
import type { BuiltTx, DerivedAccount } from '../lib/bitcoin'
import type { AddressStats, TxSummary } from '../lib/esplora'
import { ReceiveModal } from './ReceiveModal'
import { SendModal } from './SendModal'
import { BackupModal } from './BackupModal'

type ModalName = 'send' | 'receive' | 'backup' | null

const ArrowUp = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
)
const ArrowDown = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 5v14M19 12l-7 7-7-7" />
  </svg>
)
const CopyIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
)

export function WalletHome({
  account,
  network,
  balance,
  priceUsd,
  history,
  refreshing,
  justCreated,
  buildTransaction,
  broadcast,
  onRefresh,
  onSignOut,
  onDelete,
  dismissJustCreated,
}: {
  account: DerivedAccount
  network: NetworkName
  balance: AddressStats | null
  priceUsd: number | null
  history: TxSummary[]
  refreshing: boolean
  justCreated: boolean
  buildTransaction: (to: string, amountSats: number, sendMax: boolean) => Promise<BuiltTx>
  broadcast: (hex: string) => Promise<string>
  onRefresh: () => void
  onSignOut: () => void
  onDelete: () => void
  dismissJustCreated: () => void
}) {
  const [modal, setModal] = useState<ModalName>(null)
  const [copied, setCopied] = useState(false)

  const confirmed = balance?.confirmed ?? 0
  const pending = balance?.pending ?? 0
  const availableSats = confirmed + pending
  const fiat = formatUsd(confirmed, priceUsd)

  const copyAddress = async () => {
    await navigator.clipboard.writeText(account.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const confirmDelete = () => {
    if (
      window.confirm(
        'Delete this wallet from your Google Drive?\n\nIf you have not backed up your 12 words, any Bitcoin in it will be lost forever. This cannot be undone.',
      )
    ) {
      onDelete()
    }
  }

  return (
    <div className="wallet fade-in">
      <header className="topbar">
        <div className="brand small">
          wolit<span>.app</span>
        </div>
        <span className={`net-badge ${network}`}>
          <span className="dot" />
          {network === 'mainnet' ? 'Bitcoin' : 'Testnet'}
        </span>
      </header>

      {justCreated && (
        <div className="banner success">
          Your wallet is ready —{' '}
          <button className="inline-link" onClick={() => setModal('backup')}>
            back it up now
          </button>{' '}
          so you never lose it.{' '}
          <button className="muted-link" onClick={dismissJustCreated}>
            dismiss
          </button>
        </div>
      )}

      <section className="card balance-card">
        <div className="balance-label">Total balance</div>
        <div className="balance-amount">
          {balance ? formatBtc(confirmed) : '—'} <span className="balance-unit">BTC</span>
        </div>
        {fiat && <div className="balance-fiat">≈ {fiat}</div>}
        {pending !== 0 && (
          <div className="balance-pending">
            {pending > 0 ? '+' : ''}
            {formatBtc(pending)} BTC pending
          </div>
        )}
      </section>

      {priceUsd && (
        <div className="price-ticker">1 BTC ≈ {formatUsd(100_000_000, priceUsd)}</div>
      )}

      <div className="btn-row">
        <button className="btn btn-primary" onClick={() => setModal('send')}>
          <ArrowUp /> Send
        </button>
        <button className="btn" onClick={() => setModal('receive')}>
          <ArrowDown /> Receive
        </button>
      </div>

      <section className="card address-card">
        <div className="address-card-head">
          <span className="muted fine">Your address</span>
          <button className="muted-link" onClick={() => setModal('receive')}>
            show QR
          </button>
        </div>
        <div className="address-row">
          <span className="mono small break">{account.address}</span>
          <button className="copy-btn" onClick={copyAddress} aria-label="Copy address">
            {copied ? <span className="copied-check">✓</span> : <CopyIcon />}
          </button>
        </div>
      </section>

      <section className="activity">
        <div className="activity-head">
          <span className="muted fine">Activity</span>
          <button className="muted-link" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? 'refreshing…' : 'refresh'}
          </button>
        </div>
        {history.length === 0 ? (
          <p className="muted fine center empty-activity">No transactions yet.</p>
        ) : (
          <ul className="tx-list">
            {history.slice(0, 8).map((tx) => (
              <li key={tx.txid} className="tx-item">
                <a
                  className="tx-link"
                  href={`${EXPLORER_BASE[network]}/tx/${tx.txid}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className={`tx-icon ${tx.delta >= 0 ? 'in' : 'out'}`}>
                    {tx.delta >= 0 ? <ArrowDown /> : <ArrowUp />}
                  </span>
                  <span className="tx-info">
                    <span className="tx-dir">{tx.delta >= 0 ? 'Received' : 'Sent'}</span>
                    <span className="muted fine">
                      {tx.confirmed ? relativeTime(tx.blockTime) : 'pending'}
                    </span>
                  </span>
                  <span className="tx-amounts">
                    <span className={`tx-amt mono ${tx.delta >= 0 ? 'in' : 'out'}`}>
                      {tx.delta >= 0 ? '+' : ''}
                      {formatBtc(tx.delta)}
                    </span>
                    {formatUsd(Math.abs(tx.delta), priceUsd) && (
                      <span className="muted fine">{formatUsd(Math.abs(tx.delta), priceUsd)}</span>
                    )}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="footer-actions">
        <button className="muted-link" onClick={() => setModal('backup')}>
          Back up
        </button>
        <button className="muted-link" onClick={onSignOut}>
          Sign out
        </button>
        <button className="muted-link danger" onClick={confirmDelete}>
          Delete wallet
        </button>
      </div>

      {modal === 'send' && (
        <SendModal
          network={network}
          availableSats={availableSats}
          priceUsd={priceUsd}
          buildTransaction={buildTransaction}
          broadcast={broadcast}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'receive' && (
        <ReceiveModal address={account.address} network={network} onClose={() => setModal(null)} />
      )}
      {modal === 'backup' && (
        <BackupModal mnemonic={account.mnemonic} onClose={() => setModal(null)} />
      )}
    </div>
  )
}
