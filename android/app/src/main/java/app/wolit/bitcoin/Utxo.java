package app.wolit.bitcoin;

/** An unspent output controlled by our address. */
public final class Utxo {
    public final String txid;
    public final int vout;
    public final long value; // satoshis

    public Utxo(String txid, int vout, long value) {
        this.txid = txid;
        this.vout = vout;
        this.value = value;
    }
}
