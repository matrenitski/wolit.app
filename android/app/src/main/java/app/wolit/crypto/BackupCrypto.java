package app.wolit.crypto;

import android.util.Base64;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.security.spec.KeySpec;

import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Passphrase-based encryption for the downloadable backup file, byte-compatible with
 * the web app's src/lib/walletEncryption.ts: PBKDF2-HMAC-SHA256 (250k iterations) to a
 * 256-bit key, AES-256-GCM with a 12-byte IV and a 16-byte salt. AES-GCM appends the
 * auth tag to the ciphertext in both WebCrypto and the JCE, so backups created in one
 * client decrypt in the other.
 */
public final class BackupCrypto {
    private BackupCrypto() {}

    private static final int ITERATIONS = 250_000;
    private static final int KEY_BITS = 256;
    private static final int GCM_TAG_BITS = 128;

    private static SecretKey deriveKey(String passphrase, byte[] salt) throws Exception {
        SecretKeyFactory f = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
        KeySpec spec = new PBEKeySpec(passphrase.toCharArray(), salt, ITERATIONS, KEY_BITS);
        byte[] keyBytes = f.generateSecret(spec).getEncoded();
        return new SecretKeySpec(keyBytes, "AES");
    }

    private static String b64(byte[] b) {
        return Base64.encodeToString(b, Base64.NO_WRAP);
    }

    private static byte[] unb64(String s) {
        return Base64.decode(s, Base64.NO_WRAP);
    }

    /** Returns the EncryptedBackup JSON document as a string. */
    public static String encrypt(String plaintext, String passphrase) throws Exception {
        SecureRandom rng = new SecureRandom();
        byte[] salt = new byte[16];
        byte[] iv = new byte[12];
        rng.nextBytes(salt);
        rng.nextBytes(iv);

        SecretKey key = deriveKey(passphrase, salt);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_BITS, iv));
        byte[] ct = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));

        JSONObject o = new JSONObject();
        o.put("app", "wolit.app");
        o.put("v", 1);
        o.put("kdf", "PBKDF2-SHA256");
        o.put("iterations", ITERATIONS);
        o.put("salt", b64(salt));
        o.put("iv", b64(iv));
        o.put("ciphertext", b64(ct));
        return o.toString(2);
    }

    /** Decrypts an EncryptedBackup JSON document back to plaintext. */
    public static String decrypt(String backupJson, String passphrase) throws Exception {
        JSONObject o = new JSONObject(backupJson);
        byte[] salt = unb64(o.getString("salt"));
        byte[] iv = unb64(o.getString("iv"));
        byte[] ct = unb64(o.getString("ciphertext"));

        SecretKey key = deriveKey(passphrase, salt);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_BITS, iv));
        byte[] pt = cipher.doFinal(ct);
        return new String(pt, StandardCharsets.UTF_8);
    }
}
