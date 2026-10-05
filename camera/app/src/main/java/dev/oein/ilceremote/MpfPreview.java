package dev.oein.ilceremote;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;

/**
 * Extracts the preview image stored in a JPEG's MPF (APP2 "MPF\0") segment, if there is one.
 * Only the JPEG header and the preview bytes are read, so this is cheap even for 4 MB files.
 */
public final class MpfPreview {
    private static final int MAX_HEADER_SCAN = 256 * 1024;
    private static final int TAG_MP_ENTRY = 0xB002;

    private MpfPreview() {}

    /** Returns the first secondary MPF image, or null if the file has none. */
    public static byte[] extract(File jpeg) throws IOException {
        RandomAccessFile file = new RandomAccessFile(jpeg, "r");
        try {
            if (file.readUnsignedShort() != 0xFFD8) {
                return null;
            }
            long pos = 2;
            while (pos < MAX_HEADER_SCAN) {
                file.seek(pos);
                int marker = file.readUnsignedShort();
                if ((marker & 0xFF00) != 0xFF00 || marker == 0xFFDA) {
                    return null; // corrupt, or start of scan: no more metadata segments
                }
                int length = file.readUnsignedShort();
                if (marker == 0xFFE2 && length > 8) {
                    byte[] segment = new byte[length - 2];
                    file.readFully(segment);
                    if (segment[0] == 'M' && segment[1] == 'P' && segment[2] == 'F' && segment[3] == 0) {
                        // Offsets inside MPF are relative to the TIFF header right after "MPF\0"
                        long tiffStart = pos + 4 + 4;
                        return readSecondaryImage(file, segment, 4, tiffStart);
                    }
                }
                pos += 2 + length;
            }
            return null;
        } finally {
            file.close();
        }
    }

    private static byte[] readSecondaryImage(RandomAccessFile file, byte[] seg, int tiff, long tiffStart) throws IOException {
        boolean littleEndian = seg[tiff] == 'I';
        int ifd = tiff + u32(seg, tiff + 4, littleEndian);
        int count = u16(seg, ifd, littleEndian);
        for (int i = 0; i < count; i++) {
            int entry = ifd + 2 + 12 * i;
            if (u16(seg, entry, littleEndian) != TAG_MP_ENTRY) {
                continue;
            }
            int bytes = u32(seg, entry + 4, littleEndian);
            int table = tiff + u32(seg, entry + 8, littleEndian);
            // Each MP entry is 16 bytes: attribute, size, offset, 2x dependent image
            for (int e = 1; e < bytes / 16; e++) {
                int size = u32(seg, table + 16 * e + 4, littleEndian);
                int offset = u32(seg, table + 16 * e + 8, littleEndian);
                if (size > 0 && offset > 0) {
                    byte[] image = new byte[size];
                    file.seek(tiffStart + offset);
                    file.readFully(image);
                    return image;
                }
            }
        }
        return null;
    }

    private static int u16(byte[] b, int i, boolean le) {
        int b0 = b[i] & 0xff, b1 = b[i + 1] & 0xff;
        return le ? b0 | b1 << 8 : b0 << 8 | b1;
    }

    private static int u32(byte[] b, int i, boolean le) {
        return le ? u16(b, i, true) | u16(b, i + 2, true) << 16 : u16(b, i, false) << 16 | u16(b, i + 2, false);
    }
}
