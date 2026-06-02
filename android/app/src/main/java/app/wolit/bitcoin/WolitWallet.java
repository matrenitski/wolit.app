package app.wolit.bitcoin;

import org.bitcoinj.core.Address;
import org.bitcoinj.core.ECKey;
import org.bitcoinj.core.NetworkParameters;
import org.bitcoinj.core.SegwitAddress;
import org.bitcoinj.crypto.ChildNumber;
import org.bitcoinj.crypto.DeterministicHierarchy;
import org.bitcoinj.crypto.DeterministicKey;
import org.bitcoinj.crypto.HDKeyDerivation;
import org.bitcoinj.crypto.MnemonicCode;
import org.bitcoinj.params.MainNetParams;
import org.bitcoinj.params.TestNet3Params;
import org.bitcoinj.wallet.DeterministicSeed;

import java.security.SecureRandom;
import java.util.Arrays;
import java.util.List;

/**
 * The wallet's single native-SegWit (BIP84) receive account derived from a 12-word
 * mnemonic. Matches the web app exactly: path m/84'/{coin}'/0'/0/0, coin = 0 mainnet /
 * 1 testnet, P2WPKH (bc1.../tb1...). This guarantees a wallet created on either client
 * resolves to the same address and is fully interoperable.
 */
public final class WolitWallet {

    public final String mnemonic;
    public final boolean mainnet;
    public final String address;     // bc1.../tb1...
    public final String path;        // m/84'/coin'/0'/0/0
    public final ECKey signingKey;   // key that controls `address`
    public final NetworkParameters params;

    private WolitWallet(String mnemonic, boolean mainnet, String address, String path,
                        ECKey signingKey, NetworkParameters params) {
        this.mnemonic = mnemonic;
        this.mainnet = mainnet;
        this.address = address;
        this.path = path;
        this.signingKey = signingKey;
        this.params = params;
    }

    public static NetworkParameters paramsFor(boolean mainnet) {
        return mainnet ? MainNetParams.get() : TestNet3Params.get();
    }

    /** BIP84 coin type: 0' for mainnet, 1' for all testnets. */
    private static int coinType(boolean mainnet) {
        return mainnet ? 0 : 1;
    }

    /** Generate a fresh 12-word (128-bit) BIP39 mnemonic. */
    public static String generateMnemonic() {
        try {
            byte[] entropy = new byte[16];
            new SecureRandom().nextBytes(entropy);
            List<String> words = MnemonicCode.INSTANCE.toMnemonic(entropy);
            return String.join(" ", words);
        } catch (Exception e) {
            throw new RuntimeException("Could not generate a wallet seed", e);
        }
    }

    public static boolean isValidMnemonic(String mnemonic) {
        if (mnemonic == null) return false;
        try {
            MnemonicCode.INSTANCE.check(Arrays.asList(mnemonic.trim().split("\\s+")));
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    public static boolean isValidAddress(String address, boolean mainnet) {
        try {
            Address.fromString(paramsFor(mainnet), address.trim());
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** Derive the BIP84 first-receive account from a mnemonic. */
    public static WolitWallet fromMnemonic(String mnemonic, boolean mainnet) {
        try {
            String clean = mnemonic.trim();
            List<String> words = Arrays.asList(clean.split("\\s+"));
            DeterministicSeed seed = new DeterministicSeed(words, null, "", 0L);
            byte[] seedBytes = seed.getSeedBytes();
            if (seedBytes == null) throw new IllegalStateException("Invalid mnemonic");

            DeterministicKey master = HDKeyDerivation.createMasterPrivateKey(seedBytes);
            DeterministicHierarchy hierarchy = new DeterministicHierarchy(master);
            int coin = coinType(mainnet);
            List<ChildNumber> p = Arrays.asList(
                    new ChildNumber(84, true),
                    new ChildNumber(coin, true),
                    new ChildNumber(0, true),
                    new ChildNumber(0, false),
                    new ChildNumber(0, false));
            DeterministicKey node = hierarchy.get(p, false, true);

            NetworkParameters params = paramsFor(mainnet);
            // A clean ECKey (private + public) for signing and address derivation.
            ECKey key = ECKey.fromPrivate(node.getPrivKey());
            String address = SegwitAddress.fromKey(params, key).toString();
            String path = "m/84'/" + coin + "'/0'/0/0";
            return new WolitWallet(clean, mainnet, address, path, key, params);
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException("Could not derive wallet from mnemonic", e);
        }
    }
}
