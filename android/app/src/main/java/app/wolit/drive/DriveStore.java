package app.wolit.drive;

import app.wolit.Config;
import app.wolit.net.Http;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * Reads and writes the wallet file in the Google Drive appDataFolder (a hidden,
 * per-app folder only this app can see) via the Drive REST API. Mirrors
 * src/lib/googleDrive.ts, including the exact JSON shape so the file is interchangeable
 * with the web app.
 */
public final class DriveStore {
    private DriveStore() {}

    private static final String API = "https://www.googleapis.com/";

    /** Thrown when the access token is missing or rejected (HTTP 401). */
    public static final class NeedsAuthException extends IOException {
        public NeedsAuthException(String m) { super(m); }
    }

    /** The wallet record stored in Drive: { version, network, mnemonic, createdAt }. */
    public static final class WalletFile {
        public final int version;
        public final String network;
        public final String mnemonic;
        public final String createdAt;
        public WalletFile(int version, String network, String mnemonic, String createdAt) {
            this.version = version;
            this.network = network;
            this.mnemonic = mnemonic;
            this.createdAt = createdAt;
        }
        public String toJson() {
            JSONObject o = new JSONObject();
            try {
                o.put("version", version);
                o.put("network", network);
                o.put("mnemonic", mnemonic);
                o.put("createdAt", createdAt);
            } catch (Exception ignored) {}
            return o.toString();
        }
    }

    private static Map<String, String> authHeader() throws NeedsAuthException {
        String token = GoogleAuth.token();
        if (token == null) throw new NeedsAuthException("Not signed in.");
        Map<String, String> h = new HashMap<>();
        h.put("Authorization", "Bearer " + token);
        return h;
    }

    private static Http.Response driveFetch(String method, String path,
                                            String contentType, byte[] body) throws IOException {
        Map<String, String> headers = authHeader();
        if (contentType != null) headers.put("Content-Type", contentType);
        Http.Response res = Http.request(method, API + path, headers, contentType, body);
        if (res.code == 401) {
            // Token expired or revoked — clear it so the caller can re-authorize.
            GoogleAuth.invalidate();
            throw new NeedsAuthException("Your Google session expired. Please sign in again.");
        }
        return res;
    }

    private static String findWalletFileId() throws IOException {
        // The (String, String) overload is available on all API levels; the Charset
        // overload is API 33+.
        String q = URLEncoder.encode("name='" + Config.WALLET_FILE_NAME + "'", "UTF-8");
        Http.Response res = driveFetch("GET",
                "drive/v3/files?spaces=appDataFolder&q=" + q + "&fields=files(id,name)",
                null, null);
        if (!res.ok()) throw new IOException("Drive query failed (" + res.code + ")");
        try {
            JSONObject j = new JSONObject(res.body);
            JSONArray files = j.optJSONArray("files");
            if (files == null || files.length() == 0) return null;
            return files.getJSONObject(0).getString("id");
        } catch (Exception e) {
            throw new IOException("Unexpected Drive response", e);
        }
    }

    public static WalletFile loadWallet() throws IOException {
        String id = findWalletFileId();
        if (id == null) return null;
        Http.Response res = driveFetch("GET", "drive/v3/files/" + id + "?alt=media", null, null);
        if (!res.ok()) throw new IOException("Drive read failed (" + res.code + ")");
        try {
            JSONObject j = new JSONObject(res.body);
            return new WalletFile(
                    j.optInt("version", 1),
                    j.optString("network", Config.NETWORK),
                    j.getString("mnemonic"),
                    j.optString("createdAt", ""));
        } catch (Exception e) {
            throw new IOException("Wallet file is unreadable", e);
        }
    }

    public static void saveWallet(WalletFile data) throws IOException {
        String existingId = findWalletFileId();
        byte[] content = data.toJson().getBytes(StandardCharsets.UTF_8);

        if (existingId != null) {
            Http.Response res = driveFetch("PATCH",
                    "upload/drive/v3/files/" + existingId + "?uploadType=media",
                    "application/json", content);
            if (!res.ok()) throw new IOException("Drive update failed (" + res.code + ")");
            return;
        }

        String boundary = "wolit" + Long.toHexString(System.nanoTime());
        JSONObject metadata = new JSONObject();
        try {
            metadata.put("name", Config.WALLET_FILE_NAME);
            metadata.put("parents", new JSONArray().put("appDataFolder"));
        } catch (Exception ignored) {}

        String body = "--" + boundary + "\r\n"
                + "Content-Type: application/json; charset=UTF-8\r\n\r\n"
                + metadata + "\r\n"
                + "--" + boundary + "\r\n"
                + "Content-Type: application/json\r\n\r\n"
                + data.toJson() + "\r\n"
                + "--" + boundary + "--";

        Http.Response res = driveFetch("POST",
                "upload/drive/v3/files?uploadType=multipart",
                "multipart/related; boundary=" + boundary,
                body.getBytes(StandardCharsets.UTF_8));
        if (!res.ok()) throw new IOException("Drive save failed (" + res.code + ")");
    }

    public static void deleteWallet() throws IOException {
        String id = findWalletFileId();
        if (id == null) return;
        Http.Response res = driveFetch("DELETE", "drive/v3/files/" + id, null, null);
        if (!res.ok() && res.code != 204) throw new IOException("Drive delete failed (" + res.code + ")");
    }
}
