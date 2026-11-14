#!/usr/bin/env bash
# Stop and remove the pr-helper-git launchd LaunchAgent (see install.sh).

set -euo pipefail
LABEL="local.pr-helper-git.server"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
rm -f "$PLIST"
echo "removed: ${LABEL} (logs kept in ~/Library/Logs/pr-helper-git/)"
