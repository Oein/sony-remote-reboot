package dev.oein.ilceremote;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.graphics.drawable.Drawable;
import android.net.wifi.WifiManager;
import android.os.BatteryManager;
import android.os.Bundle;
import android.os.Handler;
import android.view.Gravity;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.widget.FrameLayout;

import com.sony.scalar.hardware.CameraEx;
import com.sony.scalar.sysutil.ScalarInput;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The shooting screen. While the app runs it replaces the camera's own UI: live view with shooting
 * info, control wheel / buttons for exposure, a MENU, and the HTTP server for the phone.
 */
public class MainActivity extends BaseActivity implements NetworkMode.Listener {
    private static final String PREF_MODE = "networkMode";
    private static final String PREF_ZOOM_SPEED = "zoomSpeed";
    private static final String PREF_PREVIEW_EFFECT = "previewEffect";
    private static final String PREF_LAST_SETTINGS = "lastSettings";
    private static final int MODE_STATION = 0;
    private static final int MODE_ACCESS_POINT = 1;
    private static final long SERVER_START_TIMEOUT_MS = 5000;
    /** Reading Camera.Parameters costs tens of ms on the UI thread, so poll gently; turning the wheel refreshes at once. */
    private static final long OSD_REFRESH_MS = 1000;
    private static final long SHOTS_REFRESH_MS = 5000;

    private WifiManager wifiManager;
    private WifiManager.WifiLock wifiLock;

    /**
     * WIFI_MODE_FULL_HIGH_PERF (API 12): keeps the radio out of power save, which otherwise adds
     * up to a second of latency per packet (ping 30-950 ms) and makes the phone connection flap.
     */
    private static final int WIFI_MODE_FULL_HIGH_PERF = 3;

    private void holdWifi() {
        if (wifiLock != null) {
            return;
        }
        try {
            wifiLock = wifiManager.createWifiLock(WIFI_MODE_FULL_HIGH_PERF, "ilce-remote");
            wifiLock.acquire();
            Logger.info("Wi-Fi lock: high performance");
        } catch (RuntimeException e) {
            // Android 2.3 may only know WIFI_MODE_FULL
            try {
                wifiLock = wifiManager.createWifiLock(WifiManager.WIFI_MODE_FULL, "ilce-remote");
                wifiLock.acquire();
                Logger.info("Wi-Fi lock: full (" + e + ")");
            } catch (RuntimeException again) {
                // Never worth crashing over: the connection just stays slower
                wifiLock = null;
                Logger.error("Wi-Fi lock unavailable", again);
            }
        }
    }

    private void releaseWifi() {
        if (wifiLock != null) {
            if (wifiLock.isHeld()) {
                wifiLock.release();
            }
            wifiLock = null;
        }
    }
    private SharedPreferences prefs;
    private ApiServer server;
    private final LiveView liveView = new LiveView();
    private final ShootingControls controls = new ShootingControls(liveView);
    private CameraMenu menu;
    private OptionPicker picker;
    private PhotoLibrary photos;
    private final OrientationWatcher orientation = new OrientationWatcher();
    private SurfaceHolder surfaceHolder;
    private final Handler handler = new Handler();
    /** Wi-Fi and server start/stop can block, so they run here, in order, off the UI thread. */
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    private ShootingOsd osd;
    private FocusFrames focusFrames;
    private MagnifierView magnifierView;

    private NetworkMode[] modes;
    private int modeIndex;
    private NetworkMode activeMode;
    private String networkAddress = "";
    private String networkDetails = "";
    private String networkStatus = "";
    private String serverStatus = "";

    private JSONObject state = new JSONObject();
    private int batteryPercent = -1;
    private int shotsLeft = -1;
    private long shotsReadAt;

    /** Set while the camera's Wi-Fi settings screen is open; Wi-Fi (and adb) must stay on. */
    private boolean openingSubscreen;
    /** Set when exiting via /api/debug/exit, so adb over Wi-Fi survives for the next install. */
    private boolean keepWifiOnExit;

