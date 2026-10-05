package dev.oein.ilceremote;

import com.sony.scalar.hardware.CameraEx;
import com.sony.scalar.sysutil.ScalarInput;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Control wheel behaviour while shooting: turning the wheel changes the mode's main exposure
 * value (shutter in S/M, aperture in A); up swaps shutter/aperture in M; right / down make the
 * wheel change ISO / exposure compensation (press again, or wait, to go back).
 * Left (drive) and centre (shooting mode) open pickers, handled by the activity. UI thread only.
 */
class ShootingControls {
    /** What the control wheel currently adjusts. */
    enum Target { MAIN, ALT, ISO, EV }

    /** Fall back to the main target after this long without touching the wheel. */
    private static final long TARGET_TIMEOUT_MS = 6000;

    private final LiveView liveView;
    private Target target = Target.MAIN;
    private long lastUse;
    /** Last state read for the OSD; value lists come from here. */
    private JSONObject state = new JSONObject();

    ShootingControls(LiveView liveView) {
        this.liveView = liveView;
    }

    void setState(JSONObject state) {
        this.state = state;
        if (target != Target.MAIN && System.currentTimeMillis() - lastUse > TARGET_TIMEOUT_MS) {
            target = Target.MAIN;
        }
    }

    /** The setting the wheel changes now: "shutter", "aperture", "iso", "ev" or null. */
    String activeSetting() {
        switch (target) {
            case ISO: return "iso";
            case EV: return "ev";
            case ALT: return "aperture";
            default:
                String mode = state.optString("mode");
                if ("aperture".equals(mode)) {
                    return "aperture";
                }
                if ("shutter".equals(mode) || "manual".equals(mode)) {
                    return "shutter";
                }
                return null; // auto / program: the camera picks exposure
        }
    }

    static boolean isDialKey(int scanCode) {
        switch (scanCode) {
            case ScalarInput.ISV_DIAL_KURU_CLOCKWISE:
            case ScalarInput.ISV_DIAL_KURU_COUNTERCW:
            case ScalarInput.ISV_DIAL_1_CLOCKWISE:
            case ScalarInput.ISV_DIAL_1_COUNTERCW:
            case ScalarInput.ISV_DIAL_2_CLOCKWISE:
            case ScalarInput.ISV_DIAL_2_COUNTERCW:
                return true;
            default:
                return false;
        }
    }

    static int dialDirection(int scanCode) {
        switch (scanCode) {
            case ScalarInput.ISV_DIAL_KURU_CLOCKWISE:
            case ScalarInput.ISV_DIAL_1_CLOCKWISE:
            case ScalarInput.ISV_DIAL_2_CLOCKWISE:
                return 1;
            default:
                return -1;
        }
    }

    /** Wheel turned one detent; clockwise (+1) = faster / smaller aperture / higher ISO / +EV. */
    void onDial(int direction) {
        CameraEx camera = liveView.getCamera();
        String setting = activeSetting();
        if (camera == null || setting == null) {
            return;
        }
        lastUse = System.currentTimeMillis();
        try {
            if ("shutter".equals(setting)) {
                if (direction > 0) {
                    camera.incrementShutterSpeed();
                } else {
                    camera.decrementShutterSpeed();
                }
            } else if ("aperture".equals(setting)) {
                if (direction > 0) {
                    camera.incrementAperture();
                } else {
                    camera.decrementAperture();
                }
            } else if ("iso".equals(setting)) {
                Object next = neighbour(state.optJSONArray("isoValues"), state.opt("iso"), direction);
                if (next != null) {
                    CameraSettings.apply(camera, new JSONObject().put("iso", next));
                }
            } else if ("ev".equals(setting)) {
                int ev = state.optInt("ev") + direction;
                if (ev >= state.optInt("evMin", ev) && ev <= state.optInt("evMax", ev)) {
                    CameraSettings.apply(camera, new JSONObject().put("ev", ev));
                }
            }
        } catch (Throwable t) {
            Logger.error("Wheel " + setting + " failed", t);
        }
    }

