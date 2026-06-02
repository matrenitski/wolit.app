package app.wolit.util;

import android.os.Handler;
import android.os.Looper;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Tiny background-task helper: run work off the main thread and deliver the result (or
 * error) back on it. Keeps network/crypto off the UI thread without pulling in a
 * coroutines or RxJava runtime.
 */
public final class Async {
    private Async() {}

    public interface Work<T> {
        T run() throws Exception;
    }

    public interface Done<T> {
        void onResult(T result);
    }

    public interface Fail {
        void onError(Exception e);
    }

    private static final ExecutorService POOL = Executors.newCachedThreadPool();
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    public static <T> void run(Work<T> work, Done<T> done, Fail fail) {
        POOL.execute(() -> {
            try {
                T result = work.run();
                MAIN.post(() -> done.onResult(result));
            } catch (Exception e) {
                MAIN.post(() -> fail.onError(e));
            }
        });
    }

    public static void onMain(Runnable r) {
        MAIN.post(r);
    }
}