    private final Runnable serverStartTimeout = new Runnable() {
        @Override
        public void run() {
            Logger.info("HTTP server did not start within " + SERVER_START_TIMEOUT_MS + " ms");
            serverStatus = "HTTP not responding";
            render();
        }
    };

    private final Runnable osdRefresh = new Runnable() {
        @Override
        public void run() {
            // While the menu is open, only its own changes refresh the state, keeping the wheel snappy
            if (!menu.isOpen() && !picker.isOpen()) {
                refreshState();
                render();
            }
            handler.postDelayed(this, OSD_REFRESH_MS);
        }
    };

    private final BroadcastReceiver batteryReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            int level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
            batteryPercent = level < 0 || scale <= 0 ? -1 : level * 100 / scale;
            CameraStatus.batteryPercent = batteryPercent;
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Logger.info("onCreate");
        buildViews();
        controls.setPositionDisplay(new ShootingControls.PositionDisplay() {
            @Override
            public void onZoom(final CameraEx.ZoomInfo info) {
                handler.post(new Runnable() {
                    @Override
                    public void run() {
                        showZoom(info);
                    }
                });
            }

            @Override
            public void onMagnifier(final boolean on, final float factor, final int x, final int y) {
                handler.post(new Runnable() {
                    @Override
                    public void run() {
                        magnifierView.show(on, factor, x, y);
                    }
                });
            }

            @Override
            public void onAutoFocus(final int status, final android.graphics.Rect[] focused) {
                handler.post(new Runnable() {
                    @Override
                    public void run() {
                        boolean locked = status == CameraEx.AutoFocusDoneListener.STATUS_LOCK
                                || status == CameraEx.AutoFocusDoneListener.STATUS_LOCK_WARN;
                        focusFrames.show(locked ? focused : null,
                                status == CameraEx.AutoFocusDoneListener.STATUS_LOCK_WARN);
                    }
                });
            }

            @Override
            public void onFocusPosition(final int current, final int max) {
                handler.post(new Runnable() {
                    @Override
                    public void run() {
                        osd.setFocusPosition(current, max);
                    }
                });
            }
        });