    /** Wheel buttons; returns true if handled. */
    boolean onKey(int scanCode) {
        lastUse = System.currentTimeMillis();
        switch (scanCode) {
            case ScalarInput.ISV_KEY_RIGHT:
                target = target == Target.ISO ? Target.MAIN : Target.ISO;
                return true;
            case ScalarInput.ISV_KEY_DOWN:
                target = target == Target.EV ? Target.MAIN : Target.EV;
                return true;
            case ScalarInput.ISV_KEY_UP:
                if ("manual".equals(state.optString("mode"))) {
                    target = target == Target.ALT ? Target.MAIN : Target.ALT;
                } else {
                    target = Target.MAIN;
                }
                return true;
            default:
                return false;
        }
    }

    // --- zoom lever ---------------------------------------------------------------------------

    /** Zoom lever: while held it repeats ZOOM_TELE / ZOOM_WIDE, and sends ZOOM_OFF on release. */
    static boolean isZoomKey(int scanCode) {
        return scanCode == ScalarInput.ISV_KEY_ZOOM_TELE || scanCode == ScalarInput.ISV_KEY_ZOOM_WIDE
                || scanCode == ScalarInput.ISV_KEY_ZOOM_OFF;
    }

    /** Receives zoom, manual-focus position and AF result updates for the on-screen indicators. */
    interface PositionDisplay extends FocusMagnifier.Display {
        void onZoom(CameraEx.ZoomInfo info);

        void onFocusPosition(int current, int max);

        /** AF finished or changed; {@code focused} are the AF areas in focus (empty if none). */
        void onAutoFocus(int status, android.graphics.Rect[] focused);
    }

    // AF areas of the current focus area mode, and the latest AF result (read from any thread)
    private volatile CameraEx.FocusAreaRectInfo[] focusAreas = new CameraEx.FocusAreaRectInfo[0];
    private volatile int afStatus = -1;
    private volatile android.graphics.Rect[] afFocused = new android.graphics.Rect[0];
    private int afLogCount;

    /** Latest AF result: {status, rects}; status is AutoFocusDoneListener.STATUS_* or -1. */
    int getAfStatus() {
        return afStatus;
    }

    android.graphics.Rect[] getAfFocused() {
        return afFocused;
    }

    private PositionDisplay positionDisplay;
    private CameraEx listenerCamera;
    private final FocusMagnifier magnifier = new FocusMagnifier();

    FocusMagnifier magnifier() {
        return magnifier;
    }
    private volatile int focusPosition = -1;
    private volatile int focusMaxPosition = -1;

    void setPositionDisplay(PositionDisplay display) {
        magnifier.setDisplay(display);
        positionDisplay = display;
    }

    /** Latest manual focus position reported by the lens, {current, max}; -1 if unknown. */
    int[] getFocusPosition() {
        return new int[] { focusPosition, focusMaxPosition };
    }

    /** Registers zoom / focus listeners on the current camera (again after it is reopened). UI thread. */
    void listenToCamera(CameraEx camera) {
        if (camera == null || camera == listenerCamera) {
            return;
        }
        listenerCamera = camera;
        magnifier.listen(camera);
        camera.setZoomChangeListener(new CameraEx.ZoomChangeListener() {
            @Override
            public void onChanged(CameraEx.ZoomInfo info, CameraEx cameraEx) {
                opticalMagnification = info.opticalMagnification;
                stepZoomTarget();
                if (positionDisplay != null) {
                    positionDisplay.onZoom(info);
                }
            }
        });
        camera.setFocusAreaListener(new CameraEx.FocusAreaListener() {
            @Override
            public void onChanged(CameraEx.FocusAreaInfos infos, CameraEx cameraEx) {
                if (infos != null && infos.rectInfos != null) {
                    focusAreas = infos.rectInfos;
                    if (BuildConfig.DEBUG && afLogCount++ < 5) {
                        StringBuilder rects = new StringBuilder();
                        for (int i = 0; i < Math.min(5, infos.rectInfos.length); i++) {
                            CameraEx.FocusAreaRectInfo r = infos.rectInfos[i];
                            rects.append(' ').append(r.index).append(':').append(r.rect);
                        }
                        Logger.info("Focus areas mode=" + infos.focusAreaMode + " n=" + infos.rectInfos.length + rects);
                    }
                }
            }
        });
        camera.setAutoFocusDoneListener(new CameraEx.AutoFocusDoneListener() {
            @Override
            public void onDone(int status, int[] areas, CameraEx cameraEx) {
                android.graphics.Rect[] focused = focusedRects(areas);
                if (BuildConfig.DEBUG && afLogCount++ < 20) {
                    Logger.info("AF done status=" + status + " areas=" + java.util.Arrays.toString(areas)
                            + " rects=" + java.util.Arrays.toString(focused));
                }
                afStatus = status;
                afFocused = focused;
                if (positionDisplay != null) {
                    positionDisplay.onAutoFocus(status, focused);
                }
            }
        });
        camera.setFocusDriveListener(new CameraEx.FocusDriveListener() {
            @Override
            public void onChanged(CameraEx.FocusPosition position, CameraEx cameraEx) {
                focusPosition = position.currentPosition;
                focusMaxPosition = position.maxPosition;
                if (positionDisplay != null) {
                    positionDisplay.onFocusPosition(position.currentPosition, position.maxPosition);
                }
            }
        });
    }

