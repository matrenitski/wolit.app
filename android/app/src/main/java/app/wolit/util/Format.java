package app.wolit.util;

import java.text.NumberFormat;
import java.util.Locale;

/** Display formatting, mirroring src/lib/format.ts. */
public final class Format {
    private Format() {}

    public static final long SATS_PER_BTC = 100_000_000L;

    public static long btcToSats(String btc) {
        try {
            double n = Double.parseDouble(btc.trim());
            if (Double.isNaN(n) || Double.isInfinite(n)) return Long.MIN_VALUE;
            return Math.round(n * SATS_PER_BTC);
        } catch (Exception e) {
            return Long.MIN_VALUE; // sentinel for "not a number"
        }
    }

    /** Format satoshis as a BTC string, trimming trailing zeros (min 1 decimal). */
    public static String formatBtc(long sats) {
        double btc = Math.abs(sats) / (double) SATS_PER_BTC;
        String s = String.format(Locale.US, "%.8f", btc);
        s = s.replaceAll("0+$", "").replaceAll("\\.$", ".0");
        return (sats < 0 ? "-" : "") + s;
    }

    public static String shortAddr(String a) {
        return shortAddr(a, 10, 6);
    }

    public static String shortAddr(String a, int lead, int tail) {
        if (a == null) return "";
        return a.length() > lead + tail + 1
                ? a.substring(0, lead) + "…" + a.substring(a.length() - tail)
                : a;
    }

    /** Satoshis to a formatted USD string given a BTC/USD price, or null. */
    public static String formatUsd(long sats, Double priceUsd) {
        if (priceUsd == null) return null;
        double usd = (sats / (double) SATS_PER_BTC) * priceUsd;
        NumberFormat nf = NumberFormat.getCurrencyInstance(Locale.US);
        nf.setMaximumFractionDigits(Math.abs(usd) >= 1000 ? 0 : 2);
        return nf.format(usd);
    }

    /** A compact relative time like "3m ago" / "2h ago" from a unix timestamp (seconds). */
    public static String relativeTime(long unixSeconds) {
        if (unixSeconds <= 0) return "pending";
        double diff = System.currentTimeMillis() / 1000.0 - unixSeconds;
        if (diff < 60) return "just now";
        if (diff < 3600) return (int) (diff / 60) + "m ago";
        if (diff < 86400) return (int) (diff / 3600) + "h ago";
        if (diff < 2592000) return (int) (diff / 86400) + "d ago";
        return java.text.DateFormat.getDateInstance(java.text.DateFormat.MEDIUM, Locale.US)
                .format(new java.util.Date(unixSeconds * 1000));
    }
}
