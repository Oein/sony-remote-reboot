package dev.oein.ilceremote;

import android.annotation.SuppressLint;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;

import com.sony.wifi.direct.DirectConfiguration;
import com.sony.wifi.direct.DirectManager;

import java.util.List;

/** Camera becomes a Wi-Fi access point (Wi-Fi Direct group owner), like the built-in "Send to Smartphone". */
public class AccessPointMode implements NetworkMode {
    /** The camera's fixed address as group owner. */
    public static final String IP_ADDRESS = "192.168.122.1";

    private final Context context;
    private final DirectManager directManager;
    private Listener listener;

    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (listener == null) {
                return;
            }
            String action = intent.getAction();
            if (DirectManager.DIRECT_STATE_CHANGED_ACTION.equals(action)) {
                int state = intent.getIntExtra(DirectManager.EXTRA_DIRECT_STATE, DirectManager.DIRECT_STATE_UNKNOWN);
                if (state == DirectManager.DIRECT_STATE_ENABLED) {
                    createGroup();
                }
            } else if (DirectManager.GROUP_CREATE_SUCCESS_ACTION.equals(action)) {
                DirectConfiguration config = intent.getParcelableExtra(DirectManager.EXTRA_DIRECT_CONFIG);
                listener.onReady(IP_ADDRESS, "SSID: " + config.getSsid() + "\nPassword: " + config.getPreSharedKey());
            } else if (DirectManager.GROUP_CREATE_FAILURE_ACTION.equals(action)) {
                listener.onStatus("Failed to start access point");
            } else if (DirectManager.STA_CONNECTED_ACTION.equals(action)) {
                listener.onStatus("Client connected: " + intent.getStringExtra(DirectManager.EXTRA_STA_ADDR));
            } else if (DirectManager.STA_DISCONNECTED_ACTION.equals(action)) {
                listener.onStatus("Client disconnected: " + intent.getStringExtra(DirectManager.EXTRA_STA_ADDR));
            }
        }
    };

    @SuppressLint("WrongConstant") // "wifi-direct" is a Sony-specific system service
    public AccessPointMode(Context context) {
        this.context = context;
        directManager = (DirectManager) context.getSystemService(DirectManager.WIFI_DIRECT_SERVICE);
    }

    @Override
    public String getName() {
        return "Access Point";
    }

    @Override
    public void start(Listener listener) {
        this.listener = listener;
        listener.onStatus("Starting access point...");
        IntentFilter filter = new IntentFilter();
        filter.addAction(DirectManager.DIRECT_STATE_CHANGED_ACTION);
        filter.addAction(DirectManager.GROUP_CREATE_SUCCESS_ACTION);
        filter.addAction(DirectManager.GROUP_CREATE_FAILURE_ACTION);
        filter.addAction(DirectManager.STA_CONNECTED_ACTION);
        filter.addAction(DirectManager.STA_DISCONNECTED_ACTION);
        context.registerReceiver(receiver, filter);
        if (directManager.isDirectEnabled()) {
            createGroup();
        } else {
            directManager.setDirectEnabled(true);
        }
    }

    @Override
    public void stop() {
        if (listener != null) {
            context.unregisterReceiver(receiver);
            directManager.setDirectEnabled(false);
            listener = null;
        }
    }

    private void createGroup() {
        // Reuse the persistent group the camera created for "Send to Smartphone", so the
        // SSID/password stay the same and the phone can remember the network.
        List<DirectConfiguration> configs = directManager.getConfigurations();
        if (configs == null || configs.isEmpty()) {
            listener.onStatus("No saved AP config; creating a new one");
            directManager.startGo(DirectManager.PERSISTENT_GO);
        } else {
            directManager.startGo(configs.get(configs.size() - 1).getNetworkId());
        }
    }
}
