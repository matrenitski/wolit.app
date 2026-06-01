# wolit.app — the simplest Bitcoin wallet

Sign in with Google, and your Bitcoin wallet is ready. The private key is generated
**in your browser** and stored in **your own Google Drive** (a hidden, app-only folder).
There is no seed phrase to write down and no server in the middle — this site has **no
backend**, so no one but you (via your Google account) can ever reach your key.

> **Security model, in plain terms.** Your money is protected by your Google account.
> That's deliberately simple — but it also means that whoever controls your Google account
> controls your coins. Use a strong Google password and 2-factor authentication, and keep
> a backup of your 12 words (the app lets you export an encrypted backup). This is the
> "Google account only" model; it is *not* the same as a hardware wallet.

## How it works

- **Frontend-only** React + Vite single-page app. No server, no database.
- **Bitcoin:** `bitcoinjs-lib` + `bip32`/`bip39`, BIP84 native SegWit (`bc1…`/`tb1…`).
- **Key storage:** Google Drive `appDataFolder` (hidden per-app folder) via the
  **non-sensitive** `drive.appdata` OAuth scope — no Google security review required.
- **Auth:** Google Identity Services token client (PKCE-style public client, **no client secret**).
  The access token lives only in memory and is never persisted.
- **Chain data:** balances, fees, and broadcasting via the public
  [mempool.space](https://mempool.space) / Esplora API.
- **Testnet-first:** runs on Bitcoin testnet by default (free practice coins).

## One-time setup: create a Google OAuth Client ID

The app needs a Google **Client ID** to sign users in. This is free and the Client ID
is *public* (safe to ship in a static site — it is not a secret).

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create a
   project (e.g. `wolit`).
2. **APIs & Services → Library →** enable the **Google Drive API**.
3. **APIs & Services → OAuth consent screen:**
   - User type: **External**.
   - App name: `wolit.app`; add your support + developer email.
   - **Scopes →** add `.../auth/drive.appdata` (it's listed as *non-sensitive*).
   - Publishing status: **Publish to production** (non-sensitive scopes need **no**
     verification review, so any Google user can sign in). While in "Testing" you'd have
     to add each user manually and tokens expire weekly.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID:**
   - Application type: **Web application**.
   - **Authorized JavaScript origins:** add
     - `http://localhost:5173` (local development)
     - `https://wolit.app` (production)
   - (No redirect URI is needed — the token client uses a popup.)
   - Create, then copy the **Client ID** (`…apps.googleusercontent.com`).
5. Copy `.env.example` to `.env.local` and paste it in:

   ```
   VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   VITE_BITCOIN_NETWORK=testnet
   ```

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
```

Then sign in with Google. On first sign-in the app generates a wallet and saves it to
your Drive. Get free testnet coins from a faucet (e.g.
[coinfaucet.eu](https://coinfaucet.eu/en/btc-testnet/)), send them to your receive
address, and try sending them back out.

## Build for production

```bash
npm run build      # outputs static files to dist/
npm run preview    # preview the production build locally
```

`dist/` is a plain static bundle — host it on any static host (Cloudflare Pages, GitHub
Pages, Netlify, …). Set `VITE_BITCOIN_NETWORK=mainnet` to use real Bitcoin.

## Going to mainnet

Testnet and mainnet wallets derive *different* addresses from the same seed, so a wallet
created on testnet won't show a balance after switching to mainnet — create a fresh wallet
on mainnet. Only switch to mainnet once you've tested thoroughly on testnet.
