package dev.oein.ilceremote;

import android.os.Handler;

import com.sony.scalar.hardware.CameraEx;
import com.sony.scalar.media.MediaRecorder;
import com.sony.scalar.provider.AvindexStore;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.List;

/**
 * Movie recording with Sony's MediaRecorder.
 *
 * The camera is opened for stills, so recording reopens it in movie mode (keeping the shooting
 * settings) and recording to the memory card; stopping reopens it for stills again. Direct shutter
 * stays off while in movie mode: with it on the firmware cancels the app's own captures.
 * Format and quality are the camera's own movie settings. UI thread only, except {@link #state}.
 */
final class MovieRecorder {
    interface Listener {
        /** Status or recording time changed. UI thread. */
        void onMovieChanged();
    }

    static final int IDLE = 0;
    static final int STARTING = 1;
    static final int RECORDING = 2;
    static final int STOPPING = 3;

    /** Reopening and starting take a moment; past this something is stuck. */
    private static final long START_TIMEOUT_MS = 10000;
    private static final long STOP_TIMEOUT_MS = 5000;
    private static final long DIRECT_SHUTTER_TIMEOUT_MS = 1000;

    private final LiveView liveView;
    private final ShootingControls controls;
    private final Handler handler = new Handler();
    private Listener listener;
    private MediaRecorder recorder;
    /** Bumped per start, so a late callback or timeout of an earlier attempt is ignored. */
    private int attempt;

    private volatile int status = IDLE;
    private volatile int seconds;
    private volatile int remainSeconds = -1;
    private volatile String error;

    MovieRecorder(LiveView liveView, ShootingControls controls) {
        this.liveView = liveView;
        this.controls = controls;
    }

    void setListener(Listener listener) {
        this.listener = listener;
    }

    int getStatus() {
        return status;
    }

    /** Busy with a movie: recording, or switching the camera to or from movie mode. */
    boolean isActive() {
        return status != IDLE;
    }

    int getSeconds() {
        return seconds;
    }

    /** Recording time left on the card, -1 until the recorder reports it. */
    int getRemainSeconds() {
        return remainSeconds;
    }

    /** {status: idle|starting|recording|stopping, seconds, remainSeconds (-1 unknown), error}. Any thread. */
    JSONObject state() throws JSONException {
        int s = status;
        JSONObject state = new JSONObject()
                .put("status", s == STARTING ? "starting" : s == RECORDING ? "recording" : s == STOPPING ? "stopping" : "idle")
                .put("seconds", seconds)
                .put("remainSeconds", remainSeconds);
        if (error != null) {
            state.put("error", error);
        }
        return state;
    }

    void toggle() {
        if (status == IDLE) {
            start();
        } else if (status == RECORDING) {
            stop();
        }
    }

