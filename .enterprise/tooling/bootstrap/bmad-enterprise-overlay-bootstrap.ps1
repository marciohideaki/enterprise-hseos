# ============================================================
# Enterprise Tooling Script
#
# Name: Enterprise Overlay Bootstrap Script
#
# ⚠️ GOVERNANCE SUPPORT TOOL
# ⚠️ MANUAL EXECUTION ONLY
#
# Purpose:
# Bootstrap the complete Enterprise Overlay structure,
# creating all contractual directories and placeholder files.
#
# This script:
# - Creates directories and placeholder files ONLY
# - NEVER activates Replay Mode
# - NEVER enforces CI/CD rules
#
# Scope:
# - Enterprise BMAD Overlay initialization
#
# Execution:
# - Run from repository root
# - Safe to execute multiple times
#
# Version: 1.4.0
# Previous Versions: 1.0.0, 1.1.0, 1.2.0, 1.3.0
#
# Changes:
# - Added -DryRun mode (prints planned actions only)
#
# ============================================================

param(
    [Parameter(Mandatory=$false)]
    [switch]$DryRun
)

$Timestamp  = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupRoot = ".backup-bmad-$Timestamp"
$Root       = ".\enterprise-bmad"

function Log([string]$Message) {
    Write-Host $Message
}

function Confirm-BackupRoot {
    if (-not $DryRun) {
        New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
    }
}

function Backup-And-CreateDirectory {
    param ([string]$Path)

    if (Test-Path $Path) {
        if ($DryRun) {
            Log "🟡 [DryRun] Would backup directory: $Path -> $BackupRoot\$Path"
        } else {
            Confirm-BackupRoot
            Copy-Item -Path $Path -Destination "$BackupRoot\$Path" -Recurse -Force
        }
    }

    if (-not (Test-Path $Path)) {
        if ($DryRun) {
            Log "🟡 [DryRun] Would create directory: $Path"
        } else {
            New-Item -ItemType Directory -Path $Path -Force | Out-Null
            Log "📁 Created directory: $Path"
        }
    }
}

function Backup-And-CreateFile {
    param ([string]$Path)

    if (Test-Path $Path) {
        if ($DryRun) {
            Log "🟡 [DryRun] Would backup file: $Path -> $BackupRoot\$Path"
        } else {
            Confirm-BackupRoot
            Copy-Item -Path $Path -Destination "$BackupRoot\$Path" -Force
        }
    }

    $Dir = Split-Path $Path
    if (-not (Test-Path $Dir)) {
        if ($DryRun) {
            Log "🟡 [DryRun] Would create directory (parent): $Dir"
        } else {
            New-Item -ItemType Directory -Path $Dir -Force | Out-Null
        }
    }

    if (-not (Test-Path $Path)) {
        if ($DryRun) {
            Log "🟡 [DryRun] Would create file: $Path"
        } else {
            New-Item -ItemType File -Path $Path | Out-Null
            Log "📄 Created file: $Path"
        }
    }
}

Log "🚀 Bootstrapping Enterprise Overlay v1.4.0"
Log "🕒 Timestamp: $Timestamp"
if ($DryRun) { Log "🧪 DryRun: ENABLED (no changes will be made)" }

# ------------------------------------------------------------
# DIRECTORIES
# ------------------------------------------------------------
$Directories = @(
    "$Root",
    "$Root\constitution",
    "$Root\agents",
    "$Root\policies",
    "$Root\playbooks",
    "$Root\ci-cd",
    "$Root\exceptions",
    "$Root\modes",

    # Agents
    "$Root\agents\analyst",
    "$Root\agents\architect",
    "$Root\agents\dev",
    "$Root\agents\pm",
    "$Root\agents\sm",
    "$Root\agents\quick-flow",
    "$Root\agents\tea",
    "$Root\agents\tech-writer",
    "$Root\agents\ux-designer",

    # Tooling
    "$Root\tooling",
    "$Root\tooling\bootstrap",
    "$Root\tooling\replay"
)

foreach ($dir in $Directories) {
    Backup-And-CreateDirectory -Path $dir
}

# ------------------------------------------------------------
# FILES (PLACEHOLDERS ONLY)
# ------------------------------------------------------------
$Files = @(
    # Constitution
    "$Root\constitution\Enterprise-Constitution.md",
    "$Root\constitution\Enterprise-Constitution.md",

    # Modes
    "$Root\modes\replay-mode.md",
    "$Root\modes\replay-mode.active",
    "$Root\modes\replay-mode.closure.md",

    # Agent governance
    "$Root\agents\analyst\authority.md",
    "$Root\agents\analyst\constraints.md",
    "$Root\agents\architect\authority.md",
    "$Root\agents\architect\constraints.md",
    "$Root\agents\dev\authority.md",
    "$Root\agents\dev\constraints.md",
    "$Root\agents\pm\authority.md",
    "$Root\agents\pm\constraints.md",
    "$Root\agents\sm\authority.md",
    "$Root\agents\sm\constraints.md",
    "$Root\agents\quick-flow\authority.md",
    "$Root\agents\quick-flow\constraints.md",
    "$Root\agents\tea\authority.md",
    "$Root\agents\tea\constraints.md",
    "$Root\agents\tech-writer\authority.md",
    "$Root\agents\tech-writer\constraints.md",
    "$Root\agents\ux-designer\authority.md",
    "$Root\agents\ux-designer\constraints.md",

    # Policies
    "$Root\policies\sharding-policy.md",
    "$Root\policies\documentation-policy.md",
    "$Root\policies\adr-policy.md",
    "$Root\policies\pre-flight-checks.md",
    "$Root\policies\automated-validation.md",
    "$Root\policies\minimal-wiring.md",
    "$Root\policies\exceptions.md",

    # CI/CD
    "$Root\ci-cd\governance-model.md",
    "$Root\ci-cd\governance-checklist.md",
    "$Root\ci-cd\exception-validation.md",

    # Playbooks
    "$Root\playbooks\agent-onboarding.md",
    "$Root\playbooks\enterprise-flow.md",
    "$Root\playbooks\escalation-rules.md",
    "$Root\playbooks\repository-curation-replay.md",
    "$Root\playbooks\repository-vitrine-checklist.md",

    # Tooling READMEs
    "$Root\tooling\README.md",
    "$Root\tooling\bootstrap\README.md",
    "$Root\tooling\replay\README.md",

    # Root
    "$Root\README.md"
)

foreach ($file in $Files) {
    Backup-And-CreateFile -Path $file
}

Log "✅ Enterprise Overlay bootstrap completed."
Log "👉 Location: $Root"

if (-not $DryRun -and (Test-Path $BackupRoot)) {
    Log "📦 Backup stored at: $BackupRoot"
}
