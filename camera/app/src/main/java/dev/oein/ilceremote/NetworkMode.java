package dev.oein.ilceremote;

/** A way of getting the camera onto a network the viewer can reach. Wi-Fi itself is switched on/off by the activity. */
public interface NetworkMode {
    interface Listener {
        /** Progress / diagnostic line for the camera screen. */
        void onStatus(String status);

        /** The camera is reachable at {@code ip}; {@code details} is shown to the user (SSID, password, ...). */
        void onReady(String ip, String details);
    }

    String getName();

    void start(Listener listener);

    void stop();
}
