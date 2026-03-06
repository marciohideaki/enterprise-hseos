# ============================================================
# Enterprise Tooling Script
#
# Name: Replay Mode Activator
#
# ⚠️ GOVERNANCE SUPPORT TOOL
# ⚠️ MANUAL EXECUTION ONLY
#
# Purpose:
# Activate Replay Mode by creating the required governance
# artifacts in the repository.
#
# This script:
# - Creates replay-mode.active
# - Creates replay-mode.closure.md (template)
# - NEVER executes replay logic
# - NEVER enforces CI/CD rules
#
# Scope:
# - Replay Mode ONLY
# - Administrative / Governance
#
# Preconditions:
# - Repository root
# - Enterprise Overlay present
#
# Safety:
# - This script MUST be executed consciously
# - Re-running will backup existing files
#
# Version: 1.0.0
# ============================================================

$Timestamp  = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupRoot = ".backup-hseos-$Timestamp"

$ModesDir   = ".enterprise/modes"
$ActiveFile = "$ModesDir/replay-mode.active"
$ClosureFile= "$ModesDir/replay-mode.closure.md"

function IsDir([string]$Path) {
    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
        Write-Host "📁 Created directory: $Path"
    }
}

function Backup-File([string]$Path) {
    if (Test-Path $Path) {
        Ensure-Dir $BackupRoot
        $dest = Join-Path $BackupRoot $Path
        $destDir = Split-Path $dest
        Ensure-Dir $destDir
        Copy-Item -Path $Path -Destination $dest -Force
        Write-Host "📦 Backup created: $Path -> $dest"
    }
}

function Write-Template([string]$Path, [string]$Content) {
    Backup-File $Path
    $dir = Split-Path $Path
    IsDir $dir
    Set-Content -Path $Path -Value $Content -Encoding UTF8
    Write-Host "📄 Written: $Path"
}

IsDir $ModesDir

$ActiveTemplate = @"
Repository A: <identifier-or-url>
Repository B: <identifier-or-url>
Replay Owner: <human owner>
Activated On: <YYYY-MM-DD>
Notes: <optional>
"@

$ClosureTemplate = @"
# Replay Mode Closure (Enterprise)
**Status:** Draft  
**Version:** 1.0  

---

## 1. Identification
- Repository A:
- Repository B:
- Replay Owner:
- Replay Start Date:
- Replay End Date:

---

## 2. Scope Confirmation
- [ ] All epics replayed
- [ ] All stories replayed
- [ ] Requirements unchanged
- [ ] Architecture preserved

---

## 3. Contract Validation
- replay.plan.json executed
- Schema validation passed
- Commit validation passed
- CI/CD gate passed

---

## 4. Deviations / Exceptions
- None

---

## 5. Final Approval
Approved by:  
Role:  
Date:  

---

## 6. Deactivation
Replay Mode is closed when:
- replay-mode.active is removed
- this document is committed

**End**
"@

Write-Template -Path $ActiveFile  -Content $ActiveTemplate
Write-Template -Path $ClosureFile -Content $ClosureTemplate

Write-Host ""
Write-Host "✅ Replay Mode ACTIVATED (governance artifacts created)."
Write-Host "👉 Edit the files to complete activation details."
Write-Host "⚠️ Remember: Replay Mode remains active while replay-mode.active exists."
if (Test-Path $BackupRoot) {
    Write-Host "📦 Backups stored at: $BackupRoot"
}
