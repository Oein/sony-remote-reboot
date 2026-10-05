package dev.oein.ilceremote;

import android.hardware.Camera;
import android.util.Pair;

import com.sony.scalar.hardware.CameraEx;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Remote shooting: read/change exposure settings and fire the shutter.
 *
 * Settings go through Sony's CameraEx.ParametersModifier on top of the standard Camera.Parameters.
 * Shutter speed and aperture can only be stepped (increment/decrement), and a step is applied
 * asynchronously: a second step sent before the first one's change callback is dropped. So steps
 * are sent one at a time, each waiting until the ShutterSpeedChange/ApertureChange listener reports
 * a new value. Camera.Parameters lag behind those callbacks, so after stepping we wait for them to
 * catch up before reading the state that is returned.
 * Every getter is wrapped so one setting this firmware lacks doesn't break the whole state.
 */
public class CameraControl {
    private static final long CALL_TIMEOUT_MS = 3000;
    private static final long SHUTTER_TIMEOUT_MS = 30000;
    private static final long FOCUS_TIMEOUT_MS = 4000;
    /** No change callback within this time means we hit the end of the range (or the mode forbids it). */
    private static final long STEP_TIMEOUT_MS = 700;
    private static final long SETTLE_TIMEOUT_MS = 1000;
    private static final int MAX_STEPS = 40;

    private final LiveView camera;
    private final ShootingControls controls;
    /** One shutter release at a time. */
    private final Object shutterLock = new Object();
    /** Half-press held from the phone: direct shutter is off and focus is locked. UI thread only. */
    private boolean focusHeld;
    /** One settings change at a time, so step callbacks can't be confused between requests. */
    private final Object applyLock = new Object();

    // Latest values reported by the change listeners, and the latch the current step waits on
    private volatile double currentShutterSeconds;
    private volatile double currentAperture;
    private volatile CountDownLatch pendingStep;

    public CameraControl(LiveView camera, ShootingControls controls) {
        this.camera = camera;
        this.controls = controls;
    }

    /**
     * Manual focus drive: "near" / "far" by one step at {@code speed} (0 = fastest). Only works if the
     * lens supports it (state.focusDriveSupported); returns the lens's latest {position, max}.
     */
    public JSONObject focusDrive(final String direction, final int speed) throws Exception {
        camera.call(new LiveView.CameraTask<Void>() {
            @Override
            public Void run(CameraEx cameraEx) {
                int dir;
                if ("near".equals(direction)) {
                    dir = CameraEx.FOCUS_DRIVE_DIRECTION_NEAR;
                } else if ("far".equals(direction)) {
                    dir = CameraEx.FOCUS_DRIVE_DIRECTION_FAR;
                } else {
                    throw new IllegalArgumentException("direction must be near or far");
                }
                controls.listenToCamera(cameraEx);
                CameraEx.ParametersModifier modifier =
                        cameraEx.createParametersModifier(cameraEx.getNormalCamera().getParameters());
                int max = modifier.getMaxFocusDriveSpeed();
                cameraEx.startOneShotFocusDrive(dir, speed <= 0 || speed > max ? Math.max(1, max) : speed);
                return null;
            }
        }, CALL_TIMEOUT_MS);
        int[] position = controls.getFocusPosition();
        return new JSONObject().put("position", position[0]).put("max", position[1]);
    }

    /** Power zoom: direction "tele" / "wide" starts zooming at {@code speed} (0 = fastest), "stop" stops. */
    /** Zooms to {@code target} (0 widest .. 1 longest) of the lens's range. */
    public JSONObject zoomTo(final double target) throws Exception {
        camera.call(new LiveView.CameraTask<Void>() {
            @Override
            public Void run(CameraEx cameraEx) {
                controls.zoomTo(target);
                return null;
            }
        }, CALL_TIMEOUT_MS);
        return new JSONObject().put("target", target);
    }

