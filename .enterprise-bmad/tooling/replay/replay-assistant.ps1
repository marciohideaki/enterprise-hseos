# ============================================================
# BMAD Enterprise Tooling Script
#
# Name: BMAD Repository Replay Assistant
#
# ⚠️ GOVERNANCE SUPPORT TOOL
# ⚠️ MANUAL / INTERACTIVE EXECUTION ONLY
#
# Purpose:
# Assist a controlled, curated replay from Repository A (legacy)
# into Repository B (vitrine), following an explicit replay plan.
#
# This script:
# - NEVER copies code automatically
# - NEVER infers intent
# - NEVER alters requirements or architecture
#
# Scope:
# - Replay Mode ONLY
# - Repository B (vitrine)
#
# Preconditions:
# - Replay Mode must be active
# - replay.plan.json must exist and be valid
# - Operator must understand Replay Mode rules
#
# Safety:
# - This script MUST be executed consciously
# - Running outside Replay Mode is a governance violation
#
# Version: 1.0.1
# Previous Version: 1.0.0
# Changes:
# - Header aligned with BMAD Enterprise Tooling standard
#
# ============================================================

param(
  [Parameter(Mandatory=$true)]
  [string]$ReplayPlanPath,

  [Parameter(Mandatory=$false)]
  [string]$BaseBranch = "develop"
)

function IsGitRepo {
  if (-not (Test-Path ".git")) {
    throw "This script must be run inside Repo B (with .git)"
  }
}

function Git($arguments) {
  git $args
  if ($LASTEXITCODE -ne 0) {
    throw "Git command failed: git $arguments"
  }
}

IsGitRepo

if (-not (Test-Path $ReplayPlanPath)) {
  throw "Replay plan not found: $ReplayPlanPath"
}

$plan = Get-Content $ReplayPlanPath | ConvertFrom-Json

Write-Host ""
Write-Host "🎬 BMAD Replay Assistant"
Write-Host "Base branch: $BaseBranch"
Write-Host "Stories to replay: $($plan.Count)"
Write-Host ""

Git "checkout $BaseBranch"
Git "pull"

foreach ($item in $plan) {

  $epic  = $item.Epic
  $story = $item.Story
  $hash  = $item.Hash

  $branch = "feature/$epic/$story" -replace '[^\w\/\-\.]', '-'

  Write-Host ""
  Write-Host "---------------------------------------------"
  Write-Host "📘 Epic : $epic"
  Write-Host "📗 Story: $story"
  Write-Host "🔗 Source commit: $hash"
  Write-Host "➡️ Branch: $branch"
  Write-Host "---------------------------------------------"

  $confirm = Read-Host "Create branch and replay this story? (yes/no)"
  if ($confirm -ne "yes") {
    Write-Host "⏭️ Skipping story by operator choice."
    continue
  }

  Git "checkout -b $branch $BaseBranch"

  Write-Host ""
  Write-Host "🧠 ACTION REQUIRED"
  Write-Host "- Reproduce the FINAL functional state of this story"
  Write-Host "- Follow architecture and patterns strictly"
  Write-Host "- Do NOT improve or refactor"
  Write-Host "- When done, create ONE OR MORE clean commits"
  Write-Host ""

  Read-Host "Press ENTER when commits are ready"

  Write-Host ""
  Write-Host "🔍 Validating commits..."

  $commits = git log --oneline "$BaseBranch..HEAD"
  if (-not $commits) {
    Write-Host "❌ No commits detected. Story cannot proceed."
    Git "checkout $BaseBranch"
    continue
  }

  Write-Host ""
  Write-Host "📜 Commits created:"
  Write-Host $commits

  $msgCheck = Read-Host "Do commit messages meet vitrine standards? (yes/no)"
  if ($msgCheck -ne "yes") {
    Write-Host "❌ Commit quality rejected. Fix before proceeding."
    Git "checkout $BaseBranch"
    continue
  }

  Write-Host ""
  Write-Host "✅ Story replay completed."
  Write-Host "➡️ Next step: Open Pull Request for this branch."

  Read-Host "Press ENTER to continue to next story"

  Git "checkout $BaseBranch"
}

Write-Host ""
Write-Host "🎉 Replay session completed."
Write-Host "👉 Review open PRs and proceed with merges."
