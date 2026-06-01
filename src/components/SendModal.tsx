import { useState } from 'react'
import { Modal } from './Modal'
import { EXPLORER_BASE, type NetworkName } from '../config'
import { btcToSats, formatBtc } from '../lib/format'
import type { BuiltTx } from '../lib/bitcoin'

type Phase = 'form' | 'review' | 'done'

export function SendModal({
  network,
  availableSats,
  buildTransaction,
  broadcast,
  onClose,
}: {
  network: NetworkName
  availableSats: number
  buildTransaction: (to: string, amountSats: number, sendMax: boolean) => Promise<BuiltTx>
  broadcast: (hex: string) => Promise<string>
  onClose: () => void
}) {
  const [phase, setPhase] = useState<Phase>('form')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [sendMax, setSendMax] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [tx, setTx] = useState<BuiltTx | null>(null)
  const [txid, setTxid] = useState<string | null>(null)

  const review = async () => {
    setErr(null)
    const addr = to.trim()
    if (!addr) {
      setErr('Enter a recipient address.')
      return
    }
    const amountSats = sendMax ? 0 : btcToSats(amount)
    if (!sendMax && (!isFinite(amountSats) || amountSats <= 0)) {
      setErr('Enter a valid amount.')
      return
    }
    setBusy(true)
    try {
      const built = await buildTransaction(addr, amountSats, sendMax)
      setTx(built)
      setPhase('review')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (!tx) return
    setErr(null)
    setBusy(true)
    try {
      const id = await broadcast(tx.hex)
      setTxid(id)
      setPhase('done')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Send Bitcoin" onClose={onClose}>
      {phase === 'form' && (
        <>
          <div className="field">
            <label>Recipient address</label>
            <input
              className="input mono"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder={network === 'testnet' ? 'tb1…' : 'bc1…'}
              spellCheck={false}
            />
          </div>
          <div className="field">
            <label>
              Amount (BTC)
              <span className="avail">available {formatBtc(availableSats)}</span>
            </label>
            <input
              className="input"
              value={sendMax ? formatBtc(availableSats) : amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0001"
              inputMode="decimal"
              disabled={sendMax}
            />
            <label className="checkbox mt-8">
              <input
                type="checkbox"
                checked={sendMax}
                onChange={(e) => setSendMax(e.target.checked)}
              />
              Send entire balance
            </label>
          </div>
          {err && <div className="banner error mt-8">{err}</div>}
          <button className="btn btn-primary mt-16" onClick={review} disabled={busy}>
            {busy ? 'Preparing…' : 'Review'}
          </button>
        </>
      )}

      {phase === 'review' && tx && (
        <>
          <div className="review">
            <div className="review-row">
              <span>Sending</span>
              <strong>{formatBtc(tx.amount)} BTC</strong>
            </div>
            <div className="review-row">
              <span>To</span>
              <span className="mono small">{to.trim()}</span>
            </div>
            <div className="review-row">
              <span>Network fee</span>
              <span>{formatBtc(tx.fee)} BTC</span>
            </div>
            <div className="review-row total">
              <span>Total</span>
              <strong>{formatBtc(tx.amount + tx.fee)} BTC</strong>
            </div>
          </div>
          {err && <div className="banner error mt-8">{err}</div>}
          <div className="btn-row">
            <button className="btn" onClick={() => setPhase('form')} disabled={busy}>
              Back
            </button>
            <button className="btn btn-primary" onClick={confirm} disabled={busy}>
              {busy ? (
                <>
                  <span className="spinner" /> Sending…
                </>
              ) : (
                'Confirm & Send'
              )}
            </button>
          </div>
        </>
      )}

      {phase === 'done' && txid && (
        <div className="center">
          <div className="success-check">✓</div>
          <h3 className="mt-8">Sent!</h3>
          <p className="muted">Your transaction is on its way. It’ll confirm in a few minutes.</p>
          <a
            className="link"
            href={`${EXPLORER_BASE[network]}/tx/${txid}`}
            target="_blank"
            rel="noreferrer"
          >
            View on the block explorer ↗
          </a>
          <button className="btn mt-16" onClick={onClose}>
            Done
          </button>
        </div>
      )}
    </Modal>
  )
}
