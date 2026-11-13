package dev.oein.ilceremote;

import android.os.Environment;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

/**
 * MP4 movies on the memory card: MP_ROOT/100ANV01/MAH04899.MP4, each with a 160x120 JPEG
 * thumbnail beside it (MAH04899.THM). Read straight from the card rather than the media index.
 * AVCHD movies (PRIVATE/AVCHD) are not listed: browsers can't play them.
 *
 * A movie's id is its folder number and file number, e.g. 100ANV01/MAH04899.MP4 -> 1004899.
 */
public class MovieLibrary {
    private static final File ROOT = new File(Environment.getExternalStorageDirectory(), "MP_ROOT");

    /** Per file (path + size + modified), since the header is read once: [durationMs, dateMs]. */
    private final Map<String, long[]> metaCache = new HashMap<String, long[]>();

    /**
     * Newest first: {"total": n, "offset": o, "items": [{id, name, size, date, duration}, ...]}.
     * {@code date} is the camera's local wall-clock time as epoch milliseconds, as for photos;
     * {@code duration} is in seconds (fractional), 0 if unknown.
     */
    public JSONObject list(int offset, int limit) throws JSONException {
        List<File> files = files();
        final Map<File, long[]> meta = new HashMap<File, long[]>();
        for (File file : files) {
            meta.put(file, meta(file));
        }
        Collections.sort(files, new Comparator<File>() {
            @Override
            public int compare(File a, File b) {
                long da = meta.get(a)[1];
                long db = meta.get(b)[1];
                if (da != db) {
                    return da < db ? 1 : -1;
                }
                return b.getName().compareTo(a.getName());
            }
        });
        JSONArray items = new JSONArray();
        for (int i = offset; i < files.size() && items.length() < limit; i++) {
            File file = files.get(i);
            long[] m = meta.get(file);
            items.put(new JSONObject()
                    .put("id", id(file))
                    .put("name", file.getName())
                    .put("size", file.length())
                    .put("date", m[1])
                    .put("duration", m[0] / 1000.0));
        }
        return new JSONObject().put("total", files.size()).put("offset", offset).put("items", items);
    }

    /** The movie file for an id, or null. */
    public File file(long id) {
        for (File file : files()) {
            if (id(file) == id) {
                return file;
            }
        }
        return null;
    }

    /** The camera's thumbnail beside the movie, or null. */
    public File thumbnail(long id) {
        File movie = file(id);
        if (movie == null) {
            return null;
        }
        File thm = sibling(movie, "THM");
        return thm.isFile() ? thm : null;
    }

    private static List<File> files() {
        List<File> result = new ArrayList<File>();
        File[] folders = ROOT.listFiles();
        if (folders == null) {
            return result;
        }
        for (File folder : folders) {
            File[] files = folder.isDirectory() && folder.getName().length() >= 3 ? folder.listFiles() : null;
            if (files == null) {
                continue;
            }
            for (File file : files) {
                if (file.isFile() && file.getName().toUpperCase(Locale.US).endsWith(".MP4") && id(file) >= 0) {
                    result.add(file);
                }
            }
        }
        return result;
    }

    /** 100ANV01/MAH04899.MP4 -> 1004899, or -1 for a name that isn't the camera's. */
    private static long id(File file) {
        String name = file.getName();
        int dot = name.lastIndexOf('.');
        try {
            int folder = Integer.parseInt(file.getParentFile().getName().substring(0, 3));
            int number = Integer.parseInt(name.substring(dot - 5, dot));
            return folder * 100000L + number;
        } catch (RuntimeException e) {
            return -1;
        }
    }

    private static File sibling(File file, String extension) {
        String name = file.getName();
        return new File(file.getParentFile(), name.substring(0, name.lastIndexOf('.') + 1) + extension);
    }

