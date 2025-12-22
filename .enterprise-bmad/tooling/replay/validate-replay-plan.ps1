# ============================================================
# BMAD Enterprise Tooling Script
#
# ⚠️ GOVERNANCE SUPPORT TOOL
# ⚠️ MANUAL EXECUTION ONLY
#
# Purpose:
# Validate replay.plan.json against replay-plan.schema.json
# for Replay Mode enforcement.
#
# Scope:
# - Replay Mode ONLY
#
# Version: 1.0.0
# ============================================================

$ReplayModeFlag = "enterprise-bmad/modes/replay-mode.active"
$PlanPath       = "replay-analysis/40-plan/replay.plan.json"
$SchemaPath     = "replay-analysis/40-plan/replay-plan.schema.json"

function Fail($msg) {
    Write-Host "❌ REPLAY PLAN VALIDATION FAILED"
    Write-Host $msg
    exit 1
}

Write-Host "🔍 Replay Plan Validation"

if (-not (Test-Path $ReplayModeFlag)) {
    Write-Host "ℹ️ Replay Mode not active. Validation skipped."
    exit 0
}

if (-not (Test-Path $PlanPath)) {
    Fail "Missing replay plan: $PlanPath"
}

if (-not (Test-Path $SchemaPath)) {
    Fail "Missing replay schema: $SchemaPath"
}

# Requires PowerShell 7+ for Test-Json -SchemaFile
try {
    $json   = Get-Content $PlanPath -Raw
    $result = $json | Test-Json -SchemaFile $SchemaPath -ErrorAction Stop
}
catch {
    Fail $_.Exception.Message
}

if (-not $result) {
    Fail "Replay plan does not conform to schema."
}

Write-Host "✅ Replay plan is valid and conforms to schema."
