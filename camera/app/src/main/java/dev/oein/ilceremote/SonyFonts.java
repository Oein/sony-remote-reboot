package dev.oein.ilceremote;

import android.graphics.Typeface;

import java.io.File;

/**
 * The camera's own fonts, which the firmware ships in /system/fonts next to Android's:
 * Univers for the shooting display's numbers, and a Korean Hei face (which also has the
 * ◆●▲▼ symbols the menus use). Falls back to Android's fonts if a file is missing.
 */
final class SonyFonts {
    private static Typeface univers;
    private static Typeface korean;
    private static boolean loaded;

    private SonyFonts() {}

    /** Latin digits/text in the style of the shooting display. */
    static Typeface osd() {
        load();
        return univers != null ? univers : Typeface.DEFAULT_BOLD;
    }

    /** Menu / screen text, including Korean and symbols. */
    static Typeface ui() {
        load();
        return korean != null ? korean : Typeface.DEFAULT;
    }

    private static synchronized void load() {
        if (loaded) {
            return;
        }
        loaded = true;
        univers = fromFile("/system/fonts/UniversOTS-SJ.ttf");
        korean = fromFile("/system/fonts/MYingHeiC-KSX1001-SJ.ttf");
    }

    private static Typeface fromFile(String path) {
        try {
            return new File(path).isFile() ? Typeface.createFromFile(path) : null;
        } catch (RuntimeException e) {
            Logger.error("Font " + path + " failed", e);
            return null;
        }
    }
}