    public JSONObject zoom(final String direction, final int speed) throws Exception {
        camera.call(new LiveView.CameraTask<Void>() {
            @Override
            public Void run(CameraEx cameraEx) {
                controls.cancelZoomTarget();
                if ("tele".equals(direction)) {
                    controls.startZoom(CameraEx.ZOOM_DIRECTION_TELE, speed);
                } else if ("wide".equals(direction)) {
                    controls.startZoom(CameraEx.ZOOM_DIRECTION_WIDE, speed);
                } else if ("stop".equals(direction)) {
                    controls.stopZoom();
                } else {
                    throw new IllegalArgumentException("direction must be tele, wide or stop");
                }
                return null;
            }
        }, CALL_TIMEOUT_MS);
        return new JSONObject().put("zoom", direction);
    }

    /**
     * Focus magnifier: {@code cycle} (off -> each level -> off), {@code off}, {@code center}, or
     * {@code pan} by (dx, dy) fractions of the magnified frame.
     */
    public JSONObject magnify(final String action, final double dx, final double dy) throws Exception {
        return camera.call(new LiveView.CameraTask<JSONObject>() {
            @Override
            public JSONObject run(CameraEx cameraEx) throws Exception {
                controls.listenToCamera(cameraEx);
                FocusMagnifier magnifier = controls.magnifier();
                if ("cycle".equals(action)) {
                    magnifier.cycle();
                } else if ("off".equals(action)) {
                    magnifier.stop();
                } else if ("center".equals(action)) {
                    magnifier.center();
                } else if ("pan".equals(action)) {
                    magnifier.panByFraction(dx, dy);
                } else {
                    throw new IllegalArgumentException("action must be cycle, off, center or pan");
                }
                return magnifier.state();
            }
        }, CALL_TIMEOUT_MS);
    }

    public JSONObject state() throws Exception {
        JSONObject state = camera.call(new LiveView.CameraTask<JSONObject>() {
            @Override
            public JSONObject run(CameraEx cameraEx) throws Exception {
                controls.listenToCamera(cameraEx);
                return CameraSettings.read(cameraEx)
                        .put("magnifier", controls.magnifier().state())
                        // Optical magnification x100 now and at the long end (100 = widest)
                        .put("zoom", new JSONObject()
                                .put("magnification", controls.getOpticalMagnification())
                                .put("max", controls.maxOpticalMagnification()));
            }
        }, CALL_TIMEOUT_MS);
        state.put("battery", CameraStatus.batteryPercent);
        state.put("shotsLeft", CameraStatus.shotsLeft);
        int[] focus = controls.getFocusPosition();
        state.put("focusPosition", focus[0]);
        state.put("focusMaxPosition", focus[1]);
        state.put("roll", OrientationWatcher.getRoll());
        state.put("orientation", OrientationWatcher.getDegrees());
        state.put("af", afJson());
        return state;
    }

    /** Raw Camera.Parameters, for exploring what this firmware supports. */
    public String rawParameters() throws Exception {
        return camera.call(new LiveView.CameraTask<String>() {
            @Override
            public String run(CameraEx cameraEx) {
                return cameraEx.getNormalCamera().getParameters().flatten().replace(";", "\n");
            }
        }, CALL_TIMEOUT_MS);
    }

