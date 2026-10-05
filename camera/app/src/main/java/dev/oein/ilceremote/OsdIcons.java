package dev.oein.ilceremote;

import android.graphics.Canvas;
import android.graphics.ColorFilter;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.drawable.Drawable;

/**
 * Icons for the shooting display, drawn by hand: the camera's Android 2.3 font has none of the
 * symbol glyphs (they render as empty boxes).
 */
final class OsdIcons {
    private OsdIcons() {}

    /** Exposure compensation: a square split diagonally, "+" top-left and "-" bottom-right. */
    static class ExposureCompensation extends Base {
        private final Path triangle = new Path();

        ExposureCompensation(int widthPx, int heightPx) {
            super(widthPx, heightPx);
        }

        @Override
        public void draw(Canvas canvas) {
            // Drawn in a square and squeezed to the bounds' width (see SonyIcons.X_SCALE)
            float s = getBounds().height();
            canvas.save();
            canvas.scale(getBounds().width() / s, 1f);
            drawSquare(canvas, s);
            canvas.restore();
        }

        private void drawSquare(Canvas canvas, float s) {
            float line = Math.max(1.5f, s / 10f);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(0xffffffff);
            canvas.drawRect(0, 0, s, s, paint);
            triangle.reset();
            triangle.moveTo(s, 0);
            triangle.lineTo(s, s);
            triangle.lineTo(0, s);
            triangle.close();
            paint.setColor(0xff000000);
            canvas.drawPath(triangle, paint);
            // "+" in black on the white half
            float c = s * 0.3f;
            float arm = s * 0.16f;
            canvas.drawRect(c - arm, c - line / 2, c + arm, c + line / 2, paint);
            canvas.drawRect(c - line / 2, c - arm, c + line / 2, c + arm, paint);
            // "-" in white on the black half
            paint.setColor(0xffffffff);
            float m = s * 0.7f;
            canvas.drawRect(m - arm, m - line / 2, m + arm, m + line / 2, paint);
            // Frame
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(Math.max(1f, s / 16f));
            canvas.drawRect(0, 0, s, s, paint);
        }
    }

    /** Battery outline filled to the charge level; red when low. */
    static class Battery extends Base {
        private int percent;

        Battery(int widthPx, int heightPx) {
            super(widthPx, heightPx);
        }

        void setPercent(int percent) {
            this.percent = Math.max(0, Math.min(100, percent));
            invalidateSelf();
        }

        @Override
        public void draw(Canvas canvas) {
            float w = getBounds().width();
            float h = getBounds().height();
            float stroke = Math.max(1.5f, h / 8f);
            float nub = w * 0.1f;
            paint.setColor(0xffffffff);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(stroke);
            canvas.drawRect(stroke / 2, stroke / 2, w - nub - stroke / 2, h - stroke / 2, paint);
            paint.setStyle(Paint.Style.FILL);
            canvas.drawRect(w - nub, h * 0.3f, w, h * 0.7f, paint);
            paint.setColor(percent <= 20 ? 0xffff4040 : 0xffffffff);
            float inset = stroke * 1.6f;
            canvas.drawRect(inset, inset, inset + (w - nub - 2 * inset) * percent / 100f, h - inset, paint);
        }
    }

    abstract static class Base extends Drawable {
        final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);

        Base(int widthPx, int heightPx) {
            setBounds(0, 0, widthPx, heightPx);
        }

        @Override
        public int getIntrinsicWidth() {
            return getBounds().width();
        }

        @Override
        public int getIntrinsicHeight() {
            return getBounds().height();
        }

        @Override
        public void setAlpha(int alpha) {
            paint.setAlpha(alpha);
        }

        @Override
        public void setColorFilter(ColorFilter filter) {
            paint.setColorFilter(filter);
        }

        @Override
        public int getOpacity() {
            return PixelFormat.TRANSLUCENT;
        }
    }
}
