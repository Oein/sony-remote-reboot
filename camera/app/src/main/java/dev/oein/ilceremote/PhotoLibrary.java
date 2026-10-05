package dev.oein.ilceremote;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.net.Uri;
import android.os.Environment;
import android.os.StatFs;

import com.sony.scalar.graphics.AvindexGraphics;

import com.sony.scalar.media.AvindexContentInfo;
import com.sony.scalar.provider.AvindexStore;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;

/**
 * Photos on the memory card, via the camera's own media index (AvindexStore).
 *
 * Sizes per photo:
 *  - thumb:   EXIF thumbnail from the camera, always 160x120 (letterboxed for non-4:3 photos)
 *  - small:   ~480 px long edge, made here from the preview, rotated upright and cached on the card
 *  - preview: the MPF preview Sony embeds in its JPEGs (e.g. 1920x1080), bytes passed through
 *  - full:    the original JPEG/ARW file
 * thumb/preview/full are NOT rotated: clients apply the EXIF orientation from {@link #details}.
 *
 * Unlike OpenMemories' ImageInfo, every cursor and AvindexContentInfo is closed/recycled here;
 * leaking one per photo would exhaust the camera's cursor limit on a full card.
 */
public class PhotoLibrary {
    private static final Uri URI = AvindexStore.Images.Media.EXTERNAL_CONTENT_URI;

    private static final int SMALL_LONG_EDGE = 480;
    private static final int SMALL_QUALITY = 75;
    /** Grid thumbnails: a few KB each. */
    private static final int MICRO_LONG_EDGE = 200;
    private static final int MICRO_QUALITY = 70;
    private static final File SMALL_CACHE = new File(Environment.getExternalStorageDirectory(), "ILCEREMO/THUMB");

    private final ContentResolver resolver;
    /** Decoding is memory hungry on the camera; make small thumbnails one at a time. */
    private final Object generateLock = new Object();

    public PhotoLibrary(Context context) {
        resolver = context.getApplicationContext().getContentResolver();
    }

    /**
     * Newest first: {"total": n, "offset": o, "items": [{id, folder, file, date, jpeg, raw}, ...]}.
     * {@code folder}/{@code file} are the DCF numbers (100MSDCF/_DSC4765 -> 100, 4765); the file name
     * prefix depends on settings, so the exact name is only in {@link #details}. {@code date} is the
     * camera's local wall-clock time as epoch milliseconds.
     */
    public JSONObject list(int offset, int limit) throws JSONException {
        String[] projection = {
                AvindexStore.Images.Media._ID,
                AvindexStore.Images.Media.DCF_FOLDER_NUMBER,
                AvindexStore.Images.Media.DCF_FILE_NUMBER,
                AvindexStore.Images.Media.CONTENT_CREATED_LOCAL_DATE_TIME,
                AvindexStore.Images.Media.EXIST_JPEG,
                AvindexStore.Images.Media.EXIST_RAW,
                AvindexStore.Images.Media.DATA,
        };
        String order = AvindexStore.Images.Media.CONTENT_CREATED_UTC_DATE_TIME + " DESC, "
                + AvindexStore.Images.Media._ID + " DESC";
        JSONObject result = new JSONObject();
        JSONArray items = new JSONArray();
        java.util.Map<Integer, java.util.Set<Integer>> onCard = filesOnCard();
        java.util.Set<Long> seen = new java.util.HashSet<Long>();
        Cursor cursor = resolver.query(URI, projection, null, null, order);
        if (cursor == null) {
            throw new IllegalStateException("AvindexStore query failed");
        }
        try {
            int listed = 0;
            int dropped = 0;
            result.put("offset", offset);
            while (cursor.moveToNext()) {
                // The index keeps entries for files that are gone (deleted on a computer, card
                // swapped), and can hold one photo twice: list only files that are on the card
                int folder = cursor.getInt(1);
                int number = cursor.getInt(2);
                java.util.Set<Integer> files = onCard.get(folder);
                if (files == null || !files.contains(number) || !seen.add(folder * 100000L + number)) {
                    dropped++;
                    continue;
                }
                if (listed++ < offset || items.length() >= limit) {
                    continue;
                }
                {
                    JSONObject item = new JSONObject();
                    item.put("id", cursor.getLong(0));
                    item.put("folder", cursor.getInt(1));
                    item.put("file", cursor.getInt(2));
                    item.put("date", cursor.getLong(3));
                    item.put("jpeg", cursor.getInt(4) != 0);
                    item.put("raw", cursor.getInt(5) != 0);
                    item.put("key", cursor.getString(6));
                    items.put(item);
                }
            }
            result.put("total", listed);
            if (dropped != lastDropped) {
                lastDropped = dropped;
                Logger.info("Photos: " + listed + " on the card, " + dropped + " index entries without a file");
            }
        } finally {
            cursor.close();
        }
        result.put("items", items);
        return result;
    }