    /**
     * Applies the given changes and returns the new state. Keys (all optional):
     *   mode         program | aperture | shutter | manual | auto
     *   iso          0 = auto, else one of isoValues
     *   ev           exposure compensation index (evMin..evMax, in evStep units)
     *   whiteBalance one of whiteBalanceValues
     *   driveMode    one of driveModeValues
     *   shutter      target like "1/250", "1/4", "0.5\"", "2\""
     *   shutterStep  +n = faster, -n = slower
     *   aperture     target f-number like 5.6
     *   apertureStep +n = smaller aperture (higher f-number), -n = wider
     */
    public JSONObject apply(final JSONObject changes) throws Exception {
        synchronized (applyLock) {
            camera.call(new LiveView.CameraTask<Void>() {
                @Override
                public Void run(CameraEx cameraEx) throws Exception {
                    CameraSettings.apply(cameraEx, changes);
                    installChangeListeners(cameraEx);
                    readCurrentExposure(cameraEx);
                    return null;
                }
            }, CALL_TIMEOUT_MS);

            if (changes.has("shutter")) {
                stepShutterTo(parseShutterSpeed(changes.getString("shutter")));
            }
            step(true, changes.optInt("shutterStep", 0));
            if (changes.has("aperture")) {
                stepApertureTo(changes.getDouble("aperture"));
            }
            step(false, changes.optInt("apertureStep", 0));

            Logger.info("Camera settings applied: " + changes);
            return settledState();
        }
    }

    private void installChangeListeners(CameraEx cameraEx) {
        cameraEx.setShutterSpeedChangeListener(new CameraEx.ShutterSpeedChangeListener() {
            @Override
            public void onShutterSpeedChange(CameraEx.ShutterSpeedInfo info, CameraEx cameraEx) {
                if (info.currentShutterSpeed_d != 0) {
                    currentShutterSeconds = (double) info.currentShutterSpeed_n / info.currentShutterSpeed_d;
                }
                stepDone();
            }
        });
        cameraEx.setApertureChangeListener(new CameraEx.ApertureChangeListener() {
            @Override
            public void onApertureChange(CameraEx.ApertureInfo info, CameraEx cameraEx) {
                currentAperture = info.currentAperture / 100.0;
                stepDone();
            }
        });
    }

    private void stepDone() {
        CountDownLatch latch = pendingStep;
        if (latch != null) {
            latch.countDown();
        }
    }

    private void readCurrentExposure(CameraEx cameraEx) {
        CameraEx.ParametersModifier modifier =
                cameraEx.createParametersModifier(cameraEx.getNormalCamera().getParameters());
        Pair<?, ?> speed = modifier.getShutterSpeed();
        currentShutterSeconds = (double) (Integer) speed.first / (Integer) speed.second;
        currentAperture = modifier.getAperture() / 100.0;
    }

    /**
     * One step; false if the camera didn't report a new value in time (end of range, or not
     * adjustable in this mode). Callbacks that repeat the old value are ignored.
     */
    private boolean stepOnce(final boolean shutter, final boolean up) throws Exception {
        final double before = shutter ? currentShutterSeconds : currentAperture;
        long deadline = System.currentTimeMillis() + STEP_TIMEOUT_MS;
        CountDownLatch latch = new CountDownLatch(1);
        pendingStep = latch;
        camera.call(new LiveView.CameraTask<Void>() {
            @Override
            public Void run(CameraEx cameraEx) {
                if (shutter) {
                    if (up) {
                        cameraEx.incrementShutterSpeed();
                    } else {
                        cameraEx.decrementShutterSpeed();
                    }
                } else if (up) {
                    cameraEx.incrementAperture();
                } else {
                    cameraEx.decrementAperture();
                }
                return null;
            }
        }, CALL_TIMEOUT_MS);
        try {
            while (true) {
                long remaining = deadline - System.currentTimeMillis();
                if (remaining <= 0 || !latch.await(remaining, TimeUnit.MILLISECONDS)) {
                    return false;
                }
                if ((shutter ? currentShutterSeconds : currentAperture) != before) {
                    return true;
                }
                latch = new CountDownLatch(1);
                pendingStep = latch;
            }
        } finally {
            pendingStep = null;
        }
    }

