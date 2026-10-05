package dev.oein.ilceremote;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import android.view.View;

/**
 * Draws the AF areas that came into focus, like the green frames of the camera's own display.
 * Rectangles are in the focus-area coordinate space (assumed -1000..1000 on both axes, as in
 * android.hardware.Camera) and are mapped onto the whole view, which covers the live view.
 */
class FocusFrames extends View {
    private static final int FOCUSED = 0xff3ecf6e;
    private static final int WARNING = 0xffff9a2e;

    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private Rect[] rects = new Rect[0];

    FocusFrames(Context context) {
        super(context);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(3);
    }

    /** {@code warn}: focus could not be confirmed (orange instead of green). Empty clears. */
    void show(Rect[] focused, boolean warn) {
        rects = focused == null ? new Rect[0] : focused;
        paint.setColor(warn ? WARNING : FOCUSED);
        invalidate();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        float w = getWidth();
        float h = getHeight();
        for (Rect r : rects) {
            canvas.drawRect(
                    (r.left + 1000) / 2000f * w, (r.top + 1000) / 2000f * h,
                    (r.right + 1000) / 2000f * w, (r.bottom + 1000) / 2000f * h, paint);
        }
    }
}
