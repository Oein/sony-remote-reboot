package dev.oein.ilceremote;

import android.app.Application;

public class App extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        Logger.info("=== App start " + BuildConfig.VERSION_NAME + " ===");

        final Thread.UncaughtExceptionHandler systemHandler = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
            @Override
            public void uncaughtException(Thread thread, Throwable e) {
                Logger.error("Uncaught exception in " + thread.getName(), e);
                if (systemHandler != null) {
                    systemHandler.uncaughtException(thread, e);
                }
            }
        });
    }
}
