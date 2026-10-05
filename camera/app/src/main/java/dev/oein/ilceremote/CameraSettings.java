package dev.oein.ilceremote;

import android.hardware.Camera;
import android.util.Pair;

import com.sony.scalar.hardware.CameraEx;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.List;

/**
 * Reading and changing shooting settings. UI thread only (called directly by the on-camera
 * controls, and through LiveView.call by the HTTP API).
 */
final class CameraSettings {
    private CameraSettings() {}

    static final String[][] MODES = {
            { "program", CameraEx.ParametersModifier.SCENE_MODE_PROGRAM_AUTO },
            { "aperture", CameraEx.ParametersModifier.SCENE_MODE_APERTURE_PRIORITY },
            { "shutter", CameraEx.ParametersModifier.SCENE_MODE_SHUTTER_PRIORITY },
            { "manual", CameraEx.ParametersModifier.SCENE_MODE_MANUAL_EXPOSURE },
            { "auto", "auto" },
    };

    /**
     * Applies mode / iso / ev / whiteBalance / driveMode from {@code changes} in one
     * setParameters call. Shutter speed and aperture are stepped separately (see CameraControl).
     */
    static void apply(CameraEx cameraEx, JSONObject changes) throws JSONException {
        Camera.Parameters params = cameraEx.createEmptyParameters();
        CameraEx.ParametersModifier modifier = cameraEx.createParametersModifier(params);
        boolean changed = false;
        if (changes.has("mode")) {
            params.setSceneMode(sceneModeFor(changes.getString("mode")));
            changed = true;
        }
        if (changes.has("sceneMode")) {
            // Raw scene mode from sceneModeValues, e.g. "portrait" or "night"
            params.setSceneMode(changes.getString("sceneMode"));
            changed = true;
        }
        if (changes.has("iso")) {
            modifier.setISOSensitivity(changes.getInt("iso"));
            changed = true;
        }
        if (changes.has("ev")) {
            params.setExposureCompensation(changes.getInt("ev"));
            changed = true;
        }
        if (changes.has("whiteBalance")) {
            params.setWhiteBalance(changes.getString("whiteBalance"));
            changed = true;
        }
        if (changes.has("driveMode")) {
            modifier.setDriveMode(changes.getString("driveMode"));
            changed = true;
        }
        if (changes.has("focusMode")) {
            params.setFocusMode(changes.getString("focusMode"));
            changed = true;
        }
        if (changes.has("colorTemperature")) {
            modifier.setColorTemperatureForWhiteBalance(changes.getInt("colorTemperature"));
            changed = true;
        }
        if (changes.has("wbAB")) {
            // Amber (-) .. blue (+) fine tuning
            modifier.setLightBalanceForWhiteBalance(changes.getInt("wbAB"));
            changed = true;
        }
        if (changes.has("wbGM")) {
            // Green (-) .. magenta (+) fine tuning
            modifier.setColorCompensationForWhiteBalance(changes.getInt("wbGM"));
            changed = true;
        }
        if (changes.has("selfTimer")) {
            modifier.setSelfTimer(changes.getInt("selfTimer"));
            changed = true;
        }
        if (changes.has("liveViewEffect")) {
            // As Sony's own apps do it ("ViewTeki"): an OVF-like preview is the "Setting Effect OFF" look
            modifier.setOVFPreviewMode(!changes.getBoolean("liveViewEffect"));
            changed = true;
        }
        if (changed) {
            cameraEx.getNormalCamera().setParameters(params);
        }
    }

