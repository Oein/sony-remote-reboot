package dev.oein.ilceremote;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class ExitCompletedReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        // The camera sends this when the user leaves the app; kill the process so
        // background threads (HTTP server etc.) don't outlive it.
        Logger.flush();
        android.os.Process.killProcess(android.os.Process.myPid());
    }
}
