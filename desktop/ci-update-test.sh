#!/usr/bin/env bash
# Runs on a Windows and a Mac CI machine right after a release is published. It does what a person would do:
# installs the PREVIOUS version, opens it, presses "Update app", and checks the NEW version got installed
# and is running again — with nothing dragged or clicked by hand. If this passes, the Update button works.
set -euo pipefail
NEW="${GITHUB_REF_NAME#v}"
PREV=$(gh release list --repo "$GITHUB_REPOSITORY" --limit 6 --json tagName --jq '.[].tagName' | grep -v "^v${NEW}\$" | head -1 || true)
if [ -z "${PREV:-}" ]; then echo "no previous release - nothing to update from"; exit 0; fi
echo "updating from $PREV to v$NEW on $RUNNER_OS"
mkdir -p old

if [ "$RUNNER_OS" = "Windows" ]; then
  gh release download "$PREV" --repo "$GITHUB_REPOSITORY" --pattern "NextAlerts-Setup-*.exe" --dir old
  # started through PowerShell: launching the installer straight from Git Bash crashed once on the CI machine
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*" powershell -NoProfile -Command "Start-Process -FilePath (Get-ChildItem old/NextAlerts-Setup-*.exe)[0].FullName -ArgumentList '/S' -Wait"
  APP="$LOCALAPPDATA/Programs/nextalerts/NextAlerts.exe"
  for i in $(seq 1 30); do [ -f "$APP" ] && break; sleep 2; done
  ver() { powershell -NoProfile -Command "(Get-Item '$(cygpath -w "$APP")').VersionInfo.ProductVersion" | tr -d '\r' | sed 's/\.0$//'; }
  running() { tasklist | grep -i "NextAlerts.exe" | head -2; }
  "$APP" --remote-debugging-port=9444 &
else
  # the in-place Mac update exists from 1.0.4 on; older versions opened the dmg instead
  if [ "$(printf '%s\n' "1.0.4" "${PREV#v}" | sort -V | head -1)" != "1.0.4" ]; then echo "$PREV has no in-place Mac update - skipped"; exit 0; fi
  arch=$([ "$(uname -m)" = "arm64" ] && echo arm64 || echo x64)
  gh release download "$PREV" --repo "$GITHUB_REPOSITORY" --pattern "NextAlerts-*-$arch.dmg" --dir old
  mnt=$(mktemp -d)
  hdiutil attach old/*.dmg -nobrowse -readonly -mountpoint "$mnt"
  rm -rf /Applications/NextAlerts.app
  cp -R "$mnt/NextAlerts.app" /Applications/
  hdiutil detach "$mnt"
  APP="/Applications/NextAlerts.app"
  ver() { /usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Contents/Info.plist" 2>/dev/null || true; }
  running() { pgrep -fl "NextAlerts.app/Contents/MacOS/NextAlerts" | head -2; }
  "$APP/Contents/MacOS/NextAlerts" --remote-debugging-port=9444 &
fi

echo "installed: $(ver)"
sleep 20
node desktop/test-cdp.js 9444 "({ version: await window.nextalertsApp.version(), update: await window.nextalertsApp.checkUpdate() })"
node desktop/test-cdp.js 9444 "window.nextalertsApp.installUpdate()"

now=""
for i in $(seq 1 40); do
  sleep 5
  now=$(ver || true)
  [ "$now" = "$NEW" ] && break
done
echo "installed after update: ${now:-none}"
[ "$now" = "$NEW" ] || { echo "the update did not install"; exit 1; }
sleep 15
running || { echo "the app did not open again after the update"; exit 1; }
[ "$RUNNER_OS" = "Windows" ] || { [ ! -e "$APP.old" ] || { echo "a leftover copy of the old app was not cleaned up"; exit 1; }; codesign --verify --deep --strict "$APP"; }
echo "update test passed"
