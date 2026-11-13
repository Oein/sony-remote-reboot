package dev.oein.ilceremote;

import android.os.Environment;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * Settings kept on the memory card. The camera shuts Android down abruptly when the app is left,
 * which loses SharedPreferences writes still in the page cache; these files are synced to the card
 * on every write. 8.3 names, as the card is mounted without long names.
 */
final class SettingsFile {
    /** The last shooting settings. */
    static final File LAST_SETTINGS = file("LASTSET.JSN");
    /** The app's own MENU settings: network mode, live view effect, zoom speed. */
    static final File MENU = file("MENUSET.JSN");

    private SettingsFile() {}

    private static File file(String name) {
        return new File(Environment.getExternalStorageDirectory(), "ILCEREMO/" + name);
    }

    /** The saved text, or null if there is none. */
    static String read(File file) {
        if (!file.isFile()) {
            return null;
        }
        try {
            InputStream in = new FileInputStream(file);
            try {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buffer = new byte[1024];
                int n;
                while ((n = in.read(buffer)) > 0) {
                    out.write(buffer, 0, n);
                }
                return out.toString("UTF-8");
            } finally {
                in.close();
            }
        } catch (IOException e) {
            Logger.error("Reading " + file + " failed", e);
            return null;
        }
    }

    static void write(File file, String text) {
        try {
            File dir = file.getParentFile();
            if (!dir.isDirectory() && !dir.mkdirs()) {
                return;
            }
            FileOutputStream out = new FileOutputStream(file);
            try {
                out.write(text.getBytes("UTF-8"));
                out.getFD().sync();
            } finally {
                out.close();
            }
        } catch (IOException e) {
            Logger.error("Writing " + file + " failed", e);
        }
    }
}