    /**
     * Rectangles of the AF areas reported in focus. The AF-done callback gives area numbers; they are
     * matched against the areas' own index, falling back to their position in the list.
     */
    private android.graphics.Rect[] focusedRects(int[] areas) {
        if (areas == null) {
            return new android.graphics.Rect[0];
        }
        CameraEx.FocusAreaRectInfo[] all = focusAreas;
        java.util.List<android.graphics.Rect> rects = new java.util.ArrayList<android.graphics.Rect>();
        for (int area : areas) {
            android.graphics.Rect found = null;
            for (CameraEx.FocusAreaRectInfo info : all) {
                if (info != null && info.index == area && info.rect != null) {
                    found = info.rect;
                    break;
                }
            }
            if (found == null && area >= 0 && area < all.length && all[area] != null) {
                found = all[area].rect;
            }
            if (found != null) {
                rects.add(new android.graphics.Rect(found));
            }
        }
        return rects.toArray(new android.graphics.Rect[rects.size()]);
    }

    /** Movie button: toggle between autofocus (AF-S) and manual focus. */
    void toggleManualFocus() {
        CameraEx camera = liveView.getCamera();
        if (camera == null) {
            return;
        }
        String next = "manual".equals(state.optString("focusMode")) ? "auto" : "manual";
        try {
            CameraSettings.apply(camera, new JSONObject().put("focusMode", next));
        } catch (Throwable t) {
            Logger.error("Focus mode " + next + " failed", t);
        }
    }

    private int zoomDirection = -1;
    /**
     * Speed for the zoom lever, 1..max (8 on the 16-50 PZ). The lever's key codes don't say how far
     * it is pushed, so it can't vary speed like the camera's own UI; full speed is too fast to frame.
     */
    private int leverZoomSpeed = 3;

    int getLeverZoomSpeed() {
        return leverZoomSpeed;
    }

    void setLeverZoomSpeed(int speed) {
        leverZoomSpeed = Math.max(1, Math.min(8, speed));
    }

    /** Manual zoom (lever, W/T buttons) takes over from a zoom-to-position. */
    void cancelZoomTarget() {
        zoomTarget = -1;
    }

    void onZoomKey(int scanCode) {
        cancelZoomTarget();
        if (scanCode == ScalarInput.ISV_KEY_ZOOM_OFF) {
            stopZoom();
            return;
        }
        int direction = scanCode == ScalarInput.ISV_KEY_ZOOM_TELE
                ? CameraEx.ZOOM_DIRECTION_TELE : CameraEx.ZOOM_DIRECTION_WIDE;
        if (direction != zoomDirection) {
            startZoom(direction, leverZoomSpeed);
        }
    }

    // --- zoom to a position (the phone's zoom slider) ------------------------------------------

