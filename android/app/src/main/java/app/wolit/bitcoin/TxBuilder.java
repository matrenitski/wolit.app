package app.wolit.bitcoin;

import org.bitcoinj.core.Address;
import org.bitcoinj.core.Coin;
import org.bitcoinj.core.ECKey;
import org.bitcoinj.core.NetworkParameters;
import org.bitcoinj.core.Sha256Hash;
import org.bitcoinj.core.Transaction;
import org.bitcoinj.core.TransactionInput;
import org.bitcoinj.core.TransactionOutPoint;
import org.bitcoinj.core.TransactionWitness;
import org.bitcoinj.core.Utils;
import org.bitcoinj.crypto.TransactionSignature;
import org.bitcoinj.script.Script;
import org.bitcoinj.script.ScriptBuilder;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * Coin selection + native-SegWit (P2WPKH) transaction building and signing for the
 * wallet's single address. Mirrors src/lib/bitcoin.ts createTransaction(): greedy
 * largest-first selection, a 2-output (recipient + change) layout that folds dust
 * change into the fee, and a "send max" sweep.
 */
public final class TxBuilder {
    private TxBuilder() {}

    private static final long DUST = 546; // sats — below this an output isn't worth creating

    /** Rough vsize for a P2WPKH tx: inputs * 68 + outputs * 31 + 11 overhead. */
    private static int estimateVsize(int nIn, int nOut) {
        return (int) Math.ceil(nIn * 68.0 + nOut * 31.0 + 11.0);
    }

    public static BuiltTx create(WolitWallet wallet,
                                 String toAddress,
                                 long amountSats,
                                 List<Utxo> utxos,
                                 double feeRate,
                                 boolean sendMax) {
        NetworkParameters params = wallet.params;

        if (!WolitWallet.isValidAddress(toAddress, wallet.mainnet)) {
            throw new IllegalArgumentException("That doesn’t look like a valid address for this network.");
        }
        if (utxos == null || utxos.isEmpty()) {
            throw new IllegalArgumentException("No spendable coins yet.");
        }

        List<Utxo> sorted = new ArrayList<>(utxos);
        sorted.sort(Comparator.comparingLong((Utxo u) -> u.value).reversed());
        long totalAvailable = 0;
        for (Utxo u : sorted) totalAvailable += u.value;

        List<Utxo> selected = new ArrayList<>();
        long inSum = 0;

        if (sendMax) {
            selected.addAll(sorted);
            inSum = totalAvailable;
        } else {
            for (Utxo u : sorted) {
                selected.add(u);
                inSum += u.value;
                long projectedFee = (long) Math.ceil(estimateVsize(selected.size(), 2) * feeRate);
                if (inSum >= amountSats + projectedFee) break;
            }
        }

        int outputs = sendMax ? 1 : 2;
        long fee = (long) Math.ceil(estimateVsize(selected.size(), outputs) * feeRate);
        long sendAmount = amountSats;
        long change = 0;

        if (sendMax) {
            sendAmount = inSum - fee;
            if (sendAmount < DUST) {
                throw new IllegalArgumentException("Balance is too low to cover the network fee.");
            }
        } else {
            if (inSum < amountSats + fee) {
                throw new IllegalArgumentException("Not enough funds to cover the amount plus the network fee.");
            }
            change = inSum - amountSats - fee;
            if (change < DUST) {
                // Not worth a change output — fold the dust into the fee.
                fee += change;
                change = 0;
                outputs = 1;
            }
        }

        Transaction tx = new Transaction(params);
        tx.addOutput(Coin.valueOf(sendAmount), Address.fromString(params, toAddress.trim()));
        if (change > 0) {
            tx.addOutput(Coin.valueOf(change), Address.fromString(params, wallet.address));
        }

        for (Utxo u : selected) {
            TransactionOutPoint outPoint =
                    new TransactionOutPoint(params, u.vout, Sha256Hash.wrap(u.txid));
            tx.addInput(new TransactionInput(
                    params, tx, new byte[0], outPoint, Coin.valueOf(u.value)));
        }

        ECKey key = wallet.signingKey;
        // For P2WPKH the signed scriptCode is the equivalent P2PKH script of the key.
        Script scriptCode = ScriptBuilder.createP2PKHOutputScript(key.getPubKeyHash());
        for (int i = 0; i < selected.size(); i++) {
            Coin value = Coin.valueOf(selected.get(i).value);
            TransactionSignature sig = tx.calculateWitnessSignature(
                    i, key, scriptCode, value, Transaction.SigHash.ALL, false);
            tx.getInput(i).setWitness(TransactionWitness.redeemP2WPKH(sig, key));
            tx.getInput(i).setScriptSig(ScriptBuilder.createEmpty());
        }

        String hex = Utils.HEX.encode(tx.bitcoinSerialize());
        String txid = tx.getTxId().toString();
        int vsize = (int) tx.getVsize();
        return new BuiltTx(hex, txid, fee, change, vsize, sendAmount);
    }
}