    static JSONObject read(CameraEx cameraEx) {
        Camera.Parameters params = cameraEx.getNormalCamera().getParameters();
        CameraEx.ParametersModifier modifier = cameraEx.createParametersModifier(params);
        JSONObject state = new JSONObject();
        JSONObject errors = new JSONObject();

        try {
            String scene = params.getSceneMode();
            state.put("mode", modeFor(scene));
            state.put("sceneMode", scene);
        } catch (Throwable t) {
            error(errors, "mode", t);
        }
        try {
            state.put("iso", modifier.getISOSensitivity());
            state.put("isoValues", toJson(modifier.getSupportedISOSensitivities()));
        } catch (Throwable t) {
            error(errors, "iso", t);
        }
        try {
            Pair<?, ?> speed = modifier.getShutterSpeed();
            int n = (Integer) speed.first;
            int d = (Integer) speed.second;
            state.put("shutter", new JSONArray().put(n).put(d));
            state.put("shutterText", formatShutterSpeed(n, d));
        } catch (Throwable t) {
            error(errors, "shutter", t);
        }
        try {
            int aperture = modifier.getAperture();
            state.put("aperture", aperture / 100.0);
        } catch (Throwable t) {
            error(errors, "aperture", t);
        }
        try {
            state.put("ev", params.getExposureCompensation());
            state.put("evMin", params.getMinExposureCompensation());
            state.put("evMax", params.getMaxExposureCompensation());
            state.put("evStep", params.getExposureCompensationStep());
        } catch (Throwable t) {
            error(errors, "ev", t);
        }
        try {
            state.put("whiteBalance", params.getWhiteBalance());
            state.put("whiteBalanceValues", toJson(params.getSupportedWhiteBalance()));
        } catch (Throwable t) {
            error(errors, "whiteBalance", t);
        }
        try {
            state.put("driveMode", modifier.getDriveMode());
            state.put("driveModeValues", toJson(modifier.getSupportedDriveModes()));
        } catch (Throwable t) {
            error(errors, "driveMode", t);
        }
        try {
            state.put("colorTemperature", modifier.getColorTemperatureForWhiteBalance());
            state.put("colorTemperatureMin", modifier.getMinColorTemperatureForWhiteBalance());
            state.put("colorTemperatureMax", modifier.getMaxColorTemperatureForWhiteBalance());
            state.put("wbAB", modifier.getLightBalanceForWhiteBalance());
            state.put("wbABMin", modifier.getMinLightBalanceForWhiteBalance());
            state.put("wbABMax", modifier.getMaxLightBalanceForWhiteBalance());
            state.put("wbGM", modifier.getColorCompensationForWhiteBalance());
            state.put("wbGMMin", modifier.getMinColorCompensationForWhiteBalance());
            state.put("wbGMMax", modifier.getMaxColorCompensationForWhiteBalance());
        } catch (Throwable t) {
            error(errors, "whiteBalanceFine", t);
        }
        try {
            state.put("selfTimer", modifier.getSelfTimer());
            state.put("selfTimerValues", toJson(modifier.getSupportedSelfTimers()));
        } catch (Throwable t) {
            error(errors, "selfTimer", t);
        }
        try {
            // The camera's "Live View Display: Setting Effect ON": exposure settings show in the preview
            state.put("liveViewEffect", !modifier.getOVFPreviewMode());
        } catch (Throwable t) {
            error(errors, "liveViewEffect", t);
        }
        try {
            // "3:2" or "16:9"; the live view frames follow it
            state.put("imageAspect", params.get("image-aspect"));
        } catch (Throwable t) {
            error(errors, "imageAspect", t);
        }
        try {
            state.put("storageFormat", params.get("storage-fmt"));
        } catch (Throwable t) {
            error(errors, "storageFormat", t);
        }
        try {
            state.put("focusMode", params.getFocusMode());
            state.put("focusModeValues", toJson(params.getSupportedFocusModes()));
            // AF-S / AF-C, shown instead of "auto" like the camera's own display
            state.put("afMode", params.get("af-mode"));
        } catch (Throwable t) {
            error(errors, "focusMode", t);
        }
        try {
            state.put("focusDriveSupported", modifier.isFocusDriveSupported());
        } catch (Throwable t) {
            error(errors, "focusDriveSupported", t);
        }
        try {
            state.put("sceneModeValues", toJson(params.getSupportedSceneModes()));
        } catch (Throwable t) {
            error(errors, "sceneModeValues", t);
        }
        if (errors.length() > 0) {
            try {
                state.put("errors", errors);
            } catch (Throwable ignored) {
                // JSONObject.put only fails for null keys
            }
        }
        return state;
    }

