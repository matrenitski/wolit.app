package app.wolit.bitcoin;

/** A fully signed, ready-to-broadcast transaction plus a human-facing summary. */
public final class BuiltTx {
    public final String hex;
    public final String txid;
    public final long fee;     // satoshis
    public final long change;  // satoshis
    public final int vsize;
    public final long amount;  // satoshis actually sent to the recipient

    public BuiltTx(String hex, String txid, long fee, long change, int vsize, long amount) {
        this.hex = hex;
        this.txid = txid;
        this.fee = fee;
        this.change = change;
        this.vsize = vsize;
        this.amount = amount;
    }
}