    private static int lastDropped = -1;

    /**
     * DCF numbers of the photo files on the card: folder number (100 for 100MSDCF) -> file numbers
     * (4765 for _DSC4765.JPG / .ARW). One directory listing per folder, so it is cheap.
     */
    private static java.util.Map<Integer, java.util.Set<Integer>> filesOnCard() {
        java.util.Map<Integer, java.util.Set<Integer>> result = new java.util.HashMap<Integer, java.util.Set<Integer>>();
        File[] folders = new File(Environment.getExternalStorageDirectory(), "DCIM").listFiles();
        if (folders == null) {
            return result;
        }
        for (File folder : folders) {
            String folderName = folder.getName();
            String[] names = folder.isDirectory() ? folder.list() : null;
            if (names == null || folderName.length() < 3) {
                continue;
            }
            int folderNumber;
            try {
                folderNumber = Integer.parseInt(folderName.substring(0, 3));
            } catch (NumberFormatException e) {
                continue;
            }
            java.util.Set<Integer> numbers = new java.util.HashSet<Integer>();
            for (String name : names) {
                String upper = name.toUpperCase(java.util.Locale.US);
                int dot = upper.lastIndexOf('.');
                if (dot < 4 || !(upper.endsWith(".JPG") || upper.endsWith(".ARW"))) {
                    continue;
                }
                try {
                    numbers.add(Integer.parseInt(upper.substring(dot - 4, dot)));
                } catch (NumberFormatException e) {
                    // Not a DCF photo name
                }
            }
            result.put(folderNumber, numbers);
        }
        return result;
    }

    /** Shooting details from the index, or null if there is no such photo. */
    public JSONObject details(long id) throws JSONException {
        AvindexContentInfo info = AvindexStore.Images.Media.getImageInfo(resolver, URI, id);
        if (info == null) {
            return null;
        }
        try {
            JSONObject json = new JSONObject();
            json.put("id", id);
            json.put("name", info.getAttribute(AvindexContentInfo.TAG_DCF_TBL_FILE_NAME));
            json.put("folder", info.getAttribute(AvindexContentInfo.TAG_DCF_TBL_DIR_NAME));
            json.put("date", info.getAttribute(AvindexContentInfo.TAG_DATETIME));
            json.put("width", info.getAttributeInt(AvindexContentInfo.TAG_IMAGE_WIDTH, 0));
            json.put("height", info.getAttributeInt(AvindexContentInfo.TAG_IMAGE_LENGTH, 0));
            json.put("orientation", info.getAttributeInt(AvindexContentInfo.TAG_ORIENTATION, 0));
            json.put("aperture", info.getAttributeDouble(AvindexContentInfo.TAG_APERTURE, 0));
            json.put("exposureTime", info.getAttributeDouble(AvindexContentInfo.TAG_EXPOSURE_TIME, 0));
            json.put("focalLength", info.getAttributeDouble(AvindexContentInfo.TAG_FOCAL_LENGTH, 0));
            json.put("iso", info.getAttributeInt(AvindexContentInfo.TAG_ISO, 0));
            return json;
        } finally {
            info.recycle();
        }
    }

