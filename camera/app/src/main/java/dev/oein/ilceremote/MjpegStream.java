package dev.oein.ilceremote;

import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;

/**
 * Body of a multipart/x-mixed-replace (MJPEG) response: one part per live view frame, forever.
 * NanoHTTPD pulls from this on the connection's thread and closes it when the client goes away.
 */
public class MjpegStream extends InputStream {
    public static final String BOUNDARY = "ilceframe";
    public static final String CONTENT_TYPE = "multipart/x-mixed-replace; boundary=" + BOUNDARY;
    private static final long FRAME_TIMEOUT_MS = 5000;

    private final LiveView liveView;
    private long lastSeq;
    private byte[] header = new byte[0];
    private byte[] jpeg = new byte[0];
    private int pos;
    private boolean closed;

    public MjpegStream(LiveView liveView) {
        this.liveView = liveView;
        liveView.addClient();
    }

    @Override
    public int read() throws IOException {
        byte[] one = new byte[1];
        return read(one, 0, 1) == -1 ? -1 : one[0] & 0xff;
    }

    @Override
    public int read(byte[] buffer, int offset, int length) throws IOException {
        if (pos >= header.length + jpeg.length && !nextFrame()) {
            return -1;
        }
        int n = 0;
        if (pos < header.length) {
            n = Math.min(length, header.length - pos);
            System.arraycopy(header, pos, buffer, offset, n);
        } else {
            int p = pos - header.length;
            n = Math.min(length, jpeg.length - p);
            System.arraycopy(jpeg, p, buffer, offset, n);
        }
        pos += n;
        return n;
    }

    private boolean nextFrame() throws IOException {
        if (closed) {
            return false;
        }
        LiveView.Frame frame;
        try {
            frame = liveView.awaitFrame(lastSeq, FRAME_TIMEOUT_MS);
        } catch (InterruptedException e) {
            throw new InterruptedIOException();
        }
        if (frame == null) {
            // Live view stopped (app paused) or stalled: end the stream, the client can reconnect
            return false;
        }
        lastSeq = frame.seq;
        // The CRLF before the boundary terminates the previous part
        header = ("\r\n--" + BOUNDARY + "\r\n"
                + "Content-Type: image/jpeg\r\n"
                + "Content-Length: " + frame.jpeg.length + "\r\n"
                + "X-Frame: " + frame.seq + "\r\n\r\n").getBytes("US-ASCII");
        jpeg = frame.jpeg;
        pos = 0;
        return true;
    }

    @Override
    public void close() {
        if (!closed) {
            closed = true;
            liveView.removeClient();
        }
    }
}
