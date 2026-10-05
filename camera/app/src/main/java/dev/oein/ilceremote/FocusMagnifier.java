package dev.oein.ilceremote;

import android.util.Pair;

import com.sony.scalar.hardware.CameraEx;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.List;

/**
 * The camera's focus magnifier: enlarges the live view around a point to check focus, as the
 * Play button does here (the app has no playback). Positions are -1000..1000 from the frame
 * center; at factor f the visible window can move up to 1000 - 1000 / f. UI thread only.
 */
final class FocusMagnifier {
    interface Display {
        void onMagnifier(boolean on, float factor, int x, int y);
    }

    private CameraEx camera;
    private Display display;
    private List<?> levels;
    /** Index into {@link #levels}, or -1 when off. */
    private int level = -1;
    private int x;
    private int y;
    private float factor = 1;

    void setDisplay(Display display) {
        this.display = display;
    }

    void listen(CameraEx camera) {
        this.camera = camera;
        level = -1;
        levels = null;
        camera.setPreviewMagnificationListener(new CameraEx.PreviewMagnificationListener() {
            @Override
            public void onChanged(boolean enabled, int magFactor, int magLevel, Pair coords, CameraEx cameraEx) {
                factor = enabled ? magFactor / 100f : 1;
                if (enabled && coords != null) {
                    x = (Integer) coords.first;
                    y = (Integer) coords.second;
                }
                if (!enabled) {
                    level = -1;
                }
                if (display != null) {
                    display.onMagnifier(enabled, factor, x, y);
                }
            }

            @Override
            public void onInfoUpdated(boolean enabled, Pair coords, CameraEx cameraEx) {
            }
        });
    }

    boolean isOn() {
        return level >= 0;
    }

    /** Off -> each supported magnification in turn -> off. */
    void cycle() {
        if (camera == null) {
            return;
        }
        if (levels == null) {
            levels = camera.createParametersModifier(camera.getNormalCamera().getParameters())
                    .getSupportedPreviewMagnification();
            Logger.info("Magnifier levels " + levels);
        }
        if (levels == null || levels.isEmpty() || level + 1 >= levels.size()) {
            stop();
            return;
        }
        level++;
        apply();
    }

    void stop() {
        if (camera != null && level >= 0) {
            camera.stopPreviewMagnification();
        }
        level = -1;
        x = 0;
        y = 0;
    }

    /** Moves the window by (dx, dy) steps of half its size. */
    void pan(int dx, int dy) {
        int step = (int) (500 / factor);
        moveTo(x + dx * step, y + dy * step);
    }

    void moveTo(int newX, int newY) {
        if (!isOn()) {
            return;
        }
        int max = Math.max(0, 1000 - (int) (1000 / factor));
        x = Math.max(-max, Math.min(max, newX));
        y = Math.max(-max, Math.min(max, newY));
        apply();
    }

    /** Moves the window by a fraction of the (magnified) frame, e.g. toward a tapped point. */
    void panByFraction(double fx, double fy) {
        moveTo(x + (int) (fx * 2000 / factor), y + (int) (fy * 2000 / factor));
    }

    void center() {
        moveTo(0, 0);
    }

    private void apply() {
        camera.setPreviewMagnification((Integer) levels.get(level), new Pair<Integer, Integer>(x, y));
    }

    JSONObject state() throws JSONException {
        return new JSONObject().put("on", isOn()).put("factor", factor).put("x", x).put("y", y);
    }
}
