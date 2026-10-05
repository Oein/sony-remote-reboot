package dev.oein.ilceremote;

import android.os.Environment;
import android.util.Log;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Logs to logcat and to a file on the SD card, so problems can be read back even without adb
 * (connect the camera as USB Mass Storage and open ILCEREMO/LOG.TXT).
 *
 * The file is written by a background thread in batches: opening and appending to a file on the
 * camera's SD card takes tens of milliseconds, which made every logged key press stall the UI.
 */
public final class Logger {
    private static final String TAG = "ILCERemote";
    private static final File FILE = new File(Environment.getExternalStorageDirectory(), "ILCEREMO/LOG.TXT");
    private static final File OLD = new File(Environment.getExternalStorageDirectory(), "ILCEREMO/LOG.OLD");
    private static final long MAX_SIZE = 256 * 1024;
    private static final int MAX_PENDING = 500;
    private static final long FLUSH_DELAY_MS = 1000;

    private static final List<String> pending = new ArrayList<String>();
    private static Thread writer;

    private Logger() {}

    public static void info(String msg) {
        Log.i(TAG, msg);
        enqueue("I", msg);
    }

    public static void error(String msg, Throwable t) {
        Log.e(TAG, msg, t);
        StringWriter trace = new StringWriter();
        t.printStackTrace(new PrintWriter(trace));
        enqueue("E", msg + "\n" + trace);
    }

    private static void enqueue(String level, String msg) {
        String line;
        synchronized (Logger.class) {
            line = new SimpleDateFormat("MM-dd HH:mm:ss.SSS", Locale.US).format(new Date())
                    + " " + level + " [" + Thread.currentThread().getName() + "] " + msg + "\n";
        }
        synchronized (pending) {
            if (pending.size() < MAX_PENDING) {
                pending.add(line);
            }
            if (writer == null) {
                writer = new Thread(new Runnable() {
                    @Override
                    public void run() {
                        writeLoop();
                    }
                }, "logger");
                writer.setPriority(Thread.MIN_PRIORITY);
                writer.setDaemon(true);
                writer.start();
            }
            pending.notifyAll();
        }
    }

    /** Writes what is queued now; call before the process may be killed (app exit). */
    public static void flush() {
        List<String> batch;
        synchronized (pending) {
            batch = new ArrayList<String>(pending);
            pending.clear();
        }
        if (!batch.isEmpty()) {
            synchronized (FILE) {
                write(batch);
            }
        }
    }

    private static void writeLoop() {
        while (true) {
            List<String> batch;
            try {
                synchronized (pending) {
                    while (pending.isEmpty()) {
                        pending.wait();
                    }
                }
                // Let a burst of lines collect, then write them with one open/close
                Thread.sleep(FLUSH_DELAY_MS);
                synchronized (pending) {
                    batch = new ArrayList<String>(pending);
                    pending.clear();
                }
            } catch (InterruptedException e) {
                return;
            }
            synchronized (FILE) {
                write(batch);
            }
        }
    }

    private static void write(List<String> lines) {
        try {
            File dir = FILE.getParentFile();
            if (!dir.isDirectory() && !dir.mkdirs()) {
                return;
            }
            if (FILE.length() > MAX_SIZE) {
                OLD.delete();
                if (!FILE.renameTo(OLD)) {
                    FILE.delete(); // never keep appending to an oversized file
                }
            }
            FileWriter out = new FileWriter(FILE, true);
            try {
                for (String line : lines) {
                    out.write(line);
                }
            } finally {
                out.close();
            }
        } catch (IOException ignored) {
            // Nothing sensible to do if the card is missing or full
        }
    }
}
