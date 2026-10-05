package dev.oein.ilceremote;

import android.hardware.Camera;
import android.os.Handler;
import android.os.SystemClock;
import android.view.SurfaceHolder;

import com.sony.scalar.hardware.CameraEx;
import com.sony.scalar.hardware.CameraSequence;
import com.sony.scalar.hardware.DeviceMemory;

import org.json.JSONObject;

import java.lang.reflect.Method;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Live view frames for the viewer.
 *
 * The camera's preview pipeline hands out frames that are already JPEG-encoded by the hardware
 * (CameraSequence.getPreviewSequenceFrames -> DeviceBuffer), so a frame costs ~10 ms to fetch and
 * nothing to encode. Frames are only pulled while at least one client is watching.
 *
 * All camera calls happen on the UI thread (the only way verified to work); HTTP threads just
 * wait for the next frame via {@link #awaitFrame}.
 */
public class LiveView implements SurfaceHolder.Callback {
    // Defaults as in Sony's own Smart Remote (its "M" live view size)
    private int frameWidth = 640;
    /** 0: follow the photo's aspect ratio (640x427 for 3:2, 640x360 for 16:9). */
    private int frameHeight = 0;
    /** CameraSequence.Options.PREVIEW_FRAME_RATE in 1/1000 fps, or 0 to leave the camera default. */
    private int frameRate = 30000;
    private long frameIntervalMs = 1000 / 15;

    /** A JPEG frame and its sequence number (increasing, starts at 1). */
    public static final class Frame {
        public final long seq;
        public final byte[] jpeg;

        Frame(long seq, byte[] jpeg) {
            this.seq = seq;
            this.jpeg = jpeg;
        }
    }

    private final Handler handler = new Handler();
    private CameraEx cameraEx;
    private CameraSequence sequence;
    private SurfaceHolder surfaceHolder;

    private final Object lock = new Object();
    private Frame latest;
    private int clients;
    private boolean running;
    private boolean pumping;

    // Stats since the last stats() call (UI thread only)
    private int statAttempts;
    private int statEmpty;
    private int statPublished;
    private long statGrabMs;
    private long statSince = SystemClock.uptimeMillis();

    // DeviceBuffer (the runtime type of preview frames) is not in the OpenMemories stubs
    private static Method getSizeMethod;
    private static Method readMethod;

    /** Opens the camera; the preview starts once {@code holder}'s surface exists. Call from onResume. */
    public void start(SurfaceHolder holder) {
        try {
            cameraEx = CameraEx.open(0, null);
        } catch (Throwable t) {
            Logger.error("LiveView: CameraEx.open failed", t);
            return;
        }
        surfaceHolder = holder;
        holder.addCallback(this);
        if (holder.getSurface() != null && holder.getSurface().isValid()) {
            surfaceCreated(holder);
        }
    }

    /** Stops streaming and releases the camera. Call from onPause. */
    public void stop() {
        handler.removeCallbacks(pump);
        pumping = false;
        if (surfaceHolder != null) {
            surfaceHolder.removeCallback(this);
            surfaceHolder = null;
        }
        stopSequence();
        if (cameraEx != null) {
            try {
                cameraEx.getNormalCamera().stopPreview();
            } catch (Throwable t) {
                Logger.error("LiveView: stopPreview failed", t);
            }
            try {
                cameraEx.release();
            } catch (Throwable t) {
                Logger.error("LiveView: release failed", t);
            }
            cameraEx = null;
        }
        synchronized (lock) {
            running = false;
            latest = null;
            lock.notifyAll();
        }
        Logger.info("LiveView stopped");
    }

    @Override
    public void surfaceCreated(SurfaceHolder holder) {
        if (cameraEx == null || sequence != null) {
            return;
        }
        try {
            Camera camera = cameraEx.getNormalCamera();
            applyPreviewEffect();
            camera.setPreviewDisplay(holder);
            camera.startPreview();
            // Let the physical shutter button work as in the camera's own UI (half-press AF etc.)
            cameraEx.startDirectShutter();
            startSequence();
        } catch (Throwable t) {
            Logger.error("LiveView: start failed", t);
            stopSequence();
            return;
        }
        synchronized (lock) {
            running = true;
            if (clients > 0) {
                startPumping();
            }
        }
    }

    private void startSequence() {
        sequence = CameraSequence.open(cameraEx);
        CameraSequence.Options options = new CameraSequence.Options();
        options.setOption(CameraSequence.Options.PREVIEW_FRAME_MAX_NUM, 1);
        options.setOption(CameraSequence.Options.PREVIEW_FRAME_WIDTH, frameWidth);
        options.setOption(CameraSequence.Options.PREVIEW_FRAME_HEIGHT, frameHeight);
        if (frameRate > 0) {
            options.setOption(CameraSequence.Options.PREVIEW_FRAME_RATE, frameRate);
        }
        // JPEG frames, compressed like Smart Remote's: rate 1/15, at most 100 KB
        options.setOption("PREVIEW_FRAME_FORMAT", 0x100);
        options.setOption("JPEG_COMPRESS_RATE_DENOM", 15);
        options.setOption("JPEG_COMPRESS_MAX_SIZE", 100);
        sequence.startPreviewSequence(options);
        Logger.info("LiveView sequence started " + frameWidth + "x" + frameHeight + " rate=" + frameRate);
    }

    /** Work to run on the UI thread with the open camera. */
    public interface CameraTask<T> {
        T run(CameraEx camera) throws Exception;
    }

    /**
     * Runs {@code task} on the UI thread with the open camera and returns its result.
     * Any thread except the UI thread. Throws IllegalStateException if the camera is not open.
     */
    public <T> T call(final CameraTask<T> task, long timeoutMs) throws Exception {
        final Object[] result = new Object[1];
        final Exception[] error = new Exception[1];
        final CountDownLatch done = new CountDownLatch(1);
        handler.post(new Runnable() {
            @Override
            public void run() {
                try {
                    if (cameraEx == null) {
                        throw new IllegalStateException("Camera not open");
                    }
                    result[0] = task.run(cameraEx);
                } catch (Exception e) {
                    error[0] = e;
                } catch (Throwable t) {
                    // e.g. NoSuchMethodError: a stub method this firmware doesn't have
                    error[0] = new RuntimeException(t);
                }
                done.countDown();
            }
        });
        if (!done.await(timeoutMs, TimeUnit.MILLISECONDS)) {
            throw new IllegalStateException("Camera call timed out");
        }
        if (error[0] != null) {
            throw error[0];
        }
        @SuppressWarnings("unchecked")
        T value = (T) result[0];
        return value;
    }

    /**
     * Debug: restart the preview sequence with other options, to experiment without reinstalling.
     * Any thread; returns a description of the new configuration or the error.
     */
    public String reconfigure(final int width, final int height, final int rate, final long intervalMs) throws InterruptedException {
        final String[] result = new String[1];
        final CountDownLatch done = new CountDownLatch(1);
        handler.post(new Runnable() {
            @Override
            public void run() {
                try {
                    if (width > 0 && height >= 0) { // height 0: follow the photo aspect
                        frameWidth = width;
                        frameHeight = height;
                    }
                    if (rate >= 0) {
                        frameRate = rate;
                    }
                    if (intervalMs > 0) {
                        frameIntervalMs = intervalMs;
                    }
                    if (sequence != null) {
                        stopSequence();
                        startSequence();
                    }
                    result[0] = "size=" + frameWidth + "x" + frameHeight + " rate=" + frameRate + " interval=" + frameIntervalMs + "ms";
                } catch (Throwable t) {
                    Logger.error("LiveView: reconfigure failed", t);
                    result[0] = "failed: " + t;
                }
                done.countDown();
            }
        });
        done.await(5, TimeUnit.SECONDS);
        return result[0];
    }

    /** Debug: grab statistics since the previous call. Any thread. */
    public String stats() throws InterruptedException {
        final String[] result = new String[1];
        final CountDownLatch done = new CountDownLatch(1);
        handler.post(new Runnable() {
            @Override
            public void run() {
                long now = SystemClock.uptimeMillis();
                double seconds = (now - statSince) / 1000.0;
                result[0] = String.format(Locale.US, "%.1fs: attempts=%d (%.1f/s) empty=%d published=%d (%.1f fps) avgGrab=%dms clients=%d",
                        seconds, statAttempts, statAttempts / seconds, statEmpty, statPublished, statPublished / seconds,
                        statAttempts == 0 ? 0 : statGrabMs / statAttempts, clients);
                statAttempts = statEmpty = statPublished = 0;
                statGrabMs = 0;
                statSince = now;
                done.countDown();
            }
        });
        done.await(5, TimeUnit.SECONDS);
        return result[0];
    }

    @Override
    public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {}

    @Override
    public void surfaceDestroyed(SurfaceHolder holder) {}

    /** The open camera, or null. UI thread only. */
    private volatile boolean previewEffect = true;

    /** Show exposure (aperture, shutter, ISO) in the live view, like the camera's "Setting Effect ON". */
    public void setPreviewEffect(boolean on) {
        previewEffect = on;
        if (cameraEx != null) {
            applyPreviewEffect();
        }
    }

    public boolean getPreviewEffect() {
        return previewEffect;
    }

    private void applyPreviewEffect() {
        try {
            JSONObject change = new JSONObject();
            change.put("liveViewEffect", previewEffect);
            CameraSettings.apply(cameraEx, change);
        } catch (Throwable t) {
            Logger.error("LiveView: setting the preview effect failed", t);
        }
    }

    public CameraEx getCamera() {
        return cameraEx;
    }

    /** Number of viewers currently pulling frames. */
    public int getClientCount() {
        synchronized (lock) {
            return clients;
        }
    }

    public boolean isRunning() {
        synchronized (lock) {
            return running;
        }
    }

    /** Registers a watching client; frames are pulled while any client is registered. Any thread. */
    public void addClient() {
        synchronized (lock) {
            clients++;
            if (running) {
                startPumping();
            }
        }
    }

    public void removeClient() {
        synchronized (lock) {
            clients--;
        }
    }

    /**
     * Blocks until a frame newer than {@code afterSeq} is available.
     * Returns null if live view is not running or nothing arrived within {@code timeoutMs}.
     */
    public Frame awaitFrame(long afterSeq, long timeoutMs) throws InterruptedException {
        long deadline = SystemClock.uptimeMillis() + timeoutMs;
        synchronized (lock) {
            while (running && (latest == null || latest.seq <= afterSeq)) {
                long remaining = deadline - SystemClock.uptimeMillis();
                if (remaining <= 0) {
                    return null;
                }
                lock.wait(remaining);
            }
            return running ? latest : null;
        }
    }

    /** Caller holds {@link #lock}. */
    private void startPumping() {
        if (!pumping) {
            pumping = true;
            handler.post(pump);
        }
    }

    private final Runnable pump = new Runnable() {
        @Override
        public void run() {
            synchronized (lock) {
                if (!running || clients <= 0) {
                    pumping = false;
                    return;
                }
            }
            long start = SystemClock.uptimeMillis();
            byte[] jpeg = grab();
            statAttempts++;
            statGrabMs += SystemClock.uptimeMillis() - start;
            if (jpeg == null) {
                statEmpty++;
            } else {
                statPublished++;
                synchronized (lock) {
                    latest = new Frame(latest == null ? 1 : latest.seq + 1, jpeg);
                    lock.notifyAll();
                }
            }
            long elapsed = SystemClock.uptimeMillis() - start;
            handler.postDelayed(this, Math.max(0, frameIntervalMs - elapsed));
        }
    };

    private byte[] grab() {
        if (sequence == null) {
            return null;
        }
        DeviceMemory[] frames = null;
        try {
            frames = sequence.getPreviewSequenceFrames(1);
            if (frames == null || frames.length == 0 || frames[0] == null) {
                return null;
            }
            DeviceMemory frame = frames[0];
            if (getSizeMethod == null) {
                getSizeMethod = frame.getClass().getMethod("getSize");
                readMethod = frame.getClass().getMethod("read", byte[].class);
            }
            byte[] data = new byte[(Integer) getSizeMethod.invoke(frame)];
            readMethod.invoke(frame, data);
            return data;
        } catch (Throwable t) {
            Logger.error("LiveView: grab failed", t);
            return null;
        } finally {
            if (frames != null) {
                for (DeviceMemory f : frames) {
                    if (f != null) {
                        f.release();
                    }
                }
            }
        }
    }

    private void stopSequence() {
        if (sequence != null) {
            try {
                sequence.stopPreviewSequence();
            } catch (Throwable t) {
                Logger.error("LiveView: stopPreviewSequence failed", t);
            }
            try {
                sequence.release();
            } catch (Throwable t) {
                Logger.error("LiveView: sequence release failed", t);
            }
            sequence = null;
        }
    }
}
