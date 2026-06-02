package app.wolit.drive;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Intent;

import app.wolit.Config;

import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.Scope;

import java.util.Collections;

/**
 * Native Google authorization using Play Services' Authorization API. Unlike the web
 * Identity Services flow (which Google blocks inside embedded WebViews), this is a
 * first-class Android system flow: it returns an OAuth access token for the
 * non-sensitive drive.appdata scope, which we then use against the Drive REST API.
 *
 * Grant matching is by app package + signing certificate, so the Google Cloud project
 * must contain an OAuth client of type "Android" for app.wolit with this app's SHA-1.
 *
 * The access token lives only in memory for the session and is never persisted.
 */
public final class GoogleAuth {
    private GoogleAuth() {}

    private static volatile String accessToken;
    private static volatile long tokenExpiry;

    public interface Callback {
        void onToken(String token);
        /** Interactive consent required: launch this, then call handleResult(). */
        void onNeedsConsent(PendingIntent pendingIntent);
        void onError(Exception e);
    }

    public static boolean isSignedIn() {
        return accessToken != null && System.currentTimeMillis() < tokenExpiry;
    }

    public static String token() {
        return accessToken;
    }

    /** Clears the cached token so the next Drive call re-authorizes. */
    public static void invalidate() {
        accessToken = null;
        tokenExpiry = 0;
    }

    private static AuthorizationRequest request() {
        return AuthorizationRequest.builder()
                .setRequestedScopes(Collections.singletonList(new Scope(Config.DRIVE_SCOPE)))
                .build();
    }

    /**
     * Request authorization. If a grant already exists this completes silently with a
     * token; otherwise it reports a PendingIntent the caller must launch for consent.
     */
    public static void authorize(Activity activity, Callback cb) {
        Identity.getAuthorizationClient(activity)
                .authorize(request())
                .addOnSuccessListener(result -> {
                    if (result.hasResolution()) {
                        cb.onNeedsConsent(result.getPendingIntent());
                    } else {
                        store(result);
                        if (accessToken != null) cb.onToken(accessToken);
                        else cb.onError(new IllegalStateException("No access token granted."));
                    }
                })
                .addOnFailureListener(cb::onError);
    }

    /** Complete authorization from the consent activity result. */
    public static void handleResult(Activity activity, Intent data, Callback cb) {
        try {
            AuthorizationResult result =
                    Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(data);
            store(result);
            if (accessToken != null) cb.onToken(accessToken);
            else cb.onError(new IllegalStateException("Authorization did not return a token."));
        } catch (Exception e) {
            cb.onError(e);
        }
    }

    private static void store(AuthorizationResult result) {
        accessToken = result.getAccessToken();
        // The API doesn't expose the exact expiry; Google access tokens last ~1h. Use a
        // conservative 50-minute window and re-authorize on any 401.
        tokenExpiry = System.currentTimeMillis() + 50L * 60L * 1000L;
    }

    public static void signOut() {
        invalidate();
    }
}
