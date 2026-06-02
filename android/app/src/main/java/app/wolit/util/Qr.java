package app.wolit.util;

import android.graphics.Bitmap;
import android.graphics.Color;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.MultiFormatWriter;
import com.google.zxing.common.BitMatrix;

import java.util.HashMap;
import java.util.Map;

/** QR-code rendering for the receive screen, backed by ZXing (pure Java). */
public final class Qr {
    private Qr() {}

    public static Bitmap encode(String content, int sizePx) {
        try {
            Map<EncodeHintType, Object> hints = new HashMap<>();
            hints.put(EncodeHintType.MARGIN, 1);
            BitMatrix matrix = new MultiFormatWriter()
                    .encode(content, BarcodeFormat.QR_CODE, sizePx, sizePx, hints);
            int w = matrix.getWidth();
            int h = matrix.getHeight();
            int[] pixels = new int[w * h];
            for (int y = 0; y < h; y++) {
                int offset = y * w;
                for (int x = 0; x < w; x++) {
                    pixels[offset + x] = matrix.get(x, y) ? Color.BLACK : Color.WHITE;
                }
            }
            Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            bmp.setPixels(pixels, 0, w, 0, 0, w, h);
            return bmp;
        } catch (Exception e) {
            return null;
        }
    }
}