    /** EXIF thumbnail JPEG and the photo's EXIF orientation, from one index lookup; null if none. */
    public Object[] thumbnailWithOrientation(long id) {
        AvindexContentInfo info = AvindexStore.Images.Media.getImageInfo(resolver, URI, id);
        if (info == null) {
            return null;
        }
        try {
            byte[] jpeg = info.hasThumbnail() ? info.getThumbnail() : null;
            return jpeg == null ? null
                    : new Object[] { jpeg, info.getAttributeInt(AvindexContentInfo.TAG_ORIENTATION, 1) };
        } finally {
            info.recycle();
        }
    }

    /** EXIF thumbnail JPEG, or null. */
    public byte[] thumbnail(long id) {
        AvindexContentInfo info = AvindexStore.Images.Media.getImageInfo(resolver, URI, id);
        if (info == null) {
            return null;
        }
        try {
            return info.hasThumbnail() ? info.getThumbnail() : null;
        } finally {
            info.recycle();
        }
    }

    /** Large preview JPEG, or null. */
    public byte[] preview(long id) {
        File jpeg = file(id, "JPG");
        if (jpeg != null) {
            try {
                byte[] image = MpfPreview.extract(jpeg);
                if (image != null) {
                    return image;
                }
            } catch (IOException e) {
                Logger.error("MPF preview failed for " + jpeg, e);
            }
        }
        String key = indexKey(id);
        byte[] image = key == null ? null : AvindexGraphics.getScreenNail(key);
        if (image == null) {
            Logger.info("No preview for photo " + id);
        }
        return image;
    }

    /** Where a photo lives on the card, and how it is rotated. */
    private static final class Location {
        final String folder;
        final String name;
        final int orientation;

        Location(String folder, String name, int orientation) {
            this.folder = folder;
            this.name = name;
            this.orientation = orientation;
        }

        File file(String extension) {
            String base = name.substring(0, name.lastIndexOf('.') + 1);
            return new File(Environment.getExternalStorageDirectory(), "DCIM/" + folder + "/" + base + extension);
        }

        /**
         * 8.3 name unique on the card: DCF folder number + file number, e.g. 100MSDCF/_DSC4768.JPG
         * -> "1004768". The camera mounts the card without long file name support.
         */
        /** "100MSDCF" -> 100 */
        int folderNumber() {
            return Integer.parseInt(folder.substring(0, 3));
        }

        /** "_DSC4765.JPG" -> 4765 */
        int fileNumber() {
            String base = name.substring(0, name.lastIndexOf('.'));
            return Integer.parseInt(base.substring(base.length() - 4));
        }

        String shortKey() {
            String base = name.substring(0, name.lastIndexOf('.'));
            return folder.substring(0, 3) + base.substring(base.length() - 4);
        }
    }

    private Location locate(long id) {
        AvindexContentInfo info = AvindexStore.Images.Media.getImageInfo(resolver, URI, id);
        if (info == null) {
            return null;
        }
        try {
            String folder = info.getAttribute(AvindexContentInfo.TAG_DCF_TBL_DIR_NAME);
            String name = info.getAttribute(AvindexContentInfo.TAG_DCF_TBL_FILE_NAME);
            if (folder == null || name == null || name.lastIndexOf('.') < 0) {
                return null;
            }
            return new Location(folder, name, info.getAttributeInt(AvindexContentInfo.TAG_ORIENTATION, 1));
        } finally {
            info.recycle();
        }
    }

    /**
     * The photo's file on the card with the given extension ("JPG" or "ARW"), or null.
     * The index's DATA column is an internal key, not a path, so the path is rebuilt from the
     * DCF folder and file name.
     */
    public File file(long id, String extension) {
        Location location = locate(id);
        if (location == null) {
            return null;
        }
        File file = location.file(extension);
        return file.isFile() && file.canRead() ? file : null;
    }