    /**
     * Latest AF result: {status: lock|warn|working|clear|continuous|none, areas: [{x, y, w, h}]} with
     * areas as fractions of the frame. Assumes Android's -1000..1000 focus-area coordinates; the raw
     * rectangles are included too while that is unverified on this camera.
     */
    private JSONObject afJson() throws org.json.JSONException {
        JSONObject af = new JSONObject();
        int status = controls.getAfStatus();
        af.put("status", status == CameraEx.AutoFocusDoneListener.STATUS_LOCK ? "lock"
                : status == CameraEx.AutoFocusDoneListener.STATUS_LOCK_WARN ? "warn"
                : status == CameraEx.AutoFocusDoneListener.STATUS_WORKING ? "working"
                : status == CameraEx.AutoFocusDoneListener.STATUS_CONTINUOUS ? "continuous"
                : status == CameraEx.AutoFocusDoneListener.STATUS_CLEAR ? "clear" : "none");
        JSONArray areas = new JSONArray();
        JSONArray raw = new JSONArray();
        for (android.graphics.Rect r : controls.getAfFocused()) {
            areas.put(new JSONObject()
                    .put("x", (r.left + 1000) / 2000.0).put("y", (r.top + 1000) / 2000.0)
                    .put("w", r.width() / 2000.0).put("h", r.height() / 2000.0));
            raw.put(r.flattenToString());
        }
        af.put("areas", areas);
        af.put("raw", raw);
        return af;
    }

    /** State once Camera.Parameters agree with the last values the change listeners reported. */
    private JSONObject settledState() throws Exception {
        long deadline = System.currentTimeMillis() + SETTLE_TIMEOUT_MS;
        while (true) {
            JSONObject state = state();
            double shutter = currentShutterSeconds;
            double aperture = currentAperture;
            JSONArray speed = state.optJSONArray("shutter");
            boolean shutterOk = speed == null || speed.getInt(1) == 0
                    || closeEnough((double) speed.getInt(0) / speed.getInt(1), shutter);
            boolean apertureOk = !state.has("aperture") || closeEnough(state.getDouble("aperture"), aperture);
            if ((shutterOk && apertureOk) || System.currentTimeMillis() > deadline) {
                return state;
            }
            Thread.sleep(50);
        }
    }

    private void step(boolean shutter, int steps) throws Exception {
        for (int i = 0; i < Math.min(Math.abs(steps), MAX_STEPS); i++) {
            if (!stepOnce(shutter, steps > 0)) {
                break;
            }
        }
    }

    /** Steps until the shutter speed reaches (or passes) {@code target} seconds. */
    private void stepShutterTo(double target) throws Exception {
        for (int i = 0; i < MAX_STEPS && !closeEnough(currentShutterSeconds, target); i++) {
            // increment = faster = shorter exposure
            boolean faster = target < currentShutterSeconds;
            if (!stepOnce(true, faster) || (faster ? currentShutterSeconds <= target : currentShutterSeconds >= target)) {
                break;
            }
        }
    }

    /** Steps until the f-number reaches (or passes) {@code target}. */
    private void stepApertureTo(double target) throws Exception {
        for (int i = 0; i < MAX_STEPS && !closeEnough(currentAperture, target); i++) {
            // increment = higher f-number
            boolean up = target > currentAperture;
            if (!stepOnce(false, up) || (up ? currentAperture >= target : currentAperture <= target)) {
                break;
            }
        }
    }

    private static boolean closeEnough(double a, double b) {
        return Math.abs(a - b) <= Math.max(a, b) * 0.03;
    }

    /** "1/250" -> 0.004, "2\"" or "2" -> 2, "0.5\"" -> 0.5 */
    static double parseShutterSpeed(String text) {
        String t = text.trim().replace("\"", "");
        int slash = t.indexOf('/');
        if (slash >= 0) {
            return Double.parseDouble(t.substring(0, slash)) / Double.parseDouble(t.substring(slash + 1));
        }
        return Double.parseDouble(t);
    }

