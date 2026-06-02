package app.wolit.net;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * A minimal HTTP helper over HttpURLConnection. No third-party HTTP dependency keeps
 * the APK small and free of a Kotlin runtime.
 */
public final class Http {
    private Http() {}

    public static final class Response {
        public final int code;
        public final String body;
        public Response(int code, String body) {
            this.code = code;
            this.body = body;
        }
        public boolean ok() {
            return code >= 200 && code < 300;
        }
    }

    public static Response get(String url, Map<String, String> headers) throws IOException {
        return request("GET", url, headers, null, null);
    }

    public static Response request(String method, String url, Map<String, String> headers,
                                   String contentType, byte[] body) throws IOException {
        // Defense-in-depth: refuse anything but HTTPS. All callers already use HTTPS and
        // cleartext is blocked on targetSdk 34, but this guards a future caller too.
        if (!url.regionMatches(true, 0, "https://", 0, 8)) {
            throw new IOException("Refusing non-HTTPS request");
        }
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        try {
            conn.setRequestMethod(method);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(20000);
            conn.setRequestProperty("Accept", "application/json");
            if (headers != null) {
                for (Map.Entry<String, String> e : headers.entrySet()) {
                    conn.setRequestProperty(e.getKey(), e.getValue());
                }
            }
            if (body != null) {
                conn.setDoOutput(true);
                if (contentType != null) conn.setRequestProperty("Content-Type", contentType);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body);
                }
            }
            int code = conn.getResponseCode();
            InputStream is = (code >= 200 && code < 300) ? conn.getInputStream() : conn.getErrorStream();
            String text = is == null ? "" : readAll(is);
            return new Response(code, text);
        } finally {
            conn.disconnect();
        }
    }

    private static String readAll(InputStream is) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int n;
        while ((n = is.read(chunk)) != -1) buf.write(chunk, 0, n);
        return new String(buf.toByteArray(), StandardCharsets.UTF_8);
    }
}
