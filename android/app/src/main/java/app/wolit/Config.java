package app.wolit;

/**
 * App-wide constants, mirroring the web app's src/config.ts so a wallet created in
 * one client opens identically in the other.
 */
public final class Config {
    private Config() {}

    /**
     * Public Google OAuth (Web) client ID, set via Gradle. NOTE: this is NOT what
     * authorizes the Drive grant — Play Services matches the grant by the app's package
     * name + signing SHA-1 against an *Android-type* OAuth client, and GoogleAuth only
     * requests scopes. This value is used purely as the "is the app configured?" UI gate.
     * The functional requirement is an Android OAuth client registered for this package +
     * SHA-1 in the same Cloud project as the web app (see android/README.md).
     */
    public static final String GOOGLE_CLIENT_ID = BuildConfig.GOOGLE_CLIENT_ID;

    /** "testnet" (default) or "mainnet". */
    public static final String NETWORK = BuildConfig.BITCOIN_NETWORK;

    public static boolean isMainnet() {
        return "mainnet".equals(NETWORK);
    }

    /** Non-sensitive Drive scope: a hidden, per-app folder only this app can read. */
    public static final String DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";

    /** Name of the wallet file stored in the Drive appDataFolder. */
    public static final String WALLET_FILE_NAME = "wolit-wallet.json";

    /** Esplora-compatible block-explorer API base (via mempool.space). */
    public static String esploraBase() {
        return isMainnet()
                ? "https://mempool.space/api"
                : "https://mempool.space/testnet/api";
    }

    /** Human-facing explorer base for linking out to txids/addresses. */
    public static String explorerBase() {
        return isMainnet()
                ? "https://mempool.space"
                : "https://mempool.space/testnet";
    }
}
