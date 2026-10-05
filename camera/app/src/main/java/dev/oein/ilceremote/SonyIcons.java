package dev.oein.ilceremote;

import android.annotation.SuppressLint;
import android.content.res.Resources;
import android.graphics.drawable.Drawable;

import java.util.HashMap;
import java.util.Map;

/**
 * The camera's own display icons, which live in the firmware's framework resources.
 * Looked up by name rather than by id, since ids are specific to a firmware build.
 *
 * They are drawn for the camera's LCD, which shows the 640x480 frame buffer stretched to 16:9:
 * a 72x96 icon appears square on screen, so they need no aspect correction.
 */
final class SonyIcons {
    /** Horizontal scale that makes our own text and shapes look right on the stretched LCD. */
    static final float X_SCALE = 0.75f;

    private static final Map<String, Integer> IDS = new HashMap<String, Integer>();

    private SonyIcons() {}

    /** A new drawable for {@code name} (without the "drawable/" prefix), or null if this firmware lacks it. */
    @SuppressLint("DiscouragedApi") // by name on purpose: ids differ between firmware builds
    static Drawable get(String name) {
        Integer id = IDS.get(name);
        if (id == null) {
            id = Resources.getSystem().getIdentifier(name, "drawable", "android");
            IDS.put(name, id);
        }
        if (id == 0) {
            return null;
        }
        try {
            return Resources.getSystem().getDrawable(id);
        } catch (Resources.NotFoundException e) {
            return null;
        }
    }

    /** Shooting-mode icon from the camera's display, for a Camera.Parameters scene mode. */
    static Drawable forSceneMode(String sceneMode) {
        String name = sceneModeIconName(sceneMode);
        return name == null ? null : get("s_16_dd_parts_osd_icon_mode_" + name);
    }

    static String sceneModeIconName(String sceneMode) {
        if ("auto".equals(sceneMode)) {
            return "iauto";
        }
        if ("program-auto".equals(sceneMode)) {
            return "p";
        }
        if ("aperture-priority".equals(sceneMode)) {
            return "a";
        }
        if ("shutter-speed".equals(sceneMode)) {
            return "s";
        }
        if ("manual-exposure".equals(sceneMode)) {
            return "m";
        }
        if ("anti-motion-blur".equals(sceneMode)) {
            return "antimotionblur";
        }
        String scene = sceneSelectionName(sceneMode);
        return scene == null ? null : "sceneselection_" + scene;
    }

    /** Name used by the scene-selection icons, e.g. "night" -> "nightview". */
    static String sceneSelectionName(String sceneMode) {
        if ("portrait".equals(sceneMode) || "landscape".equals(sceneMode) || "macro".equals(sceneMode)
                || "sunset".equals(sceneMode)) {
            return sceneMode;
        }
        if ("sports".equals(sceneMode)) {
            return "sportsaction";
        }
        if ("night".equals(sceneMode)) {
            return "nightview";
        }
        if ("night-portrait".equals(sceneMode)) {
            return "nightportrait";
        }
        if ("hand-held-twilight".equals(sceneMode)) {
            return "handheldtwilight";
        }
        if ("anti-motion-blur".equals(sceneMode)) {
            return "antimotionblur";
        }
        return null;
    }

    /** Focus-mode icon for the shooting display (AF-S / AF-C / DMF / MF), or null. */
    static Drawable forFocusMode(String focusMode, String afMode) {
        String name;
        if ("manual".equals(focusMode)) {
            name = "mf";
        } else if ("dmf".equals(focusMode)) {
            name = "dmf";
        } else {
            name = "af-c".equals(afMode) ? "af_c" : "af_s";
        }
        return get("s_16_dd_parts_osd_icon_setting_autofocusmode_" + name);
    }

    /** Drive-mode icon for the shooting display. */
    static Drawable forDrive(String driveMode, int selfTimer) {
        return get("s_16_dd_parts_osd_icon_setting_drivemode_" + driveIconName(driveMode, selfTimer, true));
    }

    /** Icon suffix for a drive mode; {@code osd} selects the display set's names over the picker's. */
    static String driveIconName(String driveMode, int selfTimer, boolean osd) {
        if (selfTimer == 10) {
            return osd ? "selftimer_10" : "selftimer10";
        }
        if (selfTimer == 2) {
            return osd ? "selftimer_2" : "selftimer2";
        }
        if ("burst".equals(driveMode)) {
            return "cont";
        }
        if ("speed-prior-burst".equals(driveMode)) {
            return osd ? "speedprioritycont" : "speedcont";
        }
        if ("bracket".equals(driveMode)) {
            return "brkc_03ev";
        }
        return "single";
    }
}