    /**
     * Half-press from the phone. "start" focuses and locks (returns once AF finishes, with
     * {focused}), "stop" releases the lock. Direct shutter has to be off for the app's own AF
     * (with it on, the AF callback never arrives), so it is stopped while the lock is held.
     */
    public JSONObject focus(final boolean start) throws Exception {
        final boolean[] focused = { false };
        final CountDownLatch done = new CountDownLatch(1);
        camera.call(new LiveView.CameraTask<Void>() {
            @Override
            public Void run(final CameraEx cameraEx) {
                if (!start) {
                    releaseFocus(cameraEx);
                    done.countDown();
                    return null;
                }
                if (focusHeld) {
                    cameraEx.getNormalCamera().cancelAutoFocus();
                }
                focusHeld = true;
                final Camera.AutoFocusCallback callback = new Camera.AutoFocusCallback() {
                    @Override
                    public void onAutoFocus(boolean success, Camera c) {
                        focused[0] = success;
                        done.countDown();
                    }
                };
                cameraEx.stopDirectShutter(new CameraEx.DirectShutterStoppedCallback() {
                    @Override
                    public void onShutterStopped(CameraEx cameraEx) {
                        cameraEx.getNormalCamera().autoFocus(callback);
                    }
                });
                return null;
            }
        }, CALL_TIMEOUT_MS);
        boolean finished = done.await(FOCUS_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        JSONObject result = new JSONObject();
        result.put("focusing", start);
        result.put("focused", focused[0]);
        result.put("timeout", !finished);
        Logger.info("Remote half-press: " + result);
        return result;
    }

    /** UI thread. */
    private void releaseFocus(CameraEx cameraEx) {
        if (!focusHeld) {
            return;
        }
        focusHeld = false;
        try {
            cameraEx.getNormalCamera().cancelAutoFocus();
        } catch (RuntimeException e) {
            Logger.error("cancelAutoFocus failed", e);
        }
        cameraEx.startDirectShutter();
    }

    /**
     * Takes a picture; returns {status: ok|canceled|error|timeout, ms}.
     *
     * While direct shutter (the physical button) is active this firmware cancels app-initiated
     * captures immediately, so direct shutter is stopped for the shot and restarted afterwards.
     * (Verified on ILCE-5000 fw 1.10: burstableTakePicture / Camera.takePicture are canceled
     * with direct shutter on, also with the live view sequence paused.) If a half-press from the
     * phone is holding focus, direct shutter is already off and the locked focus is used.
     */
    public JSONObject shoot() throws Exception {
        synchronized (shutterLock) {
            final int[] status = { -1 };
            final CountDownLatch done = new CountDownLatch(1);
            final long start = System.currentTimeMillis();
            camera.call(new LiveView.CameraTask<Void>() {
                @Override
                public Void run(CameraEx cameraEx) {
                    cameraEx.setShutterListener(new CameraEx.ShutterListener() {
                        @Override
                        public void onShutter(int result, CameraEx cameraEx) {
                            // Required to finish the capture sequence and accept the next one
                            cameraEx.cancelTakePicture();
                            cameraEx.setShutterListener(null);
                            if (focusHeld) {
                                releaseFocus(cameraEx);
                            } else {
                                cameraEx.startDirectShutter();
                            }
                            status[0] = result;
                            done.countDown();
                        }
                    });
                    if (focusHeld) {
                        cameraEx.burstableTakePicture();
                    } else {
                        cameraEx.stopDirectShutter(new CameraEx.DirectShutterStoppedCallback() {
                            @Override
                            public void onShutterStopped(CameraEx cameraEx) {
                                cameraEx.burstableTakePicture();
                            }
                        });
                    }
                    return null;
                }
            }, CALL_TIMEOUT_MS);
            boolean finished = done.await(SHUTTER_TIMEOUT_MS, TimeUnit.MILLISECONDS);
            JSONObject result = new JSONObject();
            result.put("status", !finished ? "timeout"
                    : status[0] == CameraEx.ShutterListener.STATUS_OK ? "ok"
                    : status[0] == CameraEx.ShutterListener.STATUS_CANCELED ? "canceled" : "error");
            result.put("ms", System.currentTimeMillis() - start);
            Logger.info("Remote shutter: " + result);
            return result;
        }
    }

}