    /** The cached {@link #small} JPEG if it was made before, without making it now; null otherwise. */
    public byte[] cachedSmall(long id) throws IOException {
        Location location = locate(id);
        if (location == null) {
            return null;
        }
        File cached = new File(SMALL_CACHE, location.shortKey() + ".JPG");
        return cached.isFile() ? readFile(cached) : null;
    }

    /** Upright JPEG, ~{@value #SMALL_LONG_EDGE} px on the long edge, cached on the card. Null if unavailable. */
    public byte[] small(long id) throws IOException {
        Location location = locate(id);
        if (location == null) {
            return null;
        }
        File cached = new File(SMALL_CACHE, location.shortKey() + ".JPG");
        synchronized (generateLock) {
            if (cached.isFile()) {
                return readFile(cached);
            }
            long start = System.currentTimeMillis();
            byte[] source = preview(id);
            if (source == null) {
                source = thumbnail(id);
            }
            if (source == null) {
                return null;
            }
            byte[] jpeg = shrink(source, location.orientation, SMALL_LONG_EDGE, SMALL_QUALITY);
            if (jpeg == null) {
                return null;
            }
            writeFileAtomically(cached, jpeg);
            Logger.info("Made small thumbnail for " + location.name + ": " + jpeg.length + " bytes in "
                    + (System.currentTimeMillis() - start) + " ms");
            return jpeg;
        }
    }

    /**
     * Cache file of a micro thumbnail, named by DCF folder and file number (both in every list
     * item), so a cached one is found without the slow index lookup. 8.3 name, e.g. T1004765.JPG.
     */
    private static File microFile(int folder, int file) {
        return new File(SMALL_CACHE, String.format(java.util.Locale.US, "T%03d%04d.JPG", folder, file));
    }

    /** The cached micro thumbnail, or null; never generates (and never touches the index). */
    public byte[] cachedMicro(int folder, int file) throws IOException {
        File cached = microFile(folder, file);
        return cached.isFile() ? readFile(cached) : null;
    }

    /**
     * Upright micro thumbnail (~{@value #MICRO_LONG_EDGE} px long edge, a few KB) made from the
     * preview, which keeps the photo's own aspect ratio unlike the letterboxed EXIF thumbnail.
     */
    public byte[] micro(long id) throws IOException {
        Location location = locate(id);
        if (location == null) {
            return null;
        }
        File cached = microFile(location.folderNumber(), location.fileNumber());
        synchronized (generateLock) {
            if (cached.isFile()) {
                return readFile(cached);
            }
            byte[] source = preview(id);
            if (source == null) {
                source = thumbnail(id);
            }
            byte[] jpeg = source == null ? null : shrink(source, location.orientation, MICRO_LONG_EDGE, MICRO_QUALITY);
            if (jpeg != null) {
                writeFileAtomically(cached, jpeg);
            }
            return jpeg;
        }
    }

    /** True if a micro thumbnail is cached for these DCF numbers. */
    public static boolean hasMicro(int folder, int file) {
        return microFile(folder, file).isFile();
    }

    private static byte[] shrink(byte[] source, int orientation, int longEdgeTarget, int quality) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(source, 0, source.length, bounds);
        int longEdge = Math.max(bounds.outWidth, bounds.outHeight);
        if (longEdge <= 0) {
            return null;
        }

