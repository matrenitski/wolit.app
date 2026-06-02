package app.wolit;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.LayoutInflater;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.view.WindowManager;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.FileProvider;

import app.wolit.bitcoin.BuiltTx;
import app.wolit.bitcoin.TxBuilder;
import app.wolit.bitcoin.Utxo;
import app.wolit.bitcoin.WolitWallet;
import app.wolit.crypto.BackupCrypto;
import app.wolit.databinding.ActivityMainBinding;
import app.wolit.databinding.DialogBackupBinding;
import app.wolit.databinding.DialogReceiveBinding;
import app.wolit.databinding.DialogSendBinding;
import app.wolit.drive.DriveStore;
import app.wolit.drive.GoogleAuth;
import app.wolit.net.Esplora;
import app.wolit.util.Async;
import app.wolit.util.Format;
import app.wolit.util.Qr;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

public class MainActivity extends AppCompatActivity {

    private ActivityMainBinding b;
    private final boolean mainnet = Config.isMainnet();

    private WolitWallet wallet;            // derived signing account (null until opened)
    private DriveStore.WalletFile walletFile; // the raw stored record (for backups)
    private boolean menuVisible = false;

    // Declared before authLauncher: this anonymous class may reference the (later)
    // launcher field — anonymous-class bodies are exempt from Java's forward-reference
    // rule — whereas the launcher's lambda initializer is not, so it must come second.
    private final GoogleAuth.Callback authCallback = new GoogleAuth.Callback() {
        @Override public void onToken(String token) { openWallet(); }
        @Override public void onNeedsConsent(android.app.PendingIntent pi) {
            try {
                authLauncher.launch(new IntentSenderRequest.Builder(pi.getIntentSender()).build());
            } catch (Exception e) {
                showError(getString(R.string.continue_google) + " failed: " + e.getMessage(), MainActivity.this::beginSignIn);
            }
        }
        @Override public void onError(Exception e) {
            showError(message(e), MainActivity.this::beginSignIn);
        }
    };

