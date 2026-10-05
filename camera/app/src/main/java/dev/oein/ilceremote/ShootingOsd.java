package dev.oein.ilceremote;

import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.Locale;

/**
 * The shooting display over live view, laid out like the camera's own: mode badge, network,
 * shots left and battery on top; shutter, aperture, exposure compensation and ISO at the bottom,
 * with the value the control wheel changes shown in yellow. UI thread only.
 */
class ShootingOsd {
    private static final int ACTIVE = 0xffffd400;

    private final Context context;
    private final LinearLayout top;
    private final LinearLayout bottom;

    private final TextView mode;
    private final ImageView modeIcon;
    private final ImageView driveIcon;
    private final TextView focusMode;
    private final ImageView focusIcon;
    private String shownFocus;
    private final TextView network;
    private final TextView shots;
    private final OsdIcons.Battery batteryIcon;
    private final ImageView battery;
    private final TextView batteryText;

    private final TextView shutter;
    private final TextView aperture;
    private final TextView ev;
    private final TextView isoLabel;
    private final ImageView isoIcon;
    private final TextView iso;
    private final LinearLayout manualFocus;
    private final ZoomBar focusBar;
    private final LinearLayout zoom;
    private final ZoomBar zoomBar;
    private final TextView zoomText;
    private String shownSceneMode;
    private String shownDrive;

    ShootingOsd(Context context) {
        this.context = context;

        top = row(Gravity.CENTER_VERTICAL);
        mode = text(16, true);
        GradientDrawable box = new GradientDrawable();
        box.setStroke(dp(2), Color.WHITE);
        box.setColor(0x66000000);
        mode.setBackgroundDrawable(box);
        mode.setPadding(dp(6), 0, dp(6), 0);
        modeIcon = new ImageView(context);
        driveIcon = new ImageView(context);
        focusMode = text(15, true);
        focusMode.setPadding(dp(8), 0, 0, 0);
        focusIcon = new ImageView(context);
        focusIcon.setPadding(dp(8), 0, 0, 0);
        // Its own lines under the top row: the AP's SSID and password must be readable in full
        network = text(12, false);
        network.setMaxLines(2);
        network.setPadding(dp(10), 0, dp(10), dp(4));
        shots = text(15, true);
        batteryIcon = new OsdIcons.Battery((int) (dp(26) * SonyIcons.X_SCALE), dp(13));
        battery = new ImageView(context);
        battery.setImageDrawable(batteryIcon);
        batteryText = text(13, true);
        top.addView(modeIcon);
        top.addView(mode);
        top.addView(spacer(8));
        top.addView(driveIcon);
        top.addView(focusIcon);
        top.addView(focusMode);
        top.addView(new View(context), new LinearLayout.LayoutParams(0, 1, 1));
        top.addView(shots);
        top.addView(spacer(12));
        top.addView(battery);
        top.addView(spacer(4));
        top.addView(batteryText);

        zoom = row(Gravity.CENTER);
        zoom.setVisibility(View.GONE);
        zoomBar = new ZoomBar(context);
        zoom.addView(text(16, true));
        ((TextView) zoom.getChildAt(0)).setText("W");
        zoom.addView(zoomBar, new LinearLayout.LayoutParams(dp(180), dp(14)));
        TextView tele = text(16, true);
        tele.setText("T");
        zoom.addView(tele);
        zoom.addView(spacer(12));
        zoomText = text(16, true);
        zoom.addView(zoomText);

        manualFocus = row(Gravity.CENTER);
        manualFocus.setVisibility(View.GONE);
        focusBar = new ZoomBar(context);
        TextView near = text(14, true);
        near.setText("NEAR");
        TextView far = text(14, true);
        far.setText("FAR");
        manualFocus.addView(near);
        manualFocus.addView(focusBar, new LinearLayout.LayoutParams(dp(180), dp(14)));
        manualFocus.addView(far);

        bottom = row(Gravity.CENTER);
        shutter = text(24, true);
        aperture = text(24, true);
        ev = text(24, true);
        Drawable evIcon = SonyIcons.get("s_16_dd_parts_osd_icon_ev");
        if (evIcon != null) {
            evIcon.setBounds(0, 0, evIcon.getIntrinsicWidth(), evIcon.getIntrinsicHeight());
        } else {
            evIcon = new OsdIcons.ExposureCompensation((int) (dp(20) * SonyIcons.X_SCALE), dp(20));
        }
        ev.setCompoundDrawables(evIcon, null, null, null);
        ev.setCompoundDrawablePadding(dp(6));
        isoLabel = text(15, true);
        isoIcon = new ImageView(context);
        Drawable sonyIso = SonyIcons.get("s_16_dd_parts_osd_icon_iso");
        isoIcon.setImageDrawable(sonyIso);
        isoIcon.setVisibility(sonyIso == null ? View.GONE : View.VISIBLE);
        iso = text(24, true);
        bottom.addView(shutter);
        bottom.addView(spacer(26));
        bottom.addView(aperture);
        bottom.addView(spacer(26));
        bottom.addView(ev);
        bottom.addView(spacer(26));
        bottom.addView(isoIcon);
        bottom.addView(isoLabel);
        bottom.addView(spacer(5));
        bottom.addView(iso);
    }

