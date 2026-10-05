#!/bin/sh
# Build the camera app and install it over USB with pmca-console.
# Camera: set USB Connection to "MTP" (or "Mass Storage"), connect, then run this.
set -e
cd "$(dirname "$0")/.."

PMCA=tools/pmca-console
if [ ! -x "$PMCA" ]; then
    echo "Downloading pmca-console v0.18 (x86_64, runs under Rosetta)..."
    curl -sL -o "$PMCA" https://github.com/ma1co/Sony-PMCA-RE/releases/download/v0.18/pmca-console-v0.18-osx
    chmod +x "$PMCA"
fi

BUILD_TYPE=${1:-debug}
./gradlew "assemble$(echo "$BUILD_TYPE" | awk '{print toupper(substr($0,1,1)) substr($0,2)}')"
APK=$(ls app/build/outputs/apk/"$BUILD_TYPE"/*.apk | head -1)
echo "Installing $APK"
# On macOS, libusb needs root to detach the kernel/ptpcamerad driver from the camera
sudo "$PMCA" install -f "$APK"
