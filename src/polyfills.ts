// Must be imported before any bitcoinjs-lib code runs.
// bitcoinjs-lib and its dependencies expect a Node-style Buffer global.
import { Buffer } from 'buffer'

if (typeof (globalThis as any).Buffer === 'undefined') {
  ;(globalThis as any).Buffer = Buffer
}
if (typeof (globalThis as any).global === 'undefined') {
  ;(globalThis as any).global = globalThis
}
