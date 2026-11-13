package dev.oein.ilceremote;

import android.media.AudioFormat;
import android.media.ToneGenerator;

/**
 * Short beeps for starting and stopping a movie.
 *
 * Sony exposes no beep API to apps, so which audio path reaches the speaker is unverified; the
 * method can be switched from /api/debug/beep until one is known to work. Plays on its own thread.
 */
final class Beeper {
    static final String TONE = "tone";
    static final String TRACK = "track";
    static final String SONY = "sony";

    private static final int RATE = 48000;
    private static final int FREQUENCY = 2400;
    private static final int BEEP_MS = 90;
    private static final int GAP_MS = 70;

    private static volatile String method = TONE;
    private static boolean loggedSettings;

    private Beeper() {
    }

    static void setMethod(String m) {
        method = m;
    }

    static String getMethod() {
        return method;
    }

    /** One beep when recording starts. */
    static void start() {
        play(method, 1);
    }

    /** Two beeps when it stops. */
    static void stop() {
        play(method, 2);
    }

    static void play(final String m, final int count) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    logSettings();
                    if (SONY.equals(m)) {
                        playSony(count);
                    } else if (TRACK.equals(m)) {
                        playTrack(count);
                    } else {
                        playTone(count);
                    }
                } catch (Throwable t) {
                    Logger.error("Beep (" + m + ") failed", t);
                }
            }
        }, "Beeper").start();
    }

    private static void playTone(int count) throws InterruptedException {
        ToneGenerator tone = new ToneGenerator(android.media.AudioManager.STREAM_SYSTEM, ToneGenerator.MAX_VOLUME);
        try {
            for (int i = 0; i < count; i++) {
                tone.startTone(ToneGenerator.TONE_PROP_BEEP, BEEP_MS);
                Thread.sleep(BEEP_MS + GAP_MS);
            }
        } finally {
            tone.release();
        }
    }

    private static void playTrack(int count) throws InterruptedException {
        byte[] pcm = pcm(count, 1);
        android.media.AudioTrack track = new android.media.AudioTrack(android.media.AudioManager.STREAM_SYSTEM, RATE,
                AudioFormat.CHANNEL_CONFIGURATION_MONO, AudioFormat.ENCODING_PCM_16BIT, pcm.length,
                android.media.AudioTrack.MODE_STATIC);
        try {
            track.write(pcm, 0, pcm.length);
            track.play();
            Thread.sleep(durationMs(count) + 100);
        } finally {
            track.release();
        }
    }

    private static void playSony(int count) throws InterruptedException {
        byte[] pcm = pcm(count, 2);
        // Constructor arguments are guessed from the constants: rate, channel, format, mode
        com.sony.scalar.media.AudioTrack track = new com.sony.scalar.media.AudioTrack(RATE,
                com.sony.scalar.media.AudioTrack.CHANNEL_STEREO, com.sony.scalar.media.AudioTrack.FORMAT_PCM_16BIT,
                com.sony.scalar.media.AudioTrack.MODE_STREAM);
        try {
            Logger.info("Beep: sony track state " + track.getState() + ", rate " + track.getSampleRate()
                    + ", frame " + track.getFrameSize() + ", max buffer " + track.getMaxAudioBufferSize());
            track.play();
            track.write(pcm, 0, pcm.length, true);
            Thread.sleep(durationMs(count) + 100);
            track.stop();
        } finally {
            track.release();
        }
    }

    private static int durationMs(int count) {
        return count * BEEP_MS + (count - 1) * GAP_MS;
    }

    /** Sine beeps with short fades, 16-bit little endian. */
    private static byte[] pcm(int count, int channels) {
        int beep = RATE * BEEP_MS / 1000;
        int gap = RATE * GAP_MS / 1000;
        int frames = count * beep + (count - 1) * gap;
        int fade = RATE / 200;
        byte[] out = new byte[frames * channels * 2];
        for (int b = 0; b < count; b++) {
            int offset = b * (beep + gap);
            for (int i = 0; i < beep; i++) {
                double envelope = Math.min(1.0, Math.min(i, beep - 1 - i) / (double) fade);
                short v = (short) (Math.sin(2 * Math.PI * FREQUENCY * i / RATE) * 26000 * envelope);
                for (int c = 0; c < channels; c++) {
                    int p = ((offset + i) * channels + c) * 2;
                    out[p] = (byte) v;
                    out[p + 1] = (byte) (v >> 8);
                }
            }
        }
        return out;
    }

    /** The camera's own beep setting, logged once to see what the firmware offers. */
    private static void logSettings() {
        if (loggedSettings) {
            return;
        }
        loggedSettings = true;
        com.sony.scalar.media.AudioManager manager = null;
        try {
            manager = new com.sony.scalar.media.AudioManager();
            Logger.info("Beep: audio settings " + manager.getParameters().flatten());
        } catch (Throwable t) {
            Logger.error("Beep: reading audio settings failed", t);
        } finally {
            if (manager != null) {
                try {
                    manager.release();
                } catch (Throwable ignored) {
                }
            }
        }
    }
}