    /** Latest optical magnification x100 (100 = widest), from the zoom listener. */
    private volatile int opticalMagnification = 100;
    /** Magnification x100 being zoomed to, or -1. */
    private int zoomTarget = -1;
    private int zoomTargetSpeed;
    private long zoomTargetDeadline;
    /** Within this of the target (x100) the zoom stops; closer than SLOW it creeps at speed 1. */
    private static final int ZOOM_TOLERANCE = 3;
    private static final int ZOOM_SLOW = 40;

    /** Widest to longest magnification x100 of the lens, e.g. 312 for a 16-50 mm; 100 if not a zoom. */
    int maxOpticalMagnification() {
        CameraEx camera = liveView.getCamera();
        try {
            CameraEx.LensInfo lens = camera == null ? null : camera.getLensInfo();
            if (lens != null && lens.FocalLength != null && lens.FocalLength.wide > 0) {
                return Math.max(100, lens.FocalLength.tele * 100 / lens.FocalLength.wide);
            }
        } catch (Throwable t) {
            Logger.error("Lens info failed", t);
        }
        return 100;
    }

    int getOpticalMagnification() {
        return opticalMagnification;
    }

    /**
     * Zooms to {@code fraction} (0 widest .. 1 longest) of the lens's range. The lens only zooms
     * at a speed, so this drives it there and stops it, slowing down near the target. UI thread.
     */
    void zoomTo(double fraction) {
        int max = maxOpticalMagnification();
        if (max <= 100) {
            return;
        }
        CameraEx camera = liveView.getCamera();
        if (camera != null) {
            listenToCamera(camera);
        }
        zoomTarget = 100 + (int) Math.round(Math.max(0, Math.min(1, fraction)) * (max - 100));
        zoomTargetSpeed = -1;
        zoomTargetDeadline = android.os.SystemClock.uptimeMillis() + 5000;
        stepZoomTarget();
    }

    /** Starts, slows or stops the zoom for {@link #zoomTarget}; called on every zoom change. */
    private void stepZoomTarget() {
        if (zoomTarget < 0) {
            return;
        }
        int diff = zoomTarget - opticalMagnification;
        int direction = diff > 0 ? CameraEx.ZOOM_DIRECTION_TELE : CameraEx.ZOOM_DIRECTION_WIDE;
        boolean overshot = zoomDirection >= 0 && direction != zoomDirection;
        if (Math.abs(diff) <= ZOOM_TOLERANCE || overshot
                || android.os.SystemClock.uptimeMillis() > zoomTargetDeadline) {
            zoomTarget = -1;
            stopZoom();
            return;
        }
        int speed = Math.abs(diff) < ZOOM_SLOW ? 1 : 0;
        if (zoomDirection != direction || speed != zoomTargetSpeed) {
            zoomTargetSpeed = speed;
            startZoom(direction, speed);
        }
    }

    /** {@code speed} 1..max, or 0 for the lens's fastest. */
    void startZoom(int direction, int speed) {
        CameraEx camera = liveView.getCamera();
        if (camera == null) {
            return;
        }
        try {
            if (zoomDirection >= 0) {
                camera.stopZoom();
            }
            int max = camera.createParametersModifier(camera.getNormalCamera().getParameters()).getMaxZoomSpeed();
            speed = speed <= 0 ? max : Math.min(speed, max);
            listenToCamera(camera);
            camera.startZoom(direction, speed);
            zoomDirection = direction;
        } catch (Throwable t) {
            Logger.error("Zoom failed", t);
        }
    }

    void stopZoom() {
        CameraEx camera = liveView.getCamera();
        if (camera == null || zoomDirection < 0) {
            return;
        }
        zoomDirection = -1;
        try {
            camera.stopZoom();
        } catch (Throwable t) {
            Logger.error("Stop zoom failed", t);
        }
    }

    /** The value next to {@code current} in {@code values}, or null at either end. */
    static Object neighbour(JSONArray values, Object current, int direction) {
        if (values == null) {
            return null;
        }
        for (int i = 0; i < values.length(); i++) {
            if (String.valueOf(values.opt(i)).equals(String.valueOf(current))) {
                int j = i + direction;
                return j >= 0 && j < values.length() ? values.opt(j) : null;
            }
        }
        return values.length() > 0 ? values.opt(0) : null;
    }
}
