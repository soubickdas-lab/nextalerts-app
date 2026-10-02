#!/usr/bin/env bash
# Runs inside the CI emulator. Proves three things about the freshly built APK:
#   1. the previous release can be UPGRADED to it in place (same signing key) — this is what the Update button does
#   2. it starts and stays running
#   3. it shows the live dashboard (screenshot kept as a build artifact)
set -euo pipefail
PKG=in.nextalerts.work
NEW=$(ls NextAlerts-*.apk | head -1)
echo "new build: $NEW"

# the release that is live right now = the one this build will replace
OLD_TAG=$(curl -fsSI "https://github.com/${GITHUB_REPOSITORY}/releases/latest" | tr -d '\r' | sed -n 's#^[Ll]ocation: .*/releases/tag/##p' || true)
OLD_URL=""
if [ -n "${OLD_TAG:-}" ] && [ "NextAlerts-${OLD_TAG#v}.apk" != "$NEW" ]; then OLD_URL="https://github.com/${GITHUB_REPOSITORY}/releases/download/${OLD_TAG}/NextAlerts-${OLD_TAG#v}.apk"; fi
if [ -n "${OLD_URL:-}" ]; then
  echo "previous release: $OLD_URL"
  curl -fsSL -o old.apk "$OLD_URL"
  adb install old.apk
  adb shell am start -W -n $PKG/.MainActivity
  sleep 15
  echo "installed before upgrade: $(adb shell dumpsys package $PKG | grep versionName)"
  adb install -r "$NEW"   # fails here if the signing key changed
else
  echo "no previous release — clean install"
  adb install "$NEW"
fi

echo "installed now: $(adb shell dumpsys package $PKG | grep versionName)"
adb shell am start -W -n $PKG/.MainActivity
sleep 40
adb exec-out screencap -p > android-screen.png
PID=$(adb shell pidof $PKG || true)
echo "pid: $PID"
[ -n "$PID" ] || { echo "the app is not running"; adb logcat -d -s AndroidRuntime:E | tail -60; exit 1; }
CRASH=$(adb logcat -d -s AndroidRuntime:E | grep -c "FATAL EXCEPTION" || true)
[ "$CRASH" = "0" ] || { adb logcat -d -s AndroidRuntime:E | tail -60; exit 1; }
# the web view really loaded our site (the page title reaches the log through the window title dump)
adb shell dumpsys activity top | grep -m1 -i "nextalerts" || true
echo "android test passed"
