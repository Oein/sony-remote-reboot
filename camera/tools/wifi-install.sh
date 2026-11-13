#!/bin/sh
# Install over a flaky Wi-Fi link: the APK goes to the card in small pieces, each retried until it
# lands, then pm installs it there. (A plain `adb install` loses the whole push when the link drops.)
# Best run with ILCE Remote closed and OpenMemories Tweak (adb on) in front, so nothing turns Wi-Fi off.
# usage: CAMERA_IP=172.16.1.153 tools/wifi-install.sh [apk]
set -e
cd "$(dirname "$0")/.."

: "${CAMERA_IP:?set CAMERA_IP to the camera address}"
export ANDROID_SERIAL="$CAMERA_IP:5555"
APK=${1:-$(ls -t app/build/outputs/apk/debug/*.apk | head -1)}
REMOTE=/sdcard/ILCEREMO/upload
PARTS=$(mktemp -d)
trap 'rm -rf "$PARTS"' EXIT

retry() {
    for i in 1 2 3 4 5 6 7 8 9 10; do
        if "$@"; then return 0; fi
        echo "  retry $i: $*" >&2
        adb reconnect offline >/dev/null 2>&1 || true
        adb connect "$ANDROID_SERIAL" >/dev/null 2>&1 || true
        sleep 2
    done
    return 1
}

# Leave a running ILCE Remote through its own exit, which keeps Wi-Fi up (debug builds only)
curl -fsS -m 5 "http://$CAMERA_IP:8080/api/debug/exit" >/dev/null 2>&1 && sleep 2 || true

adb connect "$ANDROID_SERIAL" >/dev/null 2>&1 || true
echo "Uploading $APK"
split -b 131072 "$APK" "$PARTS/part."
retry adb shell "rm -r $REMOTE 2>/dev/null; mkdir -p $REMOTE"
for part in "$PARTS"/part.*; do
    name=$(basename "$part")
    size=$(wc -c < "$part" | tr -d ' ')
    # Pushed again until the card holds the whole piece
    tries=0
    until [ "$(adb shell "ls -l $REMOTE/$name" 2>/dev/null | awk '{print $4}')" = "$size" ]; do
        tries=$((tries + 1))
        [ $tries -le 10 ] || { echo; echo "Gave up on $name: the camera is unreachable"; exit 1; }
        retry adb push "$part" "$REMOTE/$name" >/dev/null 2>&1 || true
    done
    printf '.'
done
echo
retry adb shell "cat $REMOTE/part.* > $REMOTE/app.apk"
want=$(wc -c < "$APK" | tr -d ' ')
got=$(adb shell "ls -l $REMOTE/app.apk" | awk '{print $4}')
[ "$got" = "$want" ] || { echo "Size mismatch on the card: $got != $want"; exit 1; }
echo "Installing"
retry adb shell "pm install -r $REMOTE/app.apk" | tr -d '\r'
adb shell "rm -r $REMOTE" >/dev/null 2>&1 || true