        // Let libjpeg drop resolution while decoding (cheap), then scale the rest exactly
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = 1;
        while (longEdge / (options.inSampleSize * 2) >= longEdgeTarget) {
            options.inSampleSize *= 2;
        }
        Bitmap decoded = BitmapFactory.decodeByteArray(source, 0, source.length, options);
        if (decoded == null) {
            return null;
        }
        Matrix matrix = new Matrix();
        float scale = Math.min(1f, (float) longEdgeTarget / Math.max(decoded.getWidth(), decoded.getHeight()));
        matrix.postScale(scale, scale);
        switch (orientation) {
            case 3: matrix.postRotate(180); break;
            case 6: matrix.postRotate(90); break;
            case 8: matrix.postRotate(270); break;
            default: break;
        }
        Bitmap result = Bitmap.createBitmap(decoded, 0, 0, decoded.getWidth(), decoded.getHeight(), matrix, true);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        result.compress(Bitmap.CompressFormat.JPEG, quality, out);
        if (result != decoded) {
            result.recycle();
        }
        decoded.recycle();
        return out.toByteArray();
    }

    private static byte[] readFile(File file) throws IOException {
        byte[] data = new byte[(int) file.length()];
        FileInputStream in = new FileInputStream(file);
        try {
            int read = 0;
            while (read < data.length) {
                int n = in.read(data, read, data.length - read);
                if (n < 0) {
                    throw new IOException("Unexpected end of " + file);
                }
                read += n;
            }
        } finally {
            in.close();
        }
        return data;
    }

    /**
     * Write to a temp file first so a power-off mid-write never leaves a truncated cache entry.
     * {@code file} must have an 8.3 name ending in an extension; the temp file swaps it for .TMP.
     */
    private static void writeFileAtomically(File file, byte[] data) throws IOException {
        File dir = file.getParentFile();
        if (!dir.isDirectory() && !dir.mkdirs()) {
            throw new IOException("Cannot create " + dir);
        }
        String name = file.getName();
        File tmp = new File(dir, name.substring(0, name.lastIndexOf('.')) + ".TMP");
        FileOutputStream out = new FileOutputStream(tmp);
        try {
            out.write(data);
        } finally {
            out.close();
        }
        if (!tmp.renameTo(file)) {
            tmp.delete();
            throw new IOException("Cannot rename " + tmp);
        }
    }

    /** Bytes per shot, measured on the newest photo; keyed by its id so it is only redone after a new shot. */
    private long shotBytes;
    private long shotBytesForId = -1;

    /**
     * Shots that still fit on the card: free space / size of the newest shot (JPG + ARW), like the
     * camera's own counter. Falls back to typical ILCE-5000 sizes when the card has no photos yet.
     */
    public int shotsLeft(String storageFormat) {
        StatFs fs = new StatFs(Environment.getExternalStorageDirectory().getPath());
        @SuppressWarnings("deprecation")
        long free = (long) fs.getAvailableBlocks() * fs.getBlockSize();

        long newest = newestId();
        if (newest != shotBytesForId) {
            shotBytesForId = newest;
            shotBytes = 0;
            Location location = newest < 0 ? null : locate(newest);
            if (location != null) {
                shotBytes = location.file("JPG").length() + location.file("ARW").length();
            }
        }
        long perShot = shotBytes;
        if (perShot <= 0) {
            boolean raw = storageFormat != null && storageFormat.contains("raw");
            boolean jpeg = storageFormat == null || storageFormat.contains("jpeg");
            perShot = (raw ? 21L << 20 : 0) + (jpeg ? 5L << 20 : 0);
        }
        return (int) Math.min(Integer.MAX_VALUE, free / perShot);
    }

    private long newestId() {
        Cursor cursor = resolver.query(URI, new String[] { AvindexStore.Images.Media._ID }, null, null,
                AvindexStore.Images.Media._ID + " DESC");
        if (cursor == null) {
            return -1;
        }
        try {
            return cursor.moveToFirst() ? cursor.getLong(0) : -1;
        } finally {
            cursor.close();
        }
    }

    /** The media index's internal key for a photo (what AvindexGraphics and friends take), or null. */
    public String indexKeyFor(long id) {
        return indexKey(id);
    }

    private String indexKey(long id) {
        Cursor cursor = resolver.query(URI, new String[] { AvindexStore.Images.Media.DATA },
                AvindexStore.Images.Media._ID + "=?", new String[] { Long.toString(id) }, null);
        if (cursor == null) {
            return null;
        }
        try {
            return cursor.moveToFirst() ? cursor.getString(0) : null;
        } finally {
            cursor.close();
        }
    }
}
