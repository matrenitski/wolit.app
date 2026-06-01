import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// bitcoinjs-lib (and its create-hash/readable-stream dependencies) assume Node
// globals: Buffer, process, and the stream/events/util builtins. This plugin
// provides browser polyfills for all of them so the crypto code runs unchanged.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    nodePolyfills({
      globals: { Buffer: true, global: true, process: true },
    }),
  ],
})