    void start() {
        CameraEx camera = liveView.getCamera();
        if (status != IDLE || camera == null) {
            return;
        }
        final int id = ++attempt;
        error = null;
        seconds = 0;
        remainSeconds = -1;
        setStatus(STARTING);
        Logger.info("Movie: starting");
        // Beeps before recording and after it, so the movie itself stays clean
        Beeper.start();
        controls.magnifier().stop();
        handler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (id == attempt && status == STARTING) {
                    fail("start timed out");
                }
            }
        }, START_TIMEOUT_MS);

        // The callback may never come if direct shutter is already off, hence the timeout
        final boolean[] stopped = { false };
        final Runnable reopen = new Runnable() {
            @Override
            public void run() {
                if (stopped[0] || id != attempt || status != STARTING) {
                    return;
                }
                stopped[0] = true;
                try {
                    reopenForMovie(id);
                } catch (Throwable t) {
                    Logger.error("Movie: switching to movie mode failed", t);
                    fail(t.toString());
                }
            }
        };
        try {
            camera.stopDirectShutter(new CameraEx.DirectShutterStoppedCallback() {
                @Override
                public void onShutterStopped(CameraEx cameraEx) {
                    handler.post(reopen);
                }
            });
        } catch (Throwable t) {
            Logger.error("Movie: stopDirectShutter failed", t);
        }
        handler.postDelayed(reopen, DIRECT_SHUTTER_TIMEOUT_MS);
    }

    private void reopenForMovie(final int id) {
        liveView.reopen(true, new LiveView.ReopenCallback() {
            @Override
            public void onReopened(CameraEx camera) {
                if (id != attempt || status != STARTING) {
                    return;
                }
                if (camera == null) {
                    fail("movie mode unavailable");
                } else {
                    controls.forgetCamera();
                    startRecorder(camera);
                }
            }
        });
    }

    private void startRecorder(CameraEx camera) {
        final int id = attempt;
        try {
            MediaRecorder r = new MediaRecorder();
            LiveView.logMethodsOnce(MediaRecorder.class);
            LiveView.logMethodsOnce(MediaRecorder.Parameters.class);
            recorder = r;
            r.setCamera(camera);
            // Audio before video as in Android; the firmware refused it after video (Inhibited).
            // Sound is optional: past both orders the movie is recorded silent.
            boolean audio = setAudioSource(r, "before video");
            r.setVideoSource(MediaRecorder.VideoSource.CAMERA);
            if (!audio) {
                setAudioSource(r, "after video");
            }
            String[] media = AvindexStore.getExternalMediaIds();
            if (media != null && media.length > 0) {
                r.setOutputMedia(media[0]);
            }
            MediaRecorder.Parameters params = r.getParameters();
            Logger.info("Movie: parameters " + params.flatten() + ", media " + (media != null && media.length > 0 ? media[0] : "none"));
            logProfiles(r);
            r.setOnRecordListener(new MediaRecorder.OnRecordListener() {
                @Override
                public void onStarted(final boolean success, MediaRecorder mr) {
                    post(id, new Runnable() {
                        @Override
                        public void run() {
                            if (status != STARTING) {
                                return;
                            }
                            if (success) {
                                Logger.info("Movie: recording");
                                setStatus(RECORDING);
                            } else {
                                fail("recording did not start");
                            }
                        }
                    });
                }

                @Override
                public void onStopped(MediaRecorder mr) {
                    post(id, new Runnable() {
                        @Override
                        public void run() {
                            Logger.info("Movie: stopped after " + seconds + " s"
                                    + (status == STOPPING ? "" : " by the camera, remaining " + remainSeconds + " s"));
                            finish();
                        }
                    });
                }
            });
            r.setOnRecTimeListener(new MediaRecorder.OnRecTimeListener() {
                @Override
                public void onChanged(final int time, MediaRecorder mr) {
                    post(id, new Runnable() {
                        @Override
                        public void run() {
                            seconds = time;
                            notifyListener();
                        }
                    });
                }
            });
            r.setOnRecRemainListener(new MediaRecorder.OnRecRemainListener() {
                @Override
                public void onChanged(final int remain, MediaRecorder mr) {
                    post(id, new Runnable() {
                        @Override
                        public void run() {
                            if (remainSeconds < 0) {
                                Logger.info("Movie: remaining " + remain + " s");
                            }
                            remainSeconds = remain;
                            notifyListener();
                        }
                    });
                }
            });
            r.setOnErrorListener(new MediaRecorder.OnErrorListener() {
                @Override
                public void onError(final int what, MediaRecorder mr) {
                    post(id, new Runnable() {
                        @Override
                        public void run() {
                            fail("recorder error " + what);
                        }
                    });
                }
            });
            r.prepare();
            r.start();
        } catch (Throwable t) {
            Logger.error("Movie: start failed", t);
            fail(t.toString());
        }
    }

    private static boolean setAudioSource(MediaRecorder r, String when) {
        try {
            r.setAudioSource(MediaRecorder.AudioSource.CAMCORDER);
            Logger.info("Movie: audio source set " + when);
            return true;
        } catch (Throwable t) {
            Logger.info("Movie: audio source refused " + when + ": " + t);
            return false;
        }
    }

    private static void logProfiles(MediaRecorder r) {
        try {
            List<?> profiles = r.getSupportedParameters().getSupportedCamcoderProfiles();
            StringBuilder text = new StringBuilder();
            if (profiles != null) {
                for (Object o : profiles) {
                    if (o instanceof MediaRecorder.CamcorderProfile) {
                        MediaRecorder.CamcorderProfile p = (MediaRecorder.CamcorderProfile) o;
                        text.append(' ').append(p.outputFormat).append('/').append(p.videoSize).append('/')
                                .append(p.videoFrameRate).append('/').append(p.videoEncodingBitRate);
                    }
                }
            }
            Logger.info("Movie: profiles" + text);
        } catch (Throwable t) {
            Logger.error("Movie: reading profiles failed", t);
        }
    }

    void stop() {
        if (status != RECORDING) {
            return;
        }
        final int id = attempt;
        setStatus(STOPPING);
        Logger.info("Movie: stopping");
        handler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (id == attempt && status == STOPPING) {
                    Logger.info("Movie: no stop callback");
                    finish();
                }
            }
        }, STOP_TIMEOUT_MS);
        try {
            recorder.stop();
        } catch (Throwable t) {
            Logger.error("Movie: stop failed", t);
            finish();
        }
    }

    /** Leaving the app: stop at once; the camera is about to be released, so no reopen. */
    void abort() {
        if (status == IDLE) {
            return;
        }
        Logger.info("Movie: aborted");
        attempt++;
        if (status == RECORDING || status == STOPPING) {
            try {
                recorder.stop();
            } catch (Throwable t) {
                Logger.error("Movie: stop failed", t);
            }
        }
        releaseRecorder();
        setStatus(IDLE);
    }

    private void fail(String reason) {
        Logger.info("Movie: failed: " + reason);
        error = reason;
        finish();
    }

    /** Releases the recorder and returns the camera to stills. */
    private void finish() {
        if (status == IDLE) {
            return;
        }
        final int id = ++attempt;
        boolean recorded = status == RECORDING || status == STOPPING;
        releaseRecorder();
        setStatus(STOPPING);
        if (recorded) {
            Beeper.stop();
        }
        liveView.reopen(false, new LiveView.ReopenCallback() {
            @Override
            public void onReopened(CameraEx camera) {
                if (id != attempt) {
                    return;
                }
                controls.forgetCamera();
                setStatus(IDLE);
            }
        });
    }

    private void releaseRecorder() {
        if (recorder == null) {
            return;
        }
        try {
            recorder.reset();
        } catch (Throwable t) {
            Logger.error("Movie: reset failed", t);
        }
        try {
            recorder.release();
        } catch (Throwable t) {
            Logger.error("Movie: release failed", t);
        }
        recorder = null;
    }

    /** Recorder callbacks may come on another thread; this runs them on ours, if still current. */
    private void post(final int id, final Runnable task) {
        handler.post(new Runnable() {
            @Override
            public void run() {
                if (id == attempt) {
                    try {
                        task.run();
                    } catch (Throwable t) {
                        Logger.error("Movie: callback failed", t);
                        fail(t.toString());
                    }
                }
            }
        });
    }

    private void setStatus(int status) {
        this.status = status;
        notifyListener();
    }

    private void notifyListener() {
        if (listener != null) {
            listener.onMovieChanged();
        }
    }
}
