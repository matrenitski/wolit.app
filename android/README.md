# wolit for Android

A **native** Android port of [wolit.app](https://wolit.app) — written in Java, no WebView,
no JavaScript bundle. It is fully interoperable with the web wallet: a wallet created on
the website opens on Android (and vice-versa) because both derive the **same** address from
the **same** key stored in the **same** hidden Google Drive folder.

## Why native instead of wrapping the website?

The web app signs in with Google Identity Services in the browser. Google **blocks that
OAuth flow inside embedded WebViews**, so a Capacitor/WebView wrapper can't reuse it. This
port instead uses Android's first-class **Authorization API** (`play-services-auth`) to get
an OAuth access token for the non-sensitive `drive.appdata` scope, then talks to the Drive
REST API directly — exactly the same storage the website uses.

## What's inside

| Concern | Web (`src/…`) | Android (`app/src/main/java/app/wolit/…`) |
|---|---|---|
| Key derivation | `bitcoinjs-lib` + `bip32/39` | `bitcoin/WolitWallet.java` (bitcoinj) |
| Transactions | `bitcoin.ts` (PSBT) | `bitcoin/TxBuilder.java` (P2WPKH witness signing) |
| Chain data | `esplora.ts` (mempool.space) | `net/Esplora.java` |
| Key storage | `googleDrive.ts` | `drive/DriveStore.java` + `drive/GoogleAuth.java` |
| Backup crypto | `walletEncryption.ts` (AES-GCM) | `crypto/BackupCrypto.java` |
| UI | React | `MainActivity.java` + `res/layout/*` (Material 3) |

**Guaranteed compatible:** BIP84 path `m/84'/{0 main | 1 test}'/0'/0/0`, native SegWit
(`bc1…`/`tb1…`), Drive file `wolit-wallet.json` = `{version, network, mnemonic, createdAt}`,
and the encrypted-backup format (PBKDF2-SHA256 ×250 000 → AES-256-GCM) all match the web app
byte-for-byte.

The app is kept lean: pure `HttpURLConnection` + `org.json` (no OkHttp/Kotlin runtime), R8
full minification, and resource shrinking on release builds.

## One-time setup: an Android OAuth client

The Authorization API matches your app by **package name + signing certificate**, so you
need an *Android-type* OAuth client (separate from the website's *Web* client) in the same
Google Cloud project.

> ⚠️ **Interoperability requires the SAME Cloud project.** The Drive `appDataFolder` is
> scoped *per Google Cloud project* (shared across that project's OAuth clients), not per
> client. The web↔Android wallet sharing this app promises **only holds if the Android
> OAuth client lives in the same project as the web client**. In a different project the
> app gets a *separate* `appDataFolder` and will not see the wallet file created on the web
> (a fresh wallet is created instead).
>
> Also note: the `wolitGoogleClientId` value is **not** what authorizes the Drive grant —
> Play Services authorizes by package + SHA-1 against the Android client. That Gradle value
> only drives the "is this build configured?" UI gate. The functional requirement is the
> Android OAuth client below.

1. In the [Google Cloud Console](https://console.cloud.google.com/) open the wolit project
   (the one with the Drive API enabled and the `drive.appdata` scope on the consent screen).
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Android**
   - Package name: `app.wolit`
   - SHA-1 certificate fingerprint: the fingerprint of the keystore you sign with.
     - Debug builds: `cd android && ./gradlew signingReport` (use the `debug` variant's SHA-1),
       or `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android`.
     - Release builds: the SHA-1 of your upload/release keystore.
3. Make sure the OAuth consent screen is **published** (the `drive.appdata` scope is
   non-sensitive and needs no verification review).

> The public **Web** client ID can be passed via `-PwolitGoogleClientId=…` and is baked into
> `BuildConfig` for reference, but the token grant itself is authorized by the Android client
> above.

## Build & run

```bash
cd android
./gradlew assembleDebug                 # -> app/build/outputs/apk/debug/app-debug.apk
./gradlew installDebug                   # build + install on a connected device/emulator
```

Choose the network at build time (defaults to testnet, like the web app):

```bash
./gradlew assembleRelease -PwolitNetwork=mainnet -PwolitGoogleClientId=YOUR_WEB_CLIENT_ID
```

Or just open the `android/` folder in **Android Studio** and press Run.

Get free testnet coins from a faucet (e.g. coinfaucet.eu), send them to your receive
address, and try sending them back out.

## CI

`.github/workflows/android.yml` builds the debug APK on GitHub's runners (which ship the
Android SDK) and uploads it as an artifact on every push/PR that touches `android/`. Set repo
**Variables** `ANDROID_GOOGLE_CLIENT_ID` and `ANDROID_BITCOIN_NETWORK` to bake them into CI
builds (optional — it compiles without them).

## Security model

Same as the web app: your coins are protected by your Google account. Whoever controls the
Google account controls the coins. Use a strong password + 2FA, and export the encrypted
backup once so a deleted Drive file can't strand your funds. This is the "Google account
only" model — not a hardware wallet. Testnet is the default; only switch to mainnet after
testing thoroughly.