    private long[] meta(File file) {
        String key = file.getPath() + ":" + file.length() + ":" + file.lastModified();
        synchronized (metaCache) {
            long[] cached = metaCache.get(key);
            if (cached != null) {
                return cached;
            }
        }
        long duration = 0;
        try {
            duration = durationMs(file);
        } catch (IOException e) {
            Logger.error("Reading the length of " + file + " failed", e);
        }
        long date = thumbnailDate(sibling(file, "THM"));
        if (date <= 0) {
            date = file.lastModified();
        }
        long[] result = { duration, date };
        synchronized (metaCache) {
            metaCache.put(key, result);
        }
        return result;
    }

    /** Length from the MP4's movie header (moov/mvhd), reading only box headers. */
    static long durationMs(File file) throws IOException {
        RandomAccessFile in = new RandomAccessFile(file, "r");
        try {
            long moov = findBox(in, 0, in.length(), "moov");
            if (moov < 0) {
                return 0;
            }
            in.seek(moov);
            long moovEnd = moov + boxSize(in);
            long mvhd = findBox(in, moov + 8, moovEnd, "mvhd");
            if (mvhd < 0) {
                return 0;
            }
            in.seek(mvhd + 8);
            int version = in.readUnsignedByte();
            in.skipBytes(3);
            long timescale;
            long duration;
            if (version == 1) {
                in.skipBytes(16);
                timescale = in.readInt() & 0xffffffffL;
                duration = in.readLong();
            } else {
                in.skipBytes(8);
                timescale = in.readInt() & 0xffffffffL;
                duration = in.readInt() & 0xffffffffL;
            }
            return timescale > 0 ? duration * 1000 / timescale : 0;
        } finally {
            in.close();
        }
    }

    /** Offset of the first box of this type in [start, end), or -1. */
    private static long findBox(RandomAccessFile in, long start, long end, String type) throws IOException {
        long pos = start;
        while (pos + 8 <= end) {
            in.seek(pos);
            long size = boxSize(in);
            byte[] name = new byte[4];
            in.seek(pos + 4);
            in.readFully(name);
            if (type.equals(new String(name, "US-ASCII"))) {
                return pos;
            }
            if (size < 8) {
                return -1;
            }
            pos += size;
        }
        return -1;
    }

    /** Size of the box whose header starts at the current position; 64-bit sizes included. */
    private static long boxSize(RandomAccessFile in) throws IOException {
        long pos = in.getFilePointer();
        long size = in.readInt() & 0xffffffffL;
        if (size == 1) {
            in.seek(pos + 8);
            size = in.readLong();
        } else if (size == 0) {
            size = in.length() - pos;
        }
        return size;
    }

    /**
     * EXIF DateTime of the thumbnail ("2026:10:18 20:43:16", the camera's wall clock) as epoch ms
     * read as UTC, which is how photo dates are given too; 0 if not found.
     */
    private static long thumbnailDate(File thm) {
        if (!thm.isFile()) {
            return 0;
        }
        try {
            byte[] head = new byte[(int) Math.min(thm.length(), 2048)];
            FileInputStream in = new FileInputStream(thm);
            try {
                int read = 0;
                while (read < head.length) {
                    int n = in.read(head, read, head.length - read);
                    if (n < 0) {
                        break;
                    }
                    read += n;
                }
            } finally {
                in.close();
            }
            String text = new String(head, "ISO-8859-1");
            java.util.regex.Matcher m = java.util.regex.Pattern
                    .compile("(\\d{4}):(\\d\\d):(\\d\\d) (\\d\\d):(\\d\\d):(\\d\\d)").matcher(text);
            if (!m.find()) {
                return 0;
            }
            java.util.Calendar c = java.util.Calendar.getInstance(TimeZone.getTimeZone("UTC"));
            c.clear();
            c.set(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)) - 1, Integer.parseInt(m.group(3)),
                    Integer.parseInt(m.group(4)), Integer.parseInt(m.group(5)), Integer.parseInt(m.group(6)));
            return c.getTimeInMillis();
        } catch (IOException e) {
            return 0;
        } catch (RuntimeException e) {
            return 0;
        }
    }
}
