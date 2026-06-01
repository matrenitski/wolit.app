import { useState } from 'react'
import { EXPLORER_BASE, type NetworkName } from '../config'
import { formatBtc } from '../lib/format'
import type { DerivedAccount } from '../lib/bitcoin'
import type { AddressStats, TxSummary } from '../lib/esplora'
import { ReceiveModal } from './ReceiveModal'
import { SendModal } from './SendModal'
import { BackupModal } from './BackupModal'

type ModalName = 'send' | 'receive' | 'backup' | null

export function WalletHome({
  account,
  network,
  balance,
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
  history: TxSummary[]
  refreshing: boolean
  justCreated: boolean
  buildTransaction: (to: string, amountSats: number, sendMax: boolean) => Promise<import('../lib/bitcoin').BuiltTx>
  broadcast: (hex: string) => Promise<string>
  onRefresh: () => void
  onSignOut: () => void
  onDelete: () => void
  dismissJustCreated: () => void
}) {
  const [modal, setModal] = useState<ModalName>(null)

  const confirmed = balance?.confirmed ?? 0
  const pending = balance?.pending ?? 0
  const availableSats = confirmed + pending

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
    <div className="wallet">
      <div className="topbar">
        <div className="brand small">
          wolit<span>.app</span>
        </div>
        <span className={`net-badge ${network}`}>{network}</span>
      </div>

      {justCreated && (
        <div className="banner success">
          Your wallet is ready! Take a moment to{' '}
          <button className="inline-link" onClick={() => setModal('backup')}>
            back it up
          </button>
          .{' '}
          <button className="muted-link" onClick={dismissJustCreated}>
            dismiss
          </button>
        </div>
      )}

      <div className="card balance-card">
        <div className="balance-amount">
          {balance ? formatBtc(confirmed) : '—'} <span className="balance-unit">BTC</span>
        </div>
        {pending !== 0 && (
          <div className="balance-pending">
            {pending > 0 ? '+' : ''}
            {formatBtc(pending)} BTC pending
          </div>
        )}
      </div>

      <div className="btn-row">
        <button className="btn btn-primary" onClick={() => setModal('send')}>
          Send
        </button>
        <button className="btn" onClick={() => setModal('receive')}>
          Receive
        </button>
      </div>

      <div className="card mt-16 address-card">
        <div className="address-card-head">
          <span className="muted fine">Your address</span>
          <button className="muted-link" onClick={() => setModal('receive')}>
            show QR
          </button>
        </div>
        <div className="mono small break">{account.address}</div>
      </div>

      <div className="activity mt-16">
        <div className="activity-head">
          <span className="muted fine">Recent activity</span>
          <button className="muted-link" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? 'refreshing…' : 'refresh'}
          </button>
        </div>
        {history.length === 0 ? (
          <p className="muted fine center mt-8">No transactions yet.</p>
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
                  <span className={`tx-dir ${tx.delta >= 0 ? 'in' : 'out'}`}>
                    {tx.delta >= 0 ? '↓ Received' : '↑ Sent'}
                  </span>
                  <span className="tx-meta">
                    <span className={`tx-amt ${tx.delta >= 0 ? 'in' : 'out'}`}>
                      {tx.delta >= 0 ? '+' : ''}
                      {formatBtc(tx.delta)}
                    </span>
                    <span className="muted fine">{tx.confirmed ? '' : 'pending'}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="footer-actions mt-16">
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