    private static void error(JSONObject errors, String key, Throwable t) {
        try {
            errors.put(key, t.toString());
        } catch (Throwable ignored) {
            // JSONObject.put only fails for null keys
        }
    }

    private static JSONArray toJson(List<?> list) {
        JSONArray array = new JSONArray();
        if (list != null) {
            for (Object item : list) {
                array.put(item);
            }
        }
        return array;
    }

    /** Scene modes in the order of the camera's own mode list; unknown ones go last. */
    private static final String[] SCENE_ORDER = {
            "auto", "program-auto", "aperture-priority", "shutter-speed", "manual-exposure",
            "portrait", "sports", "macro", "landscape", "sunset", "night", "night-portrait",
            "hand-held-twilight", "anti-motion-blur",
    };

    /** The camera's supported scene modes, sorted like its own mode list. */
    static JSONArray orderedSceneModes(JSONArray supported) {
        JSONArray ordered = new JSONArray();
        java.util.Set<String> seen = new java.util.HashSet<String>();
        for (String mode : SCENE_ORDER) {
            for (int i = 0; supported != null && i < supported.length(); i++) {
                if (mode.equals(supported.optString(i))) {
                    ordered.put(mode);
                    seen.add(mode);
                }
            }
        }
        for (int i = 0; supported != null && i < supported.length(); i++) {
            if (!seen.contains(supported.optString(i))) {
                ordered.put(supported.optString(i));
            }
        }
        return ordered;
    }

    /** Display name of a scene mode, as the camera's own (Korean) menus call it. */
    static String sceneModeName(String sceneMode) {
        String[][] names = {
                { "auto", "\uc778\ud154\ub9ac\uc804\ud2b8 \uc790\ub3d9" },
                { "program-auto", "\ud504\ub85c\uadf8\ub7a8 \uc790\ub3d9" },
                { "aperture-priority", "\uc870\ub9ac\uac1c \uc6b0\uc120" },
                { "shutter-speed", "\uc154\ud130 \uc6b0\uc120" },
                { "manual-exposure", "\uc218\ub3d9 \ub178\ucd9c" },
                { "portrait", "\uc778\ubb3c" },
                { "sports", "\uc2a4\ud3ec\uce20 \ub3d9\uc791" },
                { "macro", "\ub9e4\ud06c\ub85c" },
                { "landscape", "\ud48d\uacbd" },
                { "sunset", "\uc77c\ubab0" },
                { "night", "\uc57c\uacbd" },
                { "night-portrait", "\uc57c\uacbd \uc778\ubb3c" },
                { "hand-held-twilight", "\uc190\uc5d0 \ub4e4\uace0 \uc57c\uacbd" },
                { "anti-motion-blur", "\uc6c0\uc9c1\uc784 \ud750\ub9bc \ubc29\uc9c0" },
        };
        for (String[] name : names) {
            if (name[0].equals(sceneMode)) {
                return name[1];
            }
        }
        return sceneMode == null ? "" : sceneMode;
    }

    static String modeFor(String sceneMode) {
        for (String[] mode : MODES) {
            if (mode[1].equals(sceneMode)) {
                return mode[0];
            }
        }
        return "other";
    }

    static String sceneModeFor(String mode) {
        for (String[] m : MODES) {
            if (m[0].equals(mode)) {
                return m[1];
            }
        }
        throw new IllegalArgumentException("Unknown mode: " + mode);
    }

    /** 1/250, 1/4, 0.5", 1.3", 2", 30" */
    static String formatShutterSpeed(int n, int d) {
        if (n == 1 && d > 1) {
            return "1/" + d;
        }
        if (n % d == 0) {
            return (n / d) + "\"";
        }
        return String.valueOf((double) n / d) + "\"";
    }
}