        wifiManager = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        prefs = getPreferences(MODE_PRIVATE);
        modes = new NetworkMode[] { new StationMode(this), new AccessPointMode(this) };
        modeIndex = prefs.getInt(PREF_MODE, MODE_STATION) == MODE_ACCESS_POINT ? MODE_ACCESS_POINT : MODE_STATION;
        controls.setLeverZoomSpeed(prefs.getInt(PREF_ZOOM_SPEED, controls.getLeverZoomSpeed()));
        liveView.setPreviewEffect(prefs.getBoolean(PREF_PREVIEW_EFFECT, true));
        photos = new PhotoLibrary(this);
        cameraControl = new CameraControl(liveView, controls);
        server = new ApiServer(liveView, photos, cameraControl, BuildConfig.DEBUG ? new Runnable() {
            @Override
            public void run() {
                handler.post(new Runnable() {
                    @Override
                    public void run() {
                        Logger.info("Debug exit requested");
                        keepWifiOnExit = true;
                        exitApp();
                    }
                });
            }
        } : null);
        server.setWebAssets(getAssets());
        if (BuildConfig.DEBUG) {
            server.setScreenCapture(new ApiServer.ScreenCapture() {
                @Override
                public byte[] capture(final byte[] liveViewJpeg) throws Exception {
                    final byte[][] png = new byte[1][];
                    final java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(1);
                    handler.post(new Runnable() {
                        @Override
                        public void run() {
                            try {
                                png[0] = captureScreen(liveViewJpeg);
                            } finally {
                                done.countDown();
                            }
                        }
                    });
                    done.await(5, java.util.concurrent.TimeUnit.SECONDS);
                    return png[0];
                }
            });
        }
        buildMenu();
    }

    /**
     * Debug screenshot: the live view frame, our views on top, then stretched to 16:9 like the LCD.
     * (The live view is a hardware video layer, so drawing the views alone would leave it black.)
     */
    private byte[] captureScreen(byte[] liveViewJpeg) {
        View root = getWindow().getDecorView();
        int w = root.getWidth();
        int h = root.getHeight();
        android.graphics.Bitmap screen = android.graphics.Bitmap.createBitmap(w, h, android.graphics.Bitmap.Config.ARGB_8888);
        android.graphics.Canvas canvas = new android.graphics.Canvas(screen);
        canvas.drawColor(0xff000000);
        if (liveViewJpeg != null) {
            android.graphics.Bitmap frame = android.graphics.BitmapFactory.decodeByteArray(liveViewJpeg, 0, liveViewJpeg.length);
            if (frame != null) {
                canvas.drawBitmap(frame, null, new android.graphics.Rect(0, 0, w, h), null);
                frame.recycle();
            }
        }
        root.draw(canvas);
        android.graphics.Bitmap lcd = android.graphics.Bitmap.createScaledBitmap(screen, h * 16 / 9, h, true);
        screen.recycle();
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        lcd.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, out);
        lcd.recycle();
        return out.toByteArray();
    }

    private void buildViews() {
        SurfaceView surfaceView = new SurfaceView(this);
        surfaceHolder = surfaceView.getHolder();
        surfaceHolder.setType(SurfaceHolder.SURFACE_TYPE_PUSH_BUFFERS);

        osd = new ShootingOsd(this);
        menu = new CameraMenu(this);
        picker = new OptionPicker(this);

        FrameLayout layout = new FrameLayout(this);
        layout.addView(surfaceView);
        focusFrames = new FocusFrames(this);
        layout.addView(focusFrames);
        magnifierView = new MagnifierView(this);
        layout.addView(magnifierView);
        layout.addView(osd.getTop(), new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.FILL_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP));
        layout.addView(osd.getBottom(), new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.FILL_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM));
        FrameLayout.LayoutParams zoomParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.FILL_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM);
        zoomParams.bottomMargin = 56;
        layout.addView(osd.getZoom(), zoomParams);
        FrameLayout.LayoutParams focusParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.FILL_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM);
        focusParams.bottomMargin = 92;
        layout.addView(osd.getManualFocus(), focusParams);
        layout.addView(menu.getView(), new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        layout.addView(picker.getView(), new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.FILL_PARENT, FrameLayout.LayoutParams.FILL_PARENT));
        setContentView(layout);
    }

    @Override
    protected void onResume() {
        super.onResume();
        Logger.info("onResume, mode=" + modes[modeIndex].getName());
        openingSubscreen = false;
        setAutoPowerOffEnabled(false);
        registerReceiver(batteryReceiver, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        liveView.start(surfaceHolder);
        orientation.start(this);
        startServer();
        startMode();
        handler.post(osdRefresh);
    }

    @Override
    protected void onPause() {
        super.onPause();
        Logger.info("onPause, openingSubscreen=" + openingSubscreen + ", keepWifiOnExit=" + keepWifiOnExit);
        handler.removeCallbacks(osdRefresh);
        handler.removeCallbacks(serverStartTimeout);
        controls.stopZoom();
        controls.magnifier().stop();
        unregisterReceiver(batteryReceiver);
        menu.close();
        picker.close();
        orientation.stop();
        liveView.stop();
        if (openingSubscreen) {
            // Wi-Fi settings: stay reachable from the phone meanwhile
            return;
        }
        stopMode();
        final boolean keepWifi = keepWifiOnExit;
        worker.execute(new Runnable() {
            @Override
            public void run() {
                server.stop();
                serverRunning = false;
                releaseWifi();
                Logger.info("HTTP server stopped");
                if (!keepWifi) {
                    wifiManager.setWifiEnabled(false);
                    Logger.info("Wi-Fi disabled");
                }
            }
        });
        setAutoPowerOffEnabled(true);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        worker.shutdown();
    }

    /** Set on the worker thread once the HTTP server is listening; it stays up while subscreens are open. */
    private volatile boolean serverRunning;

    private void startServer() {
        if (serverRunning) {
            return;
        }
        serverStatus = "";
        handler.postDelayed(serverStartTimeout, SERVER_START_TIMEOUT_MS);
        worker.execute(new Runnable() {
            @Override
            public void run() {
                Logger.info("Enabling Wi-Fi");
                wifiManager.setWifiEnabled(true);
                holdWifi();
                Logger.info("Starting HTTP server");
                String result;
                try {
                    server.start();
                    serverRunning = true;
                    result = "";
                    Logger.info("HTTP server started");
                } catch (IOException e) {
                    Logger.error("HTTP server failed", e);
                    result = "HTTP failed: " + e.getMessage();
                }
                final String status = result;
                handler.post(new Runnable() {
                    @Override
                    public void run() {
                        handler.removeCallbacks(serverStartTimeout);
                        serverStatus = status;
                        render();
                    }
                });
            }
        });
    }

    // --- buttons ------------------------------------------------------------------------------

    @Override
    protected boolean onCameraKeyDown(int scanCode, int repeatCount) {
        if (ShootingControls.isZoomKey(scanCode)) {
            controls.onZoomKey(scanCode);
            return true;
        }
        if (!ShootingControls.isDialKey(scanCode)) {
            return false;
        }
        int direction = ShootingControls.dialDirection(scanCode);
        if (picker.isOpen()) {
            picker.onDial(direction);
            return true;
        }
        if (menu.isOpen()) {
            menu.onDial(direction);
            return true;
        } else {
            controls.onDial(direction);
            // Show the new value quickly instead of waiting for the next periodic refresh
            handler.removeCallbacks(osdRefresh);
            handler.postDelayed(osdRefresh, 150);
        }
        render();
        return true;
    }

    @Override
    protected boolean onCameraKeyUp(int scanCode) {
        if (ShootingControls.isDialKey(scanCode) || ShootingControls.isZoomKey(scanCode)) {
            return true;
        }
        if (picker.isOpen()) {
            picker.onKey(scanCode);
            return true;
        }
        if (menu.isOpen()) {
            menu.onKey(scanCode);
            return true;
        }
        if (onMagnifierKey(scanCode)) {
            return true;
        }
        switch (scanCode) {
            case ScalarInput.ISV_KEY_MENU:
            case ScalarInput.ISV_KEY_SK1:
                buildMenu();
                menu.open();
                return true;
            case ScalarInput.ISV_KEY_LEFT:
                openDrivePicker();
                return true;
            case ScalarInput.ISV_KEY_ENTER:
                openModePicker();
                return true;
            case ScalarInput.ISV_KEY_PLAY:
                // Photos are browsed on the phone, so Play is the focus magnifier here
                controls.magnifier().cycle();
                return true;
            case ScalarInput.ISV_KEY_STASTOP:
                // Movie button: the app doesn't record video, so it toggles AF / MF instead
                controls.toggleManualFocus();
                refreshState();
                render();
                return true;
            default:
                if (controls.onKey(scanCode)) {
                    render();
                    return true;
                }
                return false;
        }
    }

    /** While magnified: arrows move the window, Enter centers it, Play steps up / turns it off. */
    private boolean onMagnifierKey(int scanCode) {
        FocusMagnifier magnifier = controls.magnifier();
        if (!magnifier.isOn()) {
            return false;
        }
        switch (scanCode) {
            case ScalarInput.ISV_KEY_UP:
                magnifier.pan(0, -1);
                return true;
            case ScalarInput.ISV_KEY_DOWN:
                magnifier.pan(0, 1);
                return true;
            case ScalarInput.ISV_KEY_LEFT:
                magnifier.pan(-1, 0);
                return true;
            case ScalarInput.ISV_KEY_RIGHT:
                magnifier.pan(1, 0);
                return true;
            case ScalarInput.ISV_KEY_ENTER:
                magnifier.center();
                return true;
            case ScalarInput.ISV_KEY_MENU:
            case ScalarInput.ISV_KEY_SK1:
                magnifier.stop();
                return false; // and open the menu as usual
            default:
                return false;
        }
    }

    // --- pickers -------------------------------------------------------------------------------

    private void openDrivePicker() {
        JSONArray drives = state.optJSONArray("driveModeValues");
        JSONArray timers = state.optJSONArray("selfTimerValues");
        List<OptionPicker.Option> options = new ArrayList<OptionPicker.Option>();
        addDrive(options, drives, "single", 0, "\ub2e8\uc77c \ucd2c\uc601");
        addDrive(options, drives, "burst", 0, "\uc5f0\uc18d \ucd2c\uc601");
        addDrive(options, drives, "speed-prior-burst", 0, "\uc18d\ub3c4 \uc6b0\uc120 \uc5f0\uc18d \ucd2c\uc601");
        if (contains(timers, 10)) {
            addDrive(options, drives, "single", 10, "\uc140\ud504 \ud0c0\uc774\uba38: 10\ucd08");
        }
        if (contains(timers, 2)) {
            addDrive(options, drives, "single", 2, "\uc140\ud504 \ud0c0\uc774\uba38: 2\ucd08");
        }
        int timer = state.optInt("selfTimer");
        String current = timer > 0 ? "single/" + timer : state.optString("driveMode") + "/0";
        picker.open("\ub4dc\ub77c\uc774\ube0c \ubaa8\ub4dc", options, current, new OptionPicker.Listener() {
            @Override
            public void onPicked(OptionPicker.Option option) {
                String[] parts = option.key.split("/");
                applySettings(new JSONObjectBuilder()
                        .put("driveMode", parts[0])
                        .put("selfTimer", Integer.parseInt(parts[1])).build());
            }
        });
    }

    private static void addDrive(List<OptionPicker.Option> options, JSONArray supported, String drive, int timer, String name) {
        if (!contains(supported, drive)) {
            return;
        }
        String icon = "s_16_dd_parts_specialscreen_icon_drivemode_" + SonyIcons.driveIconName(drive, timer, false) + "_normal";
        options.add(new OptionPicker.Option(drive + "/" + timer, name, SonyIcons.get(icon)));
    }

    private void openModePicker() {
        JSONArray modes = CameraSettings.orderedSceneModes(state.optJSONArray("sceneModeValues"));
        List<OptionPicker.Option> options = new ArrayList<OptionPicker.Option>();
        for (int i = 0; i < modes.length(); i++) {
            String mode = modes.optString(i);
            String scene = SonyIcons.sceneSelectionName(mode);
            Drawable icon = scene != null
                    ? SonyIcons.get("s_16_dd_parts_sceneselection_icon_" + scene + "_normal")
                    : SonyIcons.forSceneMode(mode);
            options.add(new OptionPicker.Option(mode, CameraSettings.sceneModeName(mode), icon));
        }
        picker.open("\ucd2c\uc601 \ubaa8\ub4dc", options, state.optString("sceneMode"), new OptionPicker.Listener() {
            @Override
            public void onPicked(OptionPicker.Option option) {
                applySettings(new JSONObjectBuilder().put("sceneMode", option.key).build());
            }
        });
    }

    // --- zoom indicator ---------------------------------------------------------------------------

    /** Highest optical magnification seen, x100; the 16-50 PZ kit lens reaches about 3.1x. */
    private int maxOpticalMagnification = 313;
    private int zoomLogCount;

    private final Runnable hideZoom = new Runnable() {
        @Override
        public void run() {
            osd.hideZoom();
        }
    };

    private void showZoom(CameraEx.ZoomInfo info) {
        if (BuildConfig.DEBUG && zoomLogCount++ < 20) {
            Logger.info("zoom optical pos=" + info.opticalPosition + " mag=" + info.opticalMagnification
                    + " digital pos=" + info.digitalPosition + " mag=" + info.digitalMagnification
                    + " type=" + info.digitalZoomType + " stopped=" + info.stopped);
        }
        maxOpticalMagnification = Math.max(maxOpticalMagnification, info.opticalMagnification);
        float fraction = (info.opticalMagnification - 100f) / Math.max(1, maxOpticalMagnification - 100);
        float magnification = info.opticalMagnification / 100f
                * (info.digitalMagnification > 100 ? info.digitalMagnification / 100f : 1f);
        osd.showZoom(fraction, magnification);
        handler.removeCallbacks(hideZoom);
        handler.postDelayed(hideZoom, 2000);
    }

    private void applySettings(JSONObject changes) {
        CameraEx camera = liveView.getCamera();
        if (camera == null) {
            return;
        }
        try {
            CameraSettings.apply(camera, changes);
        } catch (Throwable t) {
            Logger.error("Applying " + changes + " failed", t);
        }
        refreshState();
        render();
    }

    private static boolean contains(JSONArray values, Object value) {
        for (int i = 0; values != null && i < values.length(); i++) {
            if (String.valueOf(values.opt(i)).equals(String.valueOf(value))) {
                return true;
            }
        }
        return false;
    }

    /** JSONObject.put declares JSONException even for plain keys; this keeps call sites tidy. */
    private static final class JSONObjectBuilder {
        private final JSONObject object = new JSONObject();

        JSONObjectBuilder put(String key, Object value) {
            try {
                object.put(key, value);
            } catch (org.json.JSONException e) {
                throw new IllegalArgumentException(e);
            }
            return this;
        }

        JSONObject build() {
            return object;
        }
    }

    private void buildMenu() {
        List<CameraMenu.Item> items = new ArrayList<CameraMenu.Item>();
        items.add(new CameraMenu.Item() {
            @Override
            public String label() {
                return "Shooting mode";
            }

            @Override
            public String value() {
                return CameraSettings.sceneModeName(state.optString("sceneMode"));
            }

            @Override
            public void change(int direction) {
                CameraEx camera = liveView.getCamera();
                if (camera == null) {
                    return;
                }
                try {
                    Object next = ShootingControls.neighbour(
                            CameraSettings.orderedSceneModes(state.optJSONArray("sceneModeValues")),
                            state.optString("sceneMode"), direction);
                    if (next != null) {
                        CameraSettings.apply(camera, new JSONObject().put("sceneMode", next));
                        refreshState();
                        menu.render();
                    }
                } catch (Throwable t) {
                    Logger.error("Menu shooting mode failed", t);
                }
            }

            @Override
            public boolean activate() {
                change(1);
                return false;
            }
        });
        items.add(new ChoiceItem("White balance", "whiteBalance", "whiteBalanceValues"));
        items.add(new ChoiceItem("Drive mode", "driveMode", "driveModeValues"));
        items.add(new CameraMenu.Item() {
            @Override
            public String label() {
                return "Live view effect";
            }

            @Override
            public String value() {
                return liveView.getPreviewEffect() ? "ON" : "OFF";
            }

            @Override
            public void change(int direction) {
                liveView.setPreviewEffect(!liveView.getPreviewEffect());
                // Written now: leaving the app shuts Android down before a background write lands
                //noinspection ApplySharedPref
                prefs.edit().putBoolean(PREF_PREVIEW_EFFECT, liveView.getPreviewEffect()).commit();
            }

            @Override
            public boolean activate() {
                change(1);
                return false;
            }
        });
        items.add(new CameraMenu.Item() {
            @Override
            public String label() {
                return "Zoom speed";
            }

            @Override
            public String value() {
                return controls.getLeverZoomSpeed() + " / 8";
            }

            @Override
            public void change(int direction) {
                controls.setLeverZoomSpeed(controls.getLeverZoomSpeed() + direction);
                // Written now: leaving the app shuts Android down before a background write lands
                //noinspection ApplySharedPref
                prefs.edit().putInt(PREF_ZOOM_SPEED, controls.getLeverZoomSpeed()).commit();
            }

            @Override
            public boolean activate() {
                return false;
            }
        });
        items.add(new CameraMenu.Item() {
            @Override
            public String label() {
                return "Network";
            }

            @Override
            public String value() {
                return modes[modeIndex].getName();
            }

            @Override
            public void change(int direction) {
                switchMode((modeIndex + 1) % modes.length);
            }

            @Override
            public boolean activate() {
                change(1);
                return false;
            }
        });
        items.add(new ActionItem("Wi-Fi settings...") {
            @Override
            public boolean activate() {
                Logger.info("Opening Wi-Fi settings");
                openingSubscreen = true;
                startActivity(new Intent("com.sony.scalar.app.wifisettings.WifiSettings"));
                return true;
            }
        });
        items.add(new ActionItem("Exit app") {
            @Override
            public boolean activate() {
                exitApp();
                return true;
            }
        });
        menu.setItems(items);
    }

    private abstract static class ActionItem implements CameraMenu.Item {
        private final String label;

        ActionItem(String label) {
            this.label = label;
        }

        @Override
        public String label() {
            return label;
        }

        @Override
        public String value() {
            return null;
        }

        @Override
        public void change(int direction) {}
    }

    /** A camera setting chosen from the list the camera reports, shown and changed in the menu. */
    private class ChoiceItem implements CameraMenu.Item {
        private final String label;
        private final String key;
        private final String valuesKey;

        ChoiceItem(String label, String key, String valuesKey) {
            this.label = label;
            this.key = key;
            this.valuesKey = valuesKey;
        }

        @Override
        public String label() {
            return label;
        }

        @Override
        public String value() {
            return state.optString(key);
        }

        @Override
        public void change(int direction) {
            CameraEx camera = liveView.getCamera();
            if (camera == null) {
                return;
            }
            try {
                Object next = ShootingControls.neighbour(state.optJSONArray(valuesKey), state.opt(key), direction);
                if (next != null) {
                    CameraSettings.apply(camera, new JSONObject().put(key, next));
                    refreshState();
                    menu.render();
                }
            } catch (Throwable t) {
                Logger.error("Menu " + label + " failed", t);
            }
        }

        @Override
        public boolean activate() {
            change(1);
            return false;
        }
    }

    // --- network ------------------------------------------------------------------------------

    private void switchMode(int index) {
        stopMode();
        modeIndex = index;
        // Written now: leaving the app shuts Android down before a background write lands
        //noinspection ApplySharedPref
        prefs.edit().putInt(PREF_MODE, index).commit();
        Logger.info("Switched to " + modes[index].getName());
        startMode();
    }

    private void startMode() {
        if (activeMode != null) {
            return; // still running from before a subscreen was opened
        }
        networkAddress = "";
        networkDetails = "";
        networkStatus = "";
        activeMode = modes[modeIndex];
        try {
            activeMode.start(this);
        } catch (RuntimeException e) {
            Logger.error("Failed to start " + activeMode.getName(), e);
            networkStatus = "Failed: " + e;
        }
        render();
    }

    private void stopMode() {
        if (activeMode != null) {
            try {
                activeMode.stop();
            } catch (RuntimeException e) {
                Logger.error("Failed to stop " + activeMode.getName(), e);
            }
            activeMode = null;
        }
    }

    @Override
    public void onStatus(String status) {
        Logger.info("Network: " + status);
        networkStatus = status;
        render();
    }

    @Override
    public void onReady(String ip, String details) {
        Logger.info("Network ready: " + ip + " " + details.replace('\n', ' '));
        networkAddress = ip;
        networkDetails = details.replace("\n", "   ");
        networkStatus = "";
        render();
    }

    // --- on-screen display ----------------------------------------------------------------------

    private void refreshState() {
        CameraEx camera = liveView.getCamera();
        if (camera == null) {
            return;
        }
        controls.listenToCamera(camera);
        try {
            state = CameraSettings.read(camera);
            controls.setState(state);
            if (!settingsRestored) {
                restoreLastSettings();
            } else {
                rememberSettings();
            }
        } catch (Throwable t) {
            Logger.error("Reading camera state failed", t);
        }
        long now = System.currentTimeMillis();
        if (now - shotsReadAt > SHOTS_REFRESH_MS) {
            shotsReadAt = now;
            try {
                shotsLeft = photos.shotsLeft(state.optString("storageFormat"));
            } catch (Throwable t) {
                Logger.error("Shots left failed", t);
                shotsLeft = -1;
            }
            CameraStatus.shotsLeft = shotsLeft;
        }
    }

    // --- last settings ---------------------------------------------------------------------------
    // The camera doesn't keep the app's shooting settings between launches, so the app puts back
    // the ones last used: mode, focus, ISO, EV, white balance, drive, shutter and aperture.

    private CameraControl cameraControl;
    /** Until the saved settings are back, the camera's defaults must not overwrite them. */
    private boolean settingsRestored;
    /** Set on the worker thread once the restore has run (or failed); only then are changes saved. */
    private volatile boolean restoreDone;
    private String rememberedSettings = "";

    private static final String[] REMEMBERED_KEYS = {
            "sceneMode", "focusMode", "iso", "ev", "whiteBalance", "colorTemperature", "wbAB", "wbGM",
            "driveMode", "selfTimer",
    };

    /** The part of {@link #state} worth restoring, in the form CameraControl.apply takes. */
    private JSONObject settingsSnapshot() throws JSONException {
        JSONObject snapshot = new JSONObject();
        for (String key : REMEMBERED_KEYS) {
            if (state.has(key)) {
                snapshot.put(key, state.get(key));
            }
        }
        if (!"color-temp".equals(state.optString("whiteBalance"))) {
            snapshot.remove("colorTemperature");
        }
        // Shutter and aperture only where they are set by hand
        String scene = state.optString("sceneMode");
        boolean manual = CameraEx.ParametersModifier.SCENE_MODE_MANUAL_EXPOSURE.equals(scene);
        if ((manual || CameraEx.ParametersModifier.SCENE_MODE_SHUTTER_PRIORITY.equals(scene)) && state.has("shutterText")) {
            snapshot.put("shutter", state.getString("shutterText"));
        }
        if ((manual || CameraEx.ParametersModifier.SCENE_MODE_APERTURE_PRIORITY.equals(scene)) && state.has("aperture")) {
            snapshot.put("aperture", state.getDouble("aperture"));
        }
        return snapshot;
    }

    private void rememberSettings() throws JSONException {
        if (!restoreDone) {
            return; // the state still shows the camera's defaults
        }
        String snapshot = settingsSnapshot().toString();
        if (!snapshot.equals(rememberedSettings)) {
            rememberedSettings = snapshot;
            SettingsFile.write(snapshot);
        }
    }

    /** Once per launch, as soon as the camera is readable. Stepping shutter/aperture takes a while, so off the UI thread. */
    private void restoreLastSettings() throws JSONException {
        settingsRestored = true;
        String saved = SettingsFile.read();
        if (saved == null) {
            // Earlier versions kept them in the preferences
            saved = prefs.getString(PREF_LAST_SETTINGS, null);
        }
        if (saved == null) {
            restoreDone = true;
            rememberSettings();
            return;
        }
        final JSONObject changes = new JSONObject(saved);
        rememberedSettings = saved;
        Logger.info("Restoring last settings: " + saved);
        worker.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    cameraControl.apply(changes);
                } catch (Exception e) {
                    Logger.error("Restoring last settings failed", e);
                } finally {
                    restoreDone = true;
                }
            }
        });
    }

    private void render() {
        menu.render();
        osd.setNetwork(networkLine());
        osd.setShotsLeft(shotsLeft);
        osd.setBattery(batteryPercent);
        osd.setState(state, controls.activeSetting());
    }

    private String networkLine() {
        StringBuilder text = new StringBuilder(modeIndex == MODE_ACCESS_POINT ? "AP  " : "");
        if (networkAddress.length() > 0) {
            text.append(networkAddress).append(':').append(ApiServer.PORT);
            int viewers = liveView.getClientCount();
            if (viewers > 0) {
                text.append("  LIVE x").append(viewers);
            }
            // SSID / password on a line of their own (see ShootingOsd)
            text.append('\n').append(networkDetails);
        } else {
            text.append(networkStatus.length() > 0 ? networkStatus : "Connecting...");
        }
        if (serverStatus.length() > 0) {
            text.append("  ").append(serverStatus);
        }
        return text.toString();
    }
}
