# ============================================================
# Enterprise Tooling Script
#
# Name: Replay Mode Deactivator
#
# ⚠️ GOVERNANCE SUPPORT TOOL
# ⚠️ MANUAL EXECUTION ONLY
#
# Purpose:
# Explicitly deactivate Replay Mode after successful
# legacy-to-vitrine replay completion.
#
# This script:
# - Removes replay-mode.active
# - Requires replay-mode.closure.md to exist
# - Creates timestamped backups
# - NEVER alters code or history
#
# Scope:
# - Replay Mode ONLY
# - Administrative / Governance
#
# Preconditions:
# - Replay Mode must be active
# - Closure document must exist
#
# Safety:
# - Requires explicit human confirmation
#
# Version: 1.0.0
# ============================================================

$Timestamp   = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupRoot  = ".backup-hseos-$Timestamp"

$ModesDir    = ".enterprise/modes"
$ActiveFile  = "$ModesDir/replay-mode.active"
$ClosureFile = "$ModesDir/replay-mode.closure.md"

function Fail([string]$Message) {
    Write-Host "❌ REPLAY MODE DEACTIVATION FAILED"
    Write-Host $Message
    exit 1
}

function Confirm-BackupRoot {
    New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
}

function Backup-File([string]$Path) {
    if (Test-Path $Path) {
        Confirm-BackupRoot
        $dest = Join-Path $BackupRoot $Path
        $destDir = Split-Path $dest
        if (-not (Test-Path $destDir)) {
            New-Item -ItemType Directory -Path $destDir -Force | Out-Null
        }
        Copy-Item -Path $Path -Destination $dest -Force
        Write-Host "📦 Backup created: $Path -> $dest"
    }
}

Write-Host "🔒 Replay Mode Deactivation"
Write-Host "🕒 Timestamp: $Timestamp"
Write-Host ""

if (-not (Test-Path $ActiveFile)) {
    Fail "Replay Mode is not active. File not found: $ActiveFile"
}

if (-not (Test-Path $ClosureFile)) {
    Fail "Closure document missing: $ClosureFile"
}

Write-Host "ℹ️ Replay Mode is currently ACTIVE."
Write-Host "ℹ️ Closure document detected."

Write-Host ""
$confirm = Read-Host "Are you sure you want to DEACTIVATE Replay Mode? (yes/no)"
if ($confirm -ne "yes") {
    Write-Host "⏭️ Deactivation cancelled by operator."
    exit 0
}

# Backup artifacts
Backup-File $ActiveFile
Backup-File $ClosureFile

# Remove Replay Mode flag
Remove-Item -Path $ActiveFile -Force
Write-Host "🟢 Replay Mode deactivated (replay-mode.active removed)."

Write-Host ""
Write-Host "✅ Replay Mode deactivation completed."
Write-Host "👉 Repository is now back to NORMAL operation mode."

if (Test-Path $BackupRoot) {
    Write-Host "📦 Backups stored at: $BackupRoot"
}
