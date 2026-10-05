package dev.oein.ilceremote;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.view.View;

import java.util.Locale;

/**
 * Focus magnifier indicator: the magnification and a small map of the frame with the visible
 * window, like the camera's own display. Hidden while the magnifier is off.
 */
class MagnifierView extends View {
    private static final float MAP_H = 54;
    /** The frame buffer is stretched to the 16:9 LCD, so widths are drawn narrower. */
    private static final float MAP_W = MAP_H * 16 / 9 * SonyIcons.X_SCALE;
    private static final float MARGIN = 14;
    private static final float ABOVE_BOTTOM_ROW = 74;

    private final Paint frame = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint window = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
    private boolean on;
    private float factor = 1;
    private int x;
    private int y;

    MagnifierView(Context context) {
        super(context);
        frame.setStyle(Paint.Style.STROKE);
        frame.setStrokeWidth(2);
        frame.setColor(0xffffffff);
        window.setColor(0xfff39800);
        text.setColor(0xffffffff);
        text.setTextSize(26);
        text.setTextAlign(Paint.Align.RIGHT);
        text.setTextScaleX(SonyIcons.X_SCALE);
        text.setTypeface(SonyFonts.osd());
        text.setShadowLayer(2, 0, 0, 0xff000000);
    }

    void show(boolean on, float factor, int x, int y) {
        this.on = on;
        this.factor = factor;
        this.x = x;
        this.y = y;
        invalidate();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        if (!on || factor <= 1) {
            return;
        }
        float right = getWidth() - MARGIN;
        float bottom = getHeight() - ABOVE_BOTTOM_ROW;
        float left = right - MAP_W;
        float top = bottom - MAP_H;
        // Visible window: 1/factor of the frame, centered at (x, y) in -1000..1000
        float ww = MAP_W / factor;
        float wh = MAP_H / factor;
        float cx = left + (x + 1000) / 2000f * MAP_W;
        float cy = top + (y + 1000) / 2000f * MAP_H;
        canvas.drawRect(cx - ww / 2, cy - wh / 2, cx + ww / 2, cy + wh / 2, window);
        canvas.drawRect(left, top, right, bottom, frame);
        canvas.drawText(String.format(Locale.US, "×%.1f", factor), right, top - 8, text);
    }
}
