package dev.oein.ilceremote;

import android.os.Environment;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * The last shooting settings, kept on the memory card. The camera shuts Android down abruptly when
 * the app is left, which loses SharedPreferences writes still in the page cache; this file is
 * synced to the card on every write. 8.3 name, as the card is mounted without long names.
 */
final class SettingsFile {
    private static final File FILE = new File(Environment.getExternalStorageDirectory(), "ILCEREMO/LASTSET.JSN");

    private SettingsFile() {}

    /** The saved text, or null if there is none. */
    static String read() {
        if (!FILE.isFile()) {
            return null;
        }
        try {
            InputStream in = new FileInputStream(FILE);
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
            Logger.error("Reading " + FILE + " failed", e);
            return null;
        }
    }

    static void write(String text) {
        try {
            File dir = FILE.getParentFile();
            if (!dir.isDirectory() && !dir.mkdirs()) {
                return;
            }
            FileOutputStream out = new FileOutputStream(FILE);
            try {
                out.write(text.getBytes("UTF-8"));
                out.getFD().sync();
            } finally {
                out.close();
            }
        } catch (IOException e) {
            Logger.error("Writing " + FILE + " failed", e);
        }
    }
}
