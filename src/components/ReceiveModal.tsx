import { useState } from 'react'
import { Modal } from './Modal'
import { Qr } from './Qr'
import type { NetworkName } from '../config'

export function ReceiveModal({
  address,
  network,
  onClose,
}: {
  address: string
  network: NetworkName
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Modal title="Receive Bitcoin" onClose={onClose}>
      <div className="center">
        <Qr value={`bitcoin:${address}`} />
      </div>
      <p className="muted center mt-8">
        Share this address to receive {network === 'testnet' ? 'testnet ' : ''}Bitcoin.
      </p>
      <div className="address-box mt-8">{address}</div>
      <button className="btn mt-16" onClick={copy}>
        {copied ? 'Copied ✓' : 'Copy address'}
      </button>
      {network === 'testnet' && (
        <p className="muted center mt-16 fine">
          Need practice coins? Get free testnet BTC from a faucet such as{' '}
          <a className="link" href="https://coinfaucet.eu/en/btc-testnet/" target="_blank" rel="noreferrer">
            coinfaucet.eu
          </a>
          .
        </p>
      )}
    </Modal>
  )
}
