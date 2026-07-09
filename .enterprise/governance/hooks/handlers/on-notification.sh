#!/usr/bin/env bash
# HSEOS on-notification handler — Wave 4 implementation slice (W4-T8)
#
# Event:   Notification
# Status:  active (replaces upstream ~/.claude/hooks/on-notification.sh)
#
# Cross-platform desktop notification when the agent surfaces a
# Notification event (typically end of a long-running operation, error
# requiring attention, or interactive prompt waiting). Always falls
# back to a terminal bell so the hook is meaningful even when no
# desktop notification stack is available.
#
# Authoring rules (per .agents/hooks/handlers/README.md):
#   - Idempotent: invoking with the same message twice produces the same UX
#   - Best-effort: never blocks the triggering action; exit 0 always
#   - Project-scoped: no host-state side effects
#   - Config-aware: respects HSEOS_NOTIFICATION_SILENT=1 to suppress
#   - Fail-open: terminal bell always works as final fallback
#
# Notification stack precedence (first hit wins):
#   1. notify-send (Linux: GNOME, KDE, common desktops)
#   2. osascript    (macOS: native NSUserNotification)
#   3. powershell.exe (WSL or native Windows: balloon tip via Forms)
#   4. terminal bell (\a) as final fallback

set -euo pipefail

# Allow opt-out via env var (useful for headless CI runners)
if [[ "${HSEOS_NOTIFICATION_SILENT:-}" == "1" ]]; then
  exit 0
fi

MSG="${1:-HSEOS: operation completed}"

# 1. Linux desktop notification
if command -v notify-send >/dev/null 2>&1; then
  notify-send "HSEOS" "$MSG" 2>/dev/null || true
fi

# 2. macOS native notification
if command -v osascript >/dev/null 2>&1; then
  # Escape any double-quotes in the message before interpolation
  ESCAPED_MSG="${MSG//\"/\\\"}"
  osascript -e "display notification \"${ESCAPED_MSG}\" with title \"HSEOS\"" 2>/dev/null || true
fi

# 3. WSL or native Windows balloon tip
if command -v powershell.exe >/dev/null 2>&1; then
  powershell.exe -Command "
    Add-Type -AssemblyName System.Windows.Forms
    \$notify = New-Object System.Windows.Forms.NotifyIcon
    \$notify.Icon = [System.Drawing.SystemIcons]::Information
    \$notify.Visible = \$true
    \$notify.ShowBalloonTip(3000, 'HSEOS', '${MSG}', [System.Windows.Forms.ToolTipIcon]::Info)
    Start-Sleep -Milliseconds 3500
    \$notify.Dispose()
  " 2>/dev/null || true
fi

# 4. Terminal bell — always emit as final-fallback signal
printf '\a' 2>/dev/null || true

exit 0