    /** Zoom indicator ("W ---o--- T  x1.8"), centred above the bottom row; hidden until zooming. */
    View getZoom() {
        return zoom;
    }

    /** {@code fraction} 0 (wide) .. 1 (tele); {@code magnification} e.g. 1.8. */
    void showZoom(float fraction, float magnification) {
        zoomBar.setFraction(fraction);
        zoomText.setText(String.format(Locale.US, "x%.1f", magnification));
        zoom.setVisibility(View.VISIBLE);
    }

    void hideZoom() {
        zoom.setVisibility(View.GONE);
    }

    /** Focus distance bar, shown while in manual focus. */
    View getManualFocus() {
        return manualFocus;
    }

    void setFocusPosition(int current, int max) {
        if (max > 0) {
            focusBar.setFraction((float) current / max);
        }
    }

    /** The top row with the network lines under it. */
    View getTop() {
        if (header == null) {
            header = new LinearLayout(context);
            header.setOrientation(LinearLayout.VERTICAL);
            header.addView(top);
            header.addView(network);
        }
        return header;
    }

    private LinearLayout header;

    View getBottom() {
        return bottom;
    }

    void setNetwork(String text) {
        network.setText(text);
    }

    void setShotsLeft(int count) {
        shots.setVisibility(count >= 0 ? View.VISIBLE : View.GONE);
        shots.setText(String.valueOf(count));
    }

    void setBattery(int percent) {
        int visibility = percent >= 0 ? View.VISIBLE : View.GONE;
        battery.setVisibility(visibility);
        batteryText.setVisibility(visibility);
        batteryIcon.setPercent(percent);
        batteryText.setText(percent + "%");
    }

    /** {@code active}: which setting the control wheel changes ("shutter", "aperture", "iso", "ev", "drive" or null). */
    void setState(JSONObject state, String active) {
        String sceneMode = state.optString("sceneMode");
        if (!sceneMode.equals(shownSceneMode)) {
            shownSceneMode = sceneMode;
            Drawable icon = SonyIcons.forSceneMode(sceneMode);
            modeIcon.setImageDrawable(icon);
            modeIcon.setVisibility(icon == null ? View.GONE : View.VISIBLE);
            mode.setVisibility(icon == null ? View.VISIBLE : View.GONE);
            mode.setText(modeLabel(state.optString("mode"), sceneMode));
        }
        String focus = state.optString("focusMode");
        boolean manual = "manual".equals(focus);
        String afMode = state.optString("afMode", "af-s");
        String focusKey = focus + "/" + afMode;
        if (!focusKey.equals(shownFocus)) {
            shownFocus = focusKey;
            // The camera's own AF-S / AF-C / DMF / MF icon; text if this firmware lacks it
            Drawable icon = SonyIcons.forFocusMode(focus, afMode);
            focusIcon.setImageDrawable(icon);
            focusIcon.setVisibility(icon == null ? View.GONE : View.VISIBLE);
            focusMode.setVisibility(icon == null ? View.VISIBLE : View.GONE);
            focusMode.setText(manual ? "MF" : "dmf".equals(focus) ? "DMF" : afMode.toUpperCase(Locale.US));
        }
        manualFocus.setVisibility(manual ? View.VISIBLE : View.GONE);
        String drive = state.optString("driveMode") + "/" + state.optInt("selfTimer");
        if (!drive.equals(shownDrive)) {
            shownDrive = drive;
            Drawable icon = SonyIcons.forDrive(state.optString("driveMode"), state.optInt("selfTimer"));
            driveIcon.setImageDrawable(icon);
            driveIcon.setVisibility(icon == null ? View.GONE : View.VISIBLE);
        }

        show(shutter, state.optString("shutterText", null), "shutter".equals(active));
        double f = state.optDouble("aperture", 0);
        show(aperture, f > 0 ? "F" + trim(f) : null, "aperture".equals(active));
        if (state.has("ev")) {
            double value = state.optInt("ev") * state.optDouble("evStep", 1.0 / 3);
            String sign = value > 0.05 ? "+" : value < -0.05 ? "-" : "±";
            show(ev, sign + String.format(Locale.US, "%.1f", Math.abs(value)), "ev".equals(active));
        } else {
            show(ev, null, false);
        }
        if (state.has("iso")) {
            int value = state.optInt("iso");
            show(iso, value == 0 ? "AUTO" : String.valueOf(value), "iso".equals(active));
            show(isoLabel, isoIcon.getDrawable() == null ? "ISO" : null, "iso".equals(active));
        } else {
            show(iso, null, false);
            show(isoLabel, null, false);
        }
    }

