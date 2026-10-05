package dev.oein.ilceremote;

/** Battery and shots left as the shooting screen last read them, for the phone's status line. */
final class CameraStatus {
    /** 0..100, or -1 if unknown. */
    static volatile int batteryPercent = -1;
    /** Photos that still fit on the card at the current settings, or -1 if unknown. */
    static volatile int shotsLeft = -1;

    private CameraStatus() {}
}
