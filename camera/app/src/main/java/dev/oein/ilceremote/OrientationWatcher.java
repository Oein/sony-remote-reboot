package dev.oein.ilceremote;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;

import com.sony.scalar.hardware.avio.DisplayManager;

import java.util.List;

/**
 * Follows how the camera body is held (level, or turned for a portrait shot) so the phone can
 * turn the live view to match. Sony's display manager reports it on some models; this firmware
 * lacks that listener, so the accelerometer is used instead, as Sony's own apps do.
 */
final class OrientationWatcher {
    private static volatile int roll = -1;
    private static volatile int degrees = -1;

    /** Raw roll value from the display manager, or -1 if it never reported. */
    static int getRoll() {
        return roll;
    }

    /**
     * Clockwise turn (0, 90, 180, 270) that makes the live view upright, or -1 if unknown.
     */
    static int getDegrees() {
        return degrees;
    }

    /** Gravity along an axis must pass this (m/s², of 9.8) before the orientation changes. */
    private static final float THRESHOLD = 6.5f;

    private DisplayManager displayManager;
    private SensorManager sensors;
    private boolean loggedSensors;
    private int rawLogged;

    private final SensorEventListener accelerometer = new SensorEventListener() {
        @Override
        public void onSensorChanged(SensorEvent event) {
            // Readings point away from gravity: the axis that is up reads about +9.8
            float x = event.values[0];
            float y = event.values[1];
            if (BuildConfig.DEBUG && rawLogged++ < 5) {
                Logger.info("Sensor " + event.sensor.getType() + " x=" + x + " y=" + y + " z=" + event.values[2]);
            }
            int next = degrees;
            if (y > THRESHOLD) {
                next = 0;
            } else if (y < -THRESHOLD) {
                next = 180;
            } else if (x > THRESHOLD) {
                next = 270; // right side up: the scene's top is at the frame's right
            } else if (x < -THRESHOLD) {
                next = 90;
            }
            if (next != degrees) {
                Logger.info("Camera orientation " + next + " (accelerometer x=" + x + " y=" + y
                        + " z=" + event.values[2] + ")");
                degrees = next;
            }
        }

        @Override
        public void onAccuracyChanged(Sensor sensor, int accuracy) {
        }
    };

    /** Only keeps the magnetic sensor switched on, which the level sensors may need. */
    private final SensorEventListener idle = new SensorEventListener() {
        @Override
        public void onSensorChanged(SensorEvent event) {
        }

        @Override
        public void onAccuracyChanged(Sensor sensor, int accuracy) {
        }
    };

    void start(Context context) {
        try {
            displayManager = new DisplayManager();
            displayManager.setOrientationRollListener(new DisplayManager.OrientationRollListener() {
                @Override
                public void onChanged(int value) {
                    if (value != roll) {
                        Logger.info("Camera roll: " + value);
                    }
                    roll = value;
                }
            });
        } catch (Throwable t) {
            // NoClassDefFoundError on this firmware: the listener interface doesn't exist
            displayManager = null;
        }
        try {
            sensors = (SensorManager) context.getSystemService(Context.SENSOR_SERVICE);
            if (sensors != null && !loggedSensors) {
                loggedSensors = true;
                List<Sensor> all = sensors.getSensorList(Sensor.TYPE_ALL);
                StringBuilder names = new StringBuilder();
                for (Sensor sensor : all) {
                    names.append(' ').append(sensor.getName()).append(" (type ").append(sensor.getType()).append(')');
                }
                Logger.info("Sensors:" + (all.isEmpty() ? " none" : names));
                // The accelerometer HAL relays angles from the camera's main processor, which only
                // sends them on models with a digital level
                try {
                    Logger.info("Digital level: device=" + com.sony.scalar.sysutil.ScalarProperties.getInt(
                            com.sony.scalar.sysutil.ScalarProperties.PROP_DEVICE_DIGITAL_LEVEL)
                            + " ui=" + com.sony.scalar.sysutil.ScalarProperties.getInt(
                            com.sony.scalar.sysutil.ScalarProperties.PROP_UI_DIGITAL_LEVEL_TYPE));
                } catch (Throwable t) {
                    Logger.info("Digital level property unavailable: " + t);
                }
            }
            // As Sony's digital level does: accelerometer and magnetic field at game rate. The gravity
            // sensor (type 9) gives the same reading where the raw accelerometer stays silent.
            boolean registered = false;
            if (sensors != null) {
                for (int type : new int[] { Sensor.TYPE_ACCELEROMETER, Sensor.TYPE_GRAVITY, Sensor.TYPE_MAGNETIC_FIELD }) {
                    Sensor sensor = sensors.getDefaultSensor(type);
                    boolean ok = sensor != null && sensors.registerListener(
                            type == Sensor.TYPE_MAGNETIC_FIELD ? idle : accelerometer, sensor, SensorManager.SENSOR_DELAY_GAME);
                    Logger.info("Sensor " + type + (ok ? " listening" : " not available"));
                    registered |= ok && type != Sensor.TYPE_MAGNETIC_FIELD;
                }
            }
            if (!registered) {
                sensors = null;
            }
        } catch (Throwable t) {
            Logger.error("Accelerometer unavailable", t);
            sensors = null;
        }
    }

    void stop() {
        if (sensors != null) {
            sensors.unregisterListener(accelerometer);
            sensors.unregisterListener(idle);
            sensors = null;
        }
        if (displayManager != null) {
            try {
                displayManager.releaseOrientationRollListener();
                displayManager.finish();
            } catch (Throwable t) {
                Logger.error("Orientation listener release failed", t);
            }
            displayManager = null;
        }
    }
}
