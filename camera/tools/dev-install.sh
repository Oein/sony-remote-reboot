#!/bin/sh
# Development loop over Wi-Fi: build, close the running app cleanly, install with adb, follow logs.
# The Sony launcher blocks `am start` from the shell, so the app has to be launched on the camera by hand.
# Needs: camera in Station mode, adb enabled in OpenMemories Tweak, debug build of ILCE Remote running.
# usage: CAMERA_IP=172.16.1.151 tools/dev-install.sh
set -e
cd "$(dirname "$0")/.."

: "${CAMERA_IP:?set CAMERA_IP to the camera address shown on screen}"
export ANDROID_SERIAL="$CAMERA_IP:5555"

./gradlew assembleDebug -q
APK=$(ls -t app/build/outputs/apk/debug/*.apk | head -1)

adb connect "$ANDROID_SERIAL" >/dev/null
# Killing the foreground app (what `adb install -r` does) can wedge the camera UI,
# so ask the running app to exit normally first, keeping Wi-Fi up.
if curl -fsS -m 5 "http://$CAMERA_IP:8080/api/debug/exit" >/dev/null 2>&1; then
    sleep 2
fi

echo "Installing $APK"
adb install -r "$APK"
adb logcat -c
echo "Launch ILCE Remote on the camera (Menu > Application)..."
until curl -fsS -m 2 "http://$CAMERA_IP:8080/api/info"; do sleep 1; done
echo
exec adb logcat -v time -s ILCERemote:V AndroidRuntime:E
