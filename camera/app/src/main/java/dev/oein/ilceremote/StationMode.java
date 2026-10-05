package dev.oein.ilceremote;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.NetworkInfo;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.text.format.Formatter;

/** Camera joins an existing Wi-Fi network saved in the camera's own Wi-Fi settings. */
public class StationMode implements NetworkMode {
    private final Context context;
    private final WifiManager wifiManager;
    private Listener listener;

    private final BroadcastReceiver networkStateReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            NetworkInfo info = intent.getParcelableExtra(WifiManager.EXTRA_NETWORK_INFO);
            networkStateChanged(info.getDetailedState());
        }
    };

    public StationMode(Context context) {
        this.context = context;
        wifiManager = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
    }

    @Override
    public String getName() {
        return "Station";
    }

    @Override
    public void start(Listener listener) {
        this.listener = listener;
        listener.onStatus("Connecting to saved Wi-Fi...");
        // Sticky-ish: if we are already connected no broadcast may come, so check right away
        context.registerReceiver(networkStateReceiver, new IntentFilter(WifiManager.NETWORK_STATE_CHANGED_ACTION));
        WifiInfo info = wifiManager.getConnectionInfo();
        if (info != null && info.getIpAddress() != 0) {
            connected();
        }
    }

    @Override
    public void stop() {
        if (listener != null) {
            context.unregisterReceiver(networkStateReceiver);
            listener = null;
        }
    }

    private void networkStateChanged(NetworkInfo.DetailedState state) {
        if (listener == null) {
            return;
        }
        String ssid = wifiManager.getConnectionInfo().getSSID();
        switch (state) {
            case CONNECTING:
                if (ssid != null) {
                    listener.onStatus(ssid + ": connecting");
                }
                break;
            case AUTHENTICATING:
                listener.onStatus(ssid + ": authenticating");
                break;
            case OBTAINING_IPADDR:
                listener.onStatus(ssid + ": obtaining IP");
                break;
            case CONNECTED:
                connected();
                break;
            case DISCONNECTED:
                listener.onStatus("Disconnected");
                break;
            case FAILED:
                listener.onStatus("Connection failed");
                break;
            default:
                break;
        }
    }

    private void connected() {
        WifiInfo info = wifiManager.getConnectionInfo();
        @SuppressWarnings("deprecation")
        String ip = Formatter.formatIpAddress(info.getIpAddress());
        listener.onReady(ip, "SSID: " + info.getSSID());
    }
}
