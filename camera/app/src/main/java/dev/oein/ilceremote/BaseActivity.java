package dev.oein.ilceremote;

import android.app.Activity;
import android.content.Intent;
import android.util.SparseBooleanArray;
import android.view.KeyEvent;

import com.sony.scalar.sysutil.ScalarInput;

/**
 * Common behaviour every activity on the camera needs.
 *
 * Camera buttons arrive as Sony scan codes (ScalarInput.ISV_KEY_*), not as the usual Android
 * key codes, so an activity that doesn't handle them can never be left and the camera appears
 * frozen. The trash button always exits the app (as in PMCADemo); subclasses get every other
 * button through onCameraKeyDown/onCameraKeyUp.
 */
public abstract class BaseActivity extends Activity {
    /**
     * Keys pressed while this activity was in front. The key-up of the button that launched the
     * app (or closed a previous screen) arrives here too, and must not be treated as a press.
     */
    private final SparseBooleanArray pressedKeys = new SparseBooleanArray();

    @Override
    protected void onResume() {
        super.onResume();
        notifyAppInfo();
    }

    @Override
    protected void onPause() {
        super.onPause();
        pressedKeys.clear();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        int scanCode = event.getScanCode();
        if (BuildConfig.DEBUG && event.getRepeatCount() == 0) {
            Logger.info("key down scan=" + scanCode + " code=" + keyCode);
        }
        pressedKeys.put(scanCode, true);
        if (onCameraKeyDown(scanCode, event.getRepeatCount())) {
            return true;
        }
        if (isExitKey(keyCode, event)) {
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    /** Camera button pressed (or repeating); dials only send this. Return true if handled. */
    protected boolean onCameraKeyDown(int scanCode, int repeatCount) {
        return false;
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        int scanCode = event.getScanCode();
        if (!pressedKeys.get(scanCode)) {
            // Release of a key pressed before we came to the front: swallow it
            return true;
        }
        pressedKeys.delete(scanCode);

        // Act on key up so the matching key-up doesn't leak into the camera UI we return to
        if (isExitKey(keyCode, event)) {
            exitApp();
            return true;
        }
        if (onCameraKeyUp(scanCode)) {
            return true;
        }
        return super.onKeyUp(keyCode, event);
    }

    /** Camera button released; {@code scanCode} is one of ScalarInput.ISV_KEY_*. Return true if handled. */
    protected boolean onCameraKeyUp(int scanCode) {
        return false;
    }

    private static boolean isExitKey(int keyCode, KeyEvent event) {
        switch (event.getScanCode()) {
            case ScalarInput.ISV_KEY_DELETE:
            case ScalarInput.ISV_KEY_SK2:
                return true;
        }
        return keyCode == KeyEvent.KEYCODE_BACK;
    }

    /** Leaves the app and returns to the camera's shooting screen. */
    protected void exitApp() {
        finish();
        startActivity(new Intent(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_HOME)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }

    /** Keep the camera awake while the app is serving the viewer. */
    protected void setAutoPowerOffEnabled(boolean enabled) {
        Intent intent = new Intent("com.android.server.DAConnectionManagerService.apo");
        intent.putExtra("apo_info", enabled ? "APO/NORMAL" : "APO/NO");
        sendBroadcast(intent);
    }

    /** Tells the camera's app manager which activity is in the foreground (required for proper key/exit handling). */
    private void notifyAppInfo() {
        Intent intent = new Intent("com.android.server.DAConnectionManagerService.AppInfoReceive");
        intent.putExtra("package_name", getComponentName().getPackageName());
        intent.putExtra("class_name", getComponentName().getClassName());
        sendBroadcast(intent);
    }
}
