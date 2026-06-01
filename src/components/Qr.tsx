import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

export function Qr({ value, size = 200 }: { value: string; size?: number }) {
  const [url, setUrl] = useState('')

  useEffect(() => {
    let active = true
    QRCode.toDataURL(value, {
      width: size * 2,
      margin: 1,
      color: { dark: '#0b0d12', light: '#ffffff' },
    })
      .then((u) => active && setUrl(u))
      .catch(() => active && setUrl(''))
    return () => {
      active = false
    }
  }, [value, size])

  return (
    <img
      className="qr"
      src={url || undefined}
      alt="Address QR code"
      width={size}
      height={size}
    />
  )
}
