#!/bin/bash

# Android Build Script for Capacitor App
# Usage: ./build-android.sh [environment] [build-type]
#
# Environments: bundled-cf (default), bundled-hf, cloudflare, hf, local
# Build types: debug (default), release

set -e

ENV="${1:-bundled-cf}"
BUILD_TYPE="${2:-debug}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Building Android APK"
echo "  Environment: $ENV"
echo "  Build Type:  $BUILD_TYPE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Step 1: Build web assets
echo ""
echo "→ Building web assets..."
export CAPACITOR_SERVER_IP_ENV="$ENV"
npm run build

# Step 2: Sync to Android
echo ""
echo "→ Syncing to Android..."
npx cap sync android

# Step 3: Build APK
echo ""
echo "→ Building APK..."
cd android
chmod +x gradlew

if [ "$BUILD_TYPE" = "release" ]; then
    ./gradlew assembleRelease
    APK_PATH="app/build/outputs/apk/release/app-release-unsigned.apk"
else
    ./gradlew assembleDebug
    APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
fi

cd ..

# Done
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✓ Build Complete!"
echo "  APK: android/$APK_PATH"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Optional: Copy to easy location
if [ -f "android/$APK_PATH" ]; then
    cp "android/$APK_PATH" "./app-$ENV-$BUILD_TYPE.apk"
    echo "  Copied to: ./app-$ENV-$BUILD_TYPE.apk"
fi
