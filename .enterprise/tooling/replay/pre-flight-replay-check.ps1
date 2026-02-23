# ============================================================
# Enterprise Tooling Script
#
# Name: Pre-Flight Replay Check
#
# ⚠️ GOVERNANCE SUPPORT TOOL
# ⚠️ MANUAL EXECUTION ONLY
#
# Purpose:
# Perform a comprehensive pre-flight validation before
# starting a legacy-to-vitrine replay session.
#
# This script:
# - Aggregates all mandatory preconditions
# - DOES NOT modify repository state
# - DOES NOT execute replay logic
#
# Scope:
# - Replay Mode ONLY
#
# Version: 1.0.0
# ============================================================

$ModesDir   = ".enterprise/modes"
$ToolingDir = ".enterprise/tooling/replay"
$PlanDir    = "replay-analysis/40-plan"

$ActiveFile = "$ModesDir/replay-mode.active"
$ClosureFile= "$ModesDir/replay-mode.closure.md"

$PlanFile   = "$PlanDir/replay.plan.json"
$SchemaFile = "$PlanDir/replay-plan.schema.json"

$RequiredScripts = @(
    "$ToolingDir/replay-assistant.ps1",
    "$ToolingDir/validate-commits.ps1",
    "$ToolingDir/validate-replay-plan.ps1"
)

function Fail([string]$Message) {
    Write-Host "❌ PRE-FLIGHT CHECK FAILED"
    Write-Host $Message
    exit 1
}

Write-Host "🛫 Pre-Flight Replay Check"
Write-Host "-----------------------------------"

# ------------------------------------------------------------
# 1. Replay Mode
# ------------------------------------------------------------
if (-not (Test-Path $ActiveFile)) {
    Fail "Replay Mode is NOT active (missing replay-mode.active)"
}

if (-not (Test-Path $ClosureFile)) {
    Fail "Missing closure document: replay-mode.closure.md"
}

Write-Host "✅ Replay Mode artifacts present"

# ------------------------------------------------------------
# 2. Git Environment
# ------------------------------------------------------------
if (-not (Test-Path ".git")) {
    Fail "Not inside a Git repository"
}

$branch = git rev-parse --abbrev-ref HEAD
if ($branch -eq "main") {
    Fail "Replay must NOT be executed directly on 'main' branch"
}

Write-Host "✅ Git environment valid (branch: $branch)"

# ------------------------------------------------------------
# 3. Replay Plan Contract
# ------------------------------------------------------------
if (-not (Test-Path $PlanFile)) {
    Fail "Missing replay plan: $PlanFile"
}

if (-not (Test-Path $SchemaFile)) {
    Fail "Missing replay schema: $SchemaFile"
}

Write-Host "🔍 Validating replay plan schema..."
pwsh "$ToolingDir/validate-replay-plan.ps1"

Write-Host "✅ Replay plan valid"

# ------------------------------------------------------------
# 4. Tooling Presence
# ------------------------------------------------------------
foreach ($script in $RequiredScripts) {
    if (-not (Test-Path $script)) {
        Fail "Required tooling script missing: $script"
    }
}

Write-Host "✅ Required tooling present"

# ------------------------------------------------------------
# FINAL
# ------------------------------------------------------------
Write-Host ""
Write-Host "🎉 PRE-FLIGHT CHECK PASSED"
Write-Host "👉 You may safely start the Replay Assistant."
