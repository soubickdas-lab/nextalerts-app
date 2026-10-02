#!/usr/bin/env bash
# Runs on a Windows CI machine right after a release is published. It does what a person would do:
# installs the PREVIOUS version, opens it, presses "Update app", and checks the NEW version got installed
# and is running again. If this passes, the Update button works for everyone.
set -euo pipefail
NEW="${GITHUB_REF_NAME#v}"
PREV=$(gh release list --repo "$GITHUB_REPOSITORY" --limit 6 --json tagName --jq '.[].tagName' | grep -v "^v${NEW}\$" | head -1 || true)
if [ -z "${PREV:-}" ]; then echo "no previous release - nothing to update from"; exit 0; fi
echo "updating from $PREV to v$NEW"

mkdir -p old
gh release download "$PREV" --repo "$GITHUB_REPOSITORY" --pattern "NextAlerts-Setup-*.exe" --dir old
MSYS_NO_PATHCONV=1 ./old/NextAlerts-Setup-*.exe /S
APP="$LOCALAPPDATA/Programs/nextalerts/NextAlerts.exe"
for i in $(seq 1 30); do [ -f "$APP" ] && break; sleep 2; done
ver() { powershell -NoProfile -Command "(Get-Item '$(cygpath -w "$APP")').VersionInfo.ProductVersion" | tr -d '\r'; }
echo "installed: $(ver)"

"$APP" --remote-debugging-port=9444 &
sleep 20
node desktop/test-cdp.js 9444 "({ version: await window.nextalertsApp.version(), update: await window.nextalertsApp.checkUpdate() })"
node desktop/test-cdp.js 9444 "window.nextalertsApp.installUpdate()"

for i in $(seq 1 40); do
  sleep 5
  now=$(ver || true)
  if [ "$now" = "$NEW" ] || [ "$now" = "$NEW.0" ]; then break; fi
done
echo "installed after update: ${now:-none}"
if [ "$now" != "$NEW" ] && [ "$now" != "$NEW.0" ]; then echo "the update did not install"; exit 1; fi
sleep 15
tasklist | grep -i "NextAlerts.exe" | head -3 || { echo "the app did not open again after the update"; exit 1; }
echo "update test passed"
