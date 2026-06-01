import { useState } from 'react'
import { Modal } from './Modal'
import { encryptBackup } from '../lib/walletEncryption'

export function BackupModal({ mnemonic, onClose }: { mnemonic: string; onClose: () => void }) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const words = mnemonic.trim().split(/\s+/)

  const copy = async () => {
    await navigator.clipboard.writeText(mnemonic)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const download = async () => {
    setErr(null)
    setDone(false)
    if (pass.length < 8) {
      setErr('Use a passphrase of at least 8 characters.')
      return
    }
    if (pass !== pass2) {
      setErr('The two passphrases don’t match.')
      return
    }
    setBusy(true)
    try {
      const enc = await encryptBackup(mnemonic, pass)
      const blob = new Blob([JSON.stringify(enc, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'wolit-backup.json'
      a.click()
      URL.revokeObjectURL(url)
      setDone(true)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Back up your wallet" onClose={onClose}>
      <div className="banner warn">
        These 12 words <strong>are</strong> your wallet. Anyone who sees them can take your Bitcoin —
        and Google could delete its hidden copy, so keep your own backup somewhere safe.
      </div>

      {!revealed ? (
        <button className="btn mt-16" onClick={() => setRevealed(true)}>
          Reveal my 12 secret words
        </button>
      ) : (
        <>
          <div className="mnemonic-grid mt-16">
            {words.map((w, i) => (
              <div key={i} className="mnemonic-word">
                <span>{i + 1}</span>
                {w}
              </div>
            ))}
          </div>
          <button className="btn mt-16" onClick={copy}>
            {copied ? 'Copied ✓' : 'Copy words'}
          </button>
        </>
      )}

      <div className="divider" />

      <p className="muted fine">
        Or save an <strong>encrypted backup file</strong> you can keep anywhere (email, USB stick,
        cloud). Pick a passphrase to lock it — you’ll need it to restore:
      </p>
      <div className="field">
        <label>Backup passphrase</label>
        <input
          className="input"
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          placeholder="at least 8 characters"
        />
      </div>
      <div className="field">
        <label>Confirm passphrase</label>
        <input
          className="input"
          type="password"
          value={pass2}
          onChange={(e) => setPass2(e.target.value)}
        />
      </div>
      {err && <div className="banner error mt-8">{err}</div>}
      {done && <div className="banner success mt-8">Encrypted backup downloaded ✓</div>}
      <button className="btn btn-primary mt-16" onClick={download} disabled={busy}>
        {busy ? 'Encrypting…' : 'Download encrypted backup'}
      </button>
    </Modal>
  )
}
