#!/usr/bin/env bash
# Install the pr-helper-git launchd LaunchAgent (P2-9, D-008): a persistent
# headless server that survives crashes (KeepAlive) and restarts at login
# (RunAtLoad), with the automation engine schedulers enabled.
#
#   bash launchd/install.sh            # install + start
#   PR_HELPER_GIT_AUTOMATION=0 bash launchd/install.sh   # install without the engine
#
# The agent binds 127.0.0.1:4789 — the canonical product port. Stop it
# (`bash launchd/uninstall.sh`) before running `npm run dev`, which wants the
# same port, or pass PR_HELPER_GIT_AGENT_PORT to pick another one.

set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"

NODE_BIN="${PR_HELPER_GIT_NODE:-$(command -v node)}"
if [ -z "$NODE_BIN" ]; then
  echo "install.sh: no node binary found (set PR_HELPER_GIT_NODE=/path/to/node)" >&2
  exit 1
fi

LABEL="local.pr-helper-git.server"
PORT="${PR_HELPER_GIT_AGENT_PORT:-4789}"
LOG_DIR="$HOME/Library/Logs/pr-helper-git"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
AUTOMATION="${PR_HELPER_GIT_AUTOMATION:-1}"

mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "install.sh: port $PORT already in use (dev server? another instance?)." >&2
  echo "Stop it first, or set PR_HELPER_GIT_AGENT_PORT=<other>." >&2
  exit 1
fi

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${REPO}/server/main.mjs</string>
    <string>--port=${PORT}</string>
  </array>
  <key>WorkingDirectory</key><string>${REPO}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PR_HELPER_GIT_AUTOMATION</key><string>${AUTOMATION}</string>
  </dict>
  <key>StandardOutPath</key><string>${LOG_DIR}/server.out.log</string>
  <key>StandardErrorPath</key><string>${LOG_DIR}/server.err.log</string>
</dict>
</plist>
EOF

plutil -lint "$PLIST"

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "installed: ${LABEL} (port ${PORT}, automation=${AUTOMATION})"
echo "logs:      ${LOG_DIR}/server.{out,err}.log"
echo "UI URL:    read the token with: grep -o 'token=[a-f0-9]*' ${LOG_DIR}/server.out.log | tail -1"
