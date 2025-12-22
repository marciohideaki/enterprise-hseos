# ============================================================
# BMAD Enterprise Tooling Script
#
# Name: Replay Commit Message Validator
#
# ⚠️ GOVERNANCE SUPPORT TOOL
# ⚠️ MANUAL EXECUTION ONLY
#
# Purpose:
# Validate commit message quality during Replay Mode,
# ensuring repository vitrine standards are enforced.
#
# This script:
# - DOES NOT validate code
# - DOES NOT alter commits
# - DOES NOT run automatically
#
# Scope:
# - Replay Mode ONLY
# - Repository B (vitrine)
#
# Preconditions:
# - Replay Mode must be active
# - Script must be executed from Repository B
#
# Safety:
# - Running this script outside Replay Mode is a governance violation
#
# Version: 1.0.1
# Previous Version: 1.0.0
# Changes:
# - Header aligned with BMAD Enterprise Tooling standard
#
# ============================================================

param(
  [Parameter(Mandatory=$false)]
  [string]$BaseBranch = "develop"
)

function Fail($message) {
  Write-Host "❌ COMMIT VALIDATION FAILED"
  Write-Host $message
  exit 1
}

$forbiddenPatterns = @(
  '\bfix\b',
  '\bfixed\b',
  '\bbug\b',
  '\bwip\b',
  '\btmp\b',
  '\btemp\b',
  '\btry\b',
  '\bagain\b',
  '\bhack\b',
  '\bquick\b',
  '\bdirty\b',
  '\bhotfix\b',
  '\boops\b',
  '\bdebug\b',
  'test commit'
)

$commits = git log --oneline "$BaseBranch..HEAD"

if (-not $commits) {
  Fail "No commits detected for validation."
}

Write-Host "🔍 Validating commit messages (Replay Mode)..."
Write-Host ""

foreach ($line in $commits) {
  $parts = $line.Split(" ", 2)
  $hash = $parts[0]
  $message = $parts[1]

  foreach ($pattern in $forbiddenPatterns) {
    if ($message -match $pattern) {
      Fail "Commit '$hash' contains forbidden pattern '$pattern' -> '$message'"
    }
  }

  if ($message.Length -lt 15) {
    Fail "Commit '$hash' message too short to be meaningful -> '$message'"
  }

  if ($message -notmatch '^[A-Z][a-zA-Z]+ ') {
    Fail "Commit '$hash' does not start with an imperative verb -> '$message'"
  }
}

Write-Host "✅ All commit messages passed vitrine validation."