    private static void show(TextView view, String text, boolean active) {
        view.setVisibility(text == null ? View.GONE : View.VISIBLE);
        view.setText(text == null ? "" : text);
        view.setTextColor(active ? ACTIVE : Color.WHITE);
    }

    private static String modeLabel(String mode, String sceneMode) {
        if ("manual".equals(mode)) {
            return "M";
        }
        if ("aperture".equals(mode)) {
            return "A";
        }
        if ("shutter".equals(mode)) {
            return "S";
        }
        if ("program".equals(mode)) {
            return "P";
        }
        if ("auto".equals(mode)) {
            return "AUTO";
        }
        return CameraSettings.sceneModeName(sceneMode).toUpperCase(Locale.US);
    }

    private static String trim(double value) {
        return value == Math.floor(value) ? String.valueOf((int) value) : String.valueOf(value);
    }

    /** Track with a knob at the current zoom position. */
    private static class ZoomBar extends View {
        private final android.graphics.Paint paint = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
        private float fraction;

        ZoomBar(Context context) {
            super(context);
        }

        void setFraction(float value) {
            fraction = Math.max(0f, Math.min(1f, value));
            invalidate();
        }

        @Override
        protected void onDraw(android.graphics.Canvas canvas) {
            float w = getWidth();
            float h = getHeight();
            float pad = 8;
            paint.setColor(0xc0ffffff);
            canvas.drawRect(pad, h / 2 - 1.5f, w - pad, h / 2 + 1.5f, paint);
            float x = pad + (w - 2 * pad) * fraction;
            paint.setColor(0xffff9a2e);
            // Knob drawn narrow: the LCD stretches it back to square
            canvas.drawRect(x - 3, 1, x + 3, h - 1, paint);
        }
    }

    private LinearLayout row(int gravity) {
        LinearLayout row = new LinearLayout(context);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(gravity);
        row.setPadding(dp(10), dp(6), dp(10), dp(6));
        return row;
    }

    private TextView text(int sizeSp, boolean bold) {
        TextView view = new TextView(context);
        view.setTextSize(sizeSp);
        view.setTextColor(Color.WHITE);
        // The LCD stretches the 640x480 frame buffer to 16:9; narrow text so it looks like the camera's own
        view.setTextScaleX(SonyIcons.X_SCALE);
        view.setTypeface(bold ? SonyFonts.osd() : SonyFonts.ui());
        // A tight, dark glow reads like the outlined digits of the camera's own display
        view.setShadowLayer(dp(2), 0, 0, Color.BLACK);
        return view;
    }

    private View spacer(int widthDp) {
        View view = new View(context);
        view.setLayoutParams(new LinearLayout.LayoutParams(dp(widthDp), 1));
        return view;
    }

    private int dp(int value) {
        return (int) (value * context.getResources().getDisplayMetrics().density + 0.5f);
    }
}
