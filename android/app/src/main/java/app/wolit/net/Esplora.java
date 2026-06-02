package app.wolit.net;

import app.wolit.Config;
import app.wolit.bitcoin.Utxo;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Chain data via the public mempool.space / Esplora API. Mirrors src/lib/esplora.ts.
 */
public final class Esplora {
    private Esplora() {}

    public static final class AddressStats {
        public final long confirmed; // sats
        public final long pending;   // sats (unconfirmed mempool delta, may be negative)
        public AddressStats(long confirmed, long pending) {
            this.confirmed = confirmed;
            this.pending = pending;
        }
    }

    public static final class TxSummary {
        public final String txid;
        public final long delta;       // + received, - sent (sats)
        public final boolean confirmed;
        public final long blockTime;   // unix seconds, 0 if pending
        public TxSummary(String txid, long delta, boolean confirmed, long blockTime) {
            this.txid = txid;
            this.delta = delta;
            this.confirmed = confirmed;
            this.blockTime = blockTime;
        }
    }

    private static String base() {
        return Config.esploraBase();
    }

    public static AddressStats fetchBalance(String address) throws IOException {
        Http.Response r = Http.get(base() + "/address/" + address, null);
        if (!r.ok()) throw new IOException("Couldn’t fetch balance (" + r.code + ")");
        try {
            JSONObject j = new JSONObject(r.body);
            JSONObject chain = j.getJSONObject("chain_stats");
            JSONObject mem = j.getJSONObject("mempool_stats");
            long confirmed = chain.getLong("funded_txo_sum") - chain.getLong("spent_txo_sum");
            long pending = mem.getLong("funded_txo_sum") - mem.getLong("spent_txo_sum");
            return new AddressStats(confirmed, pending);
        } catch (Exception e) {
            throw new IOException("Unexpected balance response", e);
        }
    }

    public static List<Utxo> fetchUtxos(String address) throws IOException {
        Http.Response r = Http.get(base() + "/address/" + address + "/utxo", null);
        if (!r.ok()) throw new IOException("Couldn’t fetch coins (" + r.code + ")");
        try {
            JSONArray arr = new JSONArray(r.body);
            List<Utxo> out = new ArrayList<>(arr.length());
            for (int i = 0; i < arr.length(); i++) {
                JSONObject u = arr.getJSONObject(i);
                out.add(new Utxo(u.getString("txid"), u.getInt("vout"), u.getLong("value")));
            }
            return out;
        } catch (Exception e) {
            throw new IOException("Unexpected UTXO response", e);
        }
    }

    /** Recommended fee in sat/vByte (half-hour target), with sane fallbacks. */
    public static double fetchFeeRate() {
        try {
            Http.Response r = Http.get(base() + "/v1/fees/recommended", null);
            if (r.ok()) {
                JSONObject j = new JSONObject(r.body);
                double rate = j.optDouble("halfHourFee",
                        j.optDouble("hourFee", j.optDouble("economyFee", 0)));
                if (rate > 0) return rate;
            }
        } catch (Exception ignored) {
            // fall through to default
        }
        return Config.isMainnet() ? 8 : 1;
    }

    /** Current BTC price in USD, or null if unavailable. */
    public static Double fetchPriceUsd() {
        try {
            Http.Response r = Http.get("https://mempool.space/api/v1/prices", null);
            if (!r.ok()) return null;
            JSONObject j = new JSONObject(r.body);
            double usd = j.optDouble("USD", 0);
            return usd > 0 ? usd : null;
        } catch (Exception e) {
            return null;
        }
    }

    public static String broadcast(String hex) throws IOException {
        Http.Response r = Http.request("POST", base() + "/tx", null, "text/plain",
                hex.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        String text = r.body == null ? "" : r.body.trim();
        if (!r.ok()) throw new IOException(text.isEmpty() ? "Broadcast failed (" + r.code + ")" : text);
        return text; // txid
    }

    public static List<TxSummary> fetchHistory(String address) throws IOException {
        Http.Response r = Http.get(base() + "/address/" + address + "/txs", null);
        if (!r.ok()) throw new IOException("Couldn’t fetch history (" + r.code + ")");
        try {
            JSONArray txs = new JSONArray(r.body);
            List<TxSummary> out = new ArrayList<>(txs.length());
            for (int i = 0; i < txs.length(); i++) {
                JSONObject tx = txs.getJSONObject(i);
                long delta = 0;
                JSONArray vout = tx.getJSONArray("vout");
                for (int k = 0; k < vout.length(); k++) {
                    JSONObject o = vout.getJSONObject(k);
                    if (address.equals(o.optString("scriptpubkey_address", null))) {
                        delta += o.getLong("value");
                    }
                }
                JSONArray vin = tx.getJSONArray("vin");
                for (int k = 0; k < vin.length(); k++) {
                    JSONObject in = vin.getJSONObject(k);
                    JSONObject prev = in.optJSONObject("prevout");
                    if (prev != null && address.equals(prev.optString("scriptpubkey_address", null))) {
                        delta -= prev.getLong("value");
                    }
                }
                JSONObject status = tx.optJSONObject("status");
                boolean confirmed = status != null && status.optBoolean("confirmed", false);
                long blockTime = status != null ? status.optLong("block_time", 0) : 0;
                out.add(new TxSummary(tx.getString("txid"), delta, confirmed, blockTime));
            }
            return out;
        } catch (IOException e) {
            throw e;
        } catch (Exception e) {
            throw new IOException("Unexpected history response", e);
        }
    }

    public static List<TxSummary> emptyHistory() {
        return Collections.emptyList();
    }
}