    // Launches Google's consent screen when authorization needs interaction.
    private final ActivityResultLauncher<IntentSenderRequest> authLauncher =
            registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), result -> {
                if (result.getResultCode() == RESULT_OK && result.getData() != null) {
                    GoogleAuth.handleResult(this, result.getData(), authCallback);
                } else {
                    showSignIn();
                }
            });

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        b = ActivityMainBinding.inflate(getLayoutInflater());
        setContentView(b.getRoot());
        setSupportActionBar(b.toolbar);

        // An exported (passphrase-encrypted) backup is staged in the cache only long
        // enough to share it; sweep any left over from a previous session.
        clearStaleBackups();

        String net = mainnet ? "MAINNET" : "TESTNET";
        b.networkBadge.setText(net);
        b.networkBadgeSignIn.setText(net);
        b.notConfigured.setVisibility(
                Config.GOOGLE_CLIENT_ID == null || Config.GOOGLE_CLIENT_ID.isEmpty()
                        ? View.VISIBLE : View.GONE);

        b.btnSignIn.setOnClickListener(v -> beginSignIn());
        b.btnRetry.setOnClickListener(v -> { if (retryAction != null) retryAction.run(); });
        b.btnReceive.setOnClickListener(v -> showReceive());
        b.btnSend.setOnClickListener(v -> showSend());
        b.addressText.setOnClickListener(v -> showReceive());

        // Returning users with an existing grant are signed in silently; new users land
        // on the sign-in screen.
        showLoading(getString(R.string.signing_in));
        GoogleAuth.authorize(this, new GoogleAuth.Callback() {
            @Override public void onToken(String token) { openWallet(); }
            @Override public void onNeedsConsent(android.app.PendingIntent pi) { showSignIn(); }
            @Override public void onError(Exception e) { showSignIn(); }
        });
    }

    // ---------------------------------------------------------------- screens

    private Runnable retryAction;

    private void only(View visible) {
        b.overlayLoading.setVisibility(visible == b.overlayLoading ? View.VISIBLE : View.GONE);
        b.panelSignIn.setVisibility(visible == b.panelSignIn ? View.VISIBLE : View.GONE);
        b.panelWallet.setVisibility(visible == b.panelWallet ? View.VISIBLE : View.GONE);
        b.panelError.setVisibility(visible == b.panelError ? View.VISIBLE : View.GONE);
        menuVisible = visible == b.panelWallet;
        invalidateOptionsMenu();
    }

    private void showLoading(String text) {
        b.loadingText.setText(text);
        only(b.overlayLoading);
    }

    private void showSignIn() { only(b.panelSignIn); }

    private void showWallet() { only(b.panelWallet); }

    private void showError(String text, Runnable retry) {
        b.errorText.setText(text);
        retryAction = retry;
        only(b.panelError);
    }

    // ---------------------------------------------------------------- auth

    private void beginSignIn() {
        showLoading(getString(R.string.signing_in));
        GoogleAuth.authorize(this, authCallback);
    }

    // ---------------------------------------------------------------- wallet open

    private void openWallet() {
        showLoading(getString(R.string.loading_wallet));
        Async.run(() -> {
            DriveStore.WalletFile file = DriveStore.loadWallet();
            boolean created = false;
            if (file == null) {
                Async.onMain(() -> b.loadingText.setText(getString(R.string.creating_wallet)));
                String mnemonic = WolitWallet.generateMnemonic();
                DriveStore.WalletFile fresh =
                        new DriveStore.WalletFile(1, Config.NETWORK, mnemonic, isoNow());
                DriveStore.saveWallet(fresh);
                DriveStore.WalletFile saved = DriveStore.loadWallet();
                if (saved == null || !saved.mnemonic.equals(mnemonic)) {
                    throw new IllegalStateException(
                            "Your wallet was created but Google Drive did not confirm it saved. Please try again.");
                }
                file = saved;
                created = true;
            }
            WolitWallet w = WolitWallet.fromMnemonic(file.mnemonic, mainnet);
            return new Opened(w, file, created);
        }, opened -> {
            if (gone()) return;
            wallet = opened.wallet;
            walletFile = opened.file;
            b.addressText.setText(wallet.address);
            showWallet();
            if (opened.created) toast("Wallet created");
            refresh();
        }, e -> {
            if (gone()) return;
            if (e instanceof DriveStore.NeedsAuthException) {
                showError(message(e), this::beginSignIn);
            } else {
                showError(message(e), this::openWallet);
            }
        });
    }

    private static final class Opened {
        final WolitWallet wallet;
        final DriveStore.WalletFile file;
        final boolean created;
        Opened(WolitWallet w, DriveStore.WalletFile f, boolean c) { wallet = w; file = f; created = c; }
    }

    // ---------------------------------------------------------------- refresh

    private void refresh() {
        if (wallet == null) return;
        final String address = wallet.address;
        Async.run(() -> {
            Esplora.AddressStats bal = Esplora.fetchBalance(address);
            List<Esplora.TxSummary> hist;
            try { hist = Esplora.fetchHistory(address); } catch (Exception e) { hist = Esplora.emptyHistory(); }
            Double price = Esplora.fetchPriceUsd();
            return new Snapshot(bal, hist, price);
        }, snap -> {
            if (gone()) return;
            renderBalance(snap);
        }, e -> {
            // Keep prior data on transient failures.
        });
    }

    private static final class Snapshot {
        final Esplora.AddressStats balance;
        final List<Esplora.TxSummary> history;
        final Double price;
        Snapshot(Esplora.AddressStats b, List<Esplora.TxSummary> h, Double p) { balance = b; history = h; price = p; }
    }

    private void renderBalance(Snapshot snap) {
        long confirmed = snap.balance.confirmed;
        b.balanceBtc.setText(Format.formatBtc(confirmed) + " BTC");
        String usd = Format.formatUsd(confirmed, snap.price);
        b.balanceUsd.setText(usd == null ? "" : usd);

        if (snap.balance.pending != 0) {
            b.balancePending.setVisibility(View.VISIBLE);
            String sign = snap.balance.pending > 0 ? "+" : "";
            b.balancePending.setText(sign + Format.formatBtc(snap.balance.pending) + " BTC pending");
        } else {
            b.balancePending.setVisibility(View.GONE);
        }

        renderHistory(snap.history);
    }

    private void renderHistory(List<Esplora.TxSummary> history) {
        b.historyContainer.removeAllViews();
        if (history == null || history.isEmpty()) {
            b.emptyActivity.setVisibility(View.VISIBLE);
            return;
        }
        b.emptyActivity.setVisibility(View.GONE);
        LayoutInflater inflater = getLayoutInflater();
        int shown = 0;
        for (Esplora.TxSummary tx : history) {
            if (shown++ >= 15) break;
            View row = inflater.inflate(R.layout.item_tx, b.historyContainer, false);
            android.widget.TextView dir = row.findViewById(R.id.txDirection);
            android.widget.TextView status = row.findViewById(R.id.txStatus);
            android.widget.TextView amount = row.findViewById(R.id.txAmount);
            boolean received = tx.delta >= 0;
            dir.setText(received ? "Received" : "Sent");
            status.setText(tx.confirmed ? Format.relativeTime(tx.blockTime) : getString(R.string.pending));
            String sign = received ? "+" : "";
            amount.setText(sign + Format.formatBtc(tx.delta));
            amount.setTextColor(getColor(received ? R.color.green : R.color.text));
            final String txid = tx.txid;
            row.setOnClickListener(v -> openUrl(Config.explorerBase() + "/tx/" + txid));
            b.historyContainer.addView(row);
        }
    }

    // ---------------------------------------------------------------- receive

    private void showReceive() {
        if (wallet == null) return;
        DialogReceiveBinding rb = DialogReceiveBinding.inflate(getLayoutInflater());
        rb.receiveAddress.setText(wallet.address);
        Bitmap qr = Qr.encode(wallet.address, 600);
        if (qr != null) rb.qrImage.setImageBitmap(qr);

        AlertDialog dialog = sheet(rb.getRoot());
        rb.btnCopyAddr.setOnClickListener(v -> { copy(wallet.address); toast(getString(R.string.copied)); });
        rb.btnShareAddr.setOnClickListener(v -> {
            Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain")
                    .putExtra(Intent.EXTRA_TEXT, wallet.address);
            startActivity(Intent.createChooser(send, getString(R.string.share)));
        });
        dialog.show();
    }

    // ---------------------------------------------------------------- send

    private void showSend() {
        if (wallet == null) return;
        DialogSendBinding sb = DialogSendBinding.inflate(getLayoutInflater());
        AlertDialog dialog = sheet(sb.getRoot());

        final BuiltTx[] built = {null};
        // Bumped on every input change and on each new review request, so an in-flight
        // UTXO/fee calculation whose inputs are now stale is ignored when it returns.
        final int[] gen = {0};
        Runnable resetReview = () -> {
            built[0] = null;
            gen[0]++;
            sb.sendSummary.setVisibility(View.GONE);
            sb.btnReview.setEnabled(true);
            sb.btnReview.setText(R.string.review);
        };
        TextWatcher watcher = new SimpleWatcher(resetReview);
        sb.toAddress.addTextChangedListener(watcher);
        sb.amount.addTextChangedListener(watcher);
        sb.sendMax.setOnCheckedChangeListener((v, c) -> {
            sb.amountLayout.setEnabled(!c);
            sb.amount.setEnabled(!c);
            resetReview.run();
        });

        sb.btnReview.setOnClickListener(v -> {
            if (built[0] != null) {
                // Second tap = confirm & broadcast.
                broadcast(built[0], dialog);
                return;
            }
            String to = sb.toAddress.getText() == null ? "" : sb.toAddress.getText().toString().trim();
            boolean max = sb.sendMax.isChecked();
            if (!WolitWallet.isValidAddress(to, mainnet)) {
                sb.toAddressLayout.setError("Not a valid address for this network.");
                return;
            }
            sb.toAddressLayout.setError(null);
            long amountSats = 0;
            if (!max) {
                String amt = sb.amount.getText() == null ? "" : sb.amount.getText().toString();
                amountSats = Format.btcToSats(amt);
                if (amountSats == Long.MIN_VALUE || amountSats <= 0) {
                    sb.amountLayout.setError("Enter an amount in BTC.");
                    return;
                }
                sb.amountLayout.setError(null);
            }
            final long finalAmount = amountSats;
            final int myGen = ++gen[0];
            sb.btnReview.setEnabled(false);
            sb.btnReview.setText("Calculating…");
            Async.run(() -> {
                List<Utxo> utxos = Esplora.fetchUtxos(wallet.address);
                double feeRate = Esplora.fetchFeeRate();
                return TxBuilder.create(wallet, to, finalAmount, utxos, feeRate, max);
            }, tx -> {
                if (gone()) return;
                if (myGen != gen[0]) return; // inputs changed while building — discard stale review
                built[0] = tx;
                sb.btnReview.setEnabled(true);
                sb.btnReview.setText(R.string.confirm_send);
                String summary = "Sending  " + Format.formatBtc(tx.amount) + " BTC\n"
                        + "Network fee  " + Format.formatBtc(tx.fee) + " BTC  (" + tx.vsize + " vB)\n"
                        + "To  " + Format.shortAddr(to, 14, 10);
                sb.sendSummary.setText(summary);
                sb.sendSummary.setVisibility(View.VISIBLE);
            }, e -> {
                if (gone()) return;
                if (myGen != gen[0]) return; // stale failure for inputs the user already changed
                sb.btnReview.setEnabled(true);
                sb.btnReview.setText(R.string.review);
                toast(message(e));
            });
        });
        dialog.show();
    }

    private void broadcast(BuiltTx tx, AlertDialog dialog) {
        showLoading(getString(R.string.sending));
        dialog.dismiss();
        Async.run(() -> Esplora.broadcast(tx.hex), txid -> {
            if (gone()) return;
            showWallet();
            toast("Sent! " + Format.shortAddr(txid, 10, 8));
            b.toolbar.postDelayed(this::refresh, 1500);
        }, e -> {
            if (gone()) return;
            showWallet();
            new AlertDialog.Builder(this)
                    .setTitle("Broadcast failed")
                    .setMessage(message(e))
                    .setPositiveButton("OK", null)
                    .show();
        });
    }

    // ---------------------------------------------------------------- backup

    private void showBackup() {
        if (wallet == null) return;
        DialogBackupBinding bb = DialogBackupBinding.inflate(getLayoutInflater());
        AlertDialog dialog = sheet(bb.getRoot());
        // The recovery words are about to be shown here: block screenshots, screen
        // recording, the recent-apps thumbnail, and overlay capture for this window.
        if (dialog.getWindow() != null) {
            dialog.getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE,
                    WindowManager.LayoutParams.FLAG_SECURE);
        }

        bb.btnShowWords.setOnClickListener(v -> {
            bb.mnemonicBox.setText(numberedWords(wallet.mnemonic));
            bb.mnemonicBox.setVisibility(View.VISIBLE);
            bb.btnShowWords.setVisibility(View.GONE);
        });

        bb.btnExport.setOnClickListener(v -> {
            String pass = bb.passphrase.getText() == null ? "" : bb.passphrase.getText().toString();
            if (pass.length() < 8) {
                bb.passphraseLayout.setError("Use at least 8 characters.");
                return;
            }
            bb.passphraseLayout.setError(null);
            final String plaintext = walletFile != null ? walletFile.toJson()
                    : new DriveStore.WalletFile(1, Config.NETWORK, wallet.mnemonic, isoNow()).toJson();
            Async.run(() -> {
                String encrypted = BackupCrypto.encrypt(plaintext, pass);
                File dir = new File(getCacheDir(), "backups");
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                File out = new File(dir, "wolit-backup.json");
                try (FileOutputStream fos = new FileOutputStream(out)) {
                    fos.write(encrypted.getBytes(StandardCharsets.UTF_8));
                }
                return out;
            }, file -> {
                if (gone()) return;
                dialog.dismiss();
                Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", file);
                Intent share = new Intent(Intent.ACTION_SEND)
                        .setType("application/json")
                        .putExtra(Intent.EXTRA_STREAM, uri)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivity(Intent.createChooser(share, getString(R.string.export_encrypted)));
            }, e -> toast(message(e)));
        });
        dialog.show();
    }

    // ---------------------------------------------------------------- delete / sign out

    private void confirmDelete() {
        new AlertDialog.Builder(this)
                .setTitle(R.string.delete_title)
                .setMessage(R.string.delete_warning)
                .setNegativeButton(R.string.cancel, null)
                .setPositiveButton(R.string.delete_confirm, (d, w) -> {
                    showLoading(getString(R.string.delete_wallet) + "…");
                    Async.run(() -> { DriveStore.deleteWallet(); return null; },
                            r -> { if (!gone()) signOutLocal(); },
                            e -> { if (!gone()) showError(message(e), this::showWalletIfReady); });
                })
                .show();
    }

    private void showWalletIfReady() {
        if (wallet != null) showWallet(); else showSignIn();
    }

    private void signOutLocal() {
        GoogleAuth.signOut();
        wallet = null;
        walletFile = null;
        showSignIn();
    }

    // ---------------------------------------------------------------- menu

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        getMenuInflater().inflate(R.menu.main_menu, menu);
        return true;
    }

    @Override
    public boolean onPrepareOptionsMenu(Menu menu) {
        for (int i = 0; i < menu.size(); i++) menu.getItem(i).setVisible(menuVisible);
        return super.onPrepareOptionsMenu(menu);
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        int id = item.getItemId();
        if (id == R.id.action_refresh) { refresh(); toast(getString(R.string.refresh) + "…"); return true; }
        if (id == R.id.action_backup) { showBackup(); return true; }
        if (id == R.id.action_sign_out) { signOutLocal(); return true; }
        if (id == R.id.action_delete) { confirmDelete(); return true; }
        return super.onOptionsItemSelected(item);
    }

    // ---------------------------------------------------------------- helpers

    private AlertDialog sheet(View content) {
        return new AlertDialog.Builder(this).setView(content).create();
    }

    private void copy(String text) {
        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        cm.setPrimaryClip(ClipData.newPlainText("wolit", text));
    }

    private void openUrl(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception ignored) {}
    }

    private void toast(String text) {
        Toast.makeText(this, text, Toast.LENGTH_SHORT).show();
    }

    /** True once the Activity is finishing/destroyed; async callbacks must not touch views. */
    private boolean gone() {
        return isFinishing() || isDestroyed();
    }

    private void clearStaleBackups() {
        File[] files = new File(getCacheDir(), "backups").listFiles();
        if (files != null) {
            for (File f : files) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        }
    }

    private static String numberedWords(String mnemonic) {
        String[] words = mnemonic.trim().split("\\s+");
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < words.length; i++) {
            if (i > 0) sb.append(i % 3 == 0 ? "\n" : "    ");
            sb.append(i + 1).append(". ").append(words[i]);
        }
        return sb.toString();
    }

    private static String isoNow() {
        SimpleDateFormat fmt = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        fmt.setTimeZone(TimeZone.getTimeZone("UTC"));
        return fmt.format(new java.util.Date());
    }

    private static String message(Throwable e) {
        String m = e.getMessage();
        return (m == null || m.isEmpty()) ? e.getClass().getSimpleName() : m;
    }

    /** A no-op-on-before/after TextWatcher that just runs an action on change. */
    private static final class SimpleWatcher implements TextWatcher {
        private final Runnable onChange;
        SimpleWatcher(Runnable onChange) { this.onChange = onChange; }
        @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
        @Override public void onTextChanged(CharSequence s, int a, int b, int c) {}
        @Override public void afterTextChanged(Editable s) { onChange.run(); }
    }
}
