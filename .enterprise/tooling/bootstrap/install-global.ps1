# ============================================================
# Enterprise BMAD Governance - Global Bootstrap
#
# Purpose:
#   Installs the Enterprise BMAD governance overlay globally
#   into ~/.claude/ so it is available from ANY project,
#   regardless of working directory.
#
# What this installs:
#   ~/.claude/CLAUDE.md                  - Minimal governance rules (always active)
#   ~/.claude/commands/constitution.md   - /constitution (full, on-demand)
#   ~/.claude/commands/setup.md          - /setup wizard (stack selector)
#   ~/.claude/commands/analyst.md        - /analyst persona
#   ~/.claude/commands/architect.md      - /architect persona
#   ~/.claude/commands/dev.md            - /dev persona
#   ~/.claude/commands/pm.md             - /pm persona
#   ~/.claude/commands/sm.md             - /sm persona
#   ~/.claude/commands/tea.md            - /tea persona
#   ~/.claude/commands/tech-writer.md    - /tech-writer persona
#   ~/.claude/commands/quick-flow.md     - /quick-flow persona
#   ~/.claude/commands/ux-designer.md    - /ux-designer persona
#   ~/.claude/enterprise/.specs/         - Full spec library (for /setup wizard)
#
# Usage:
#   .\install-global.ps1              - Interactive (prompts on conflict)
#   .\install-global.ps1 -Force       - Overwrite all without prompting
#   .\install-global.ps1 -DryRun      - Preview only, no changes
#
# Idempotent: safe to run multiple times.
# Version: 1.0.0
# ============================================================

[CmdletBinding()]
param(
    [switch]$Force,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------
# PATHS
# ---------------------------------------------------------------
$ClaudeHome    = Join-Path $env:USERPROFILE ".claude"
$CommandsDir   = Join-Path $ClaudeHome "commands"
$SpecsTarget   = Join-Path $ClaudeHome "enterprise"
$ScriptDir     = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot      = (Resolve-Path (Join-Path $ScriptDir "..\..\..")).Path.TrimEnd('\')
$EnterpriseDir = Join-Path $RepoRoot ".enterprise"
$SpecsSource   = Join-Path $EnterpriseDir ".specs"
$SkillsSource  = Join-Path $EnterpriseDir "governance\agent-skills"

# ---------------------------------------------------------------
# HELPERS
# ---------------------------------------------------------------
function Write-Step { param($msg) Write-Host "  -> $msg" -ForegroundColor Cyan }
function Write-Ok   { param($msg) Write-Host "  OK $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "  !! $msg" -ForegroundColor Yellow }
function Write-Fail { param($msg) Write-Host "  XX $msg" -ForegroundColor Red }
function Write-Dry  { param($msg) Write-Host "  [DryRun] $msg" -ForegroundColor DarkGray }

function Should-Write {
    param([string]$Path)
    if ($DryRun)            { Write-Dry "Would write: $Path"; return $false }
    if (-not (Test-Path $Path)) { return $true }
    if ($Force)             { return $true }
    $ans = Read-Host "  Exists: $(Split-Path $Path -Leaf) -- overwrite? [y/N]"
    return ($ans -eq 'y' -or $ans -eq 'Y')
}

function Write-GovernanceFile {
    param([string]$Path, [string]$Content)
    $dir = Split-Path $Path
    if (-not (Test-Path $dir)) {
        if (-not $DryRun) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    }
    if (Should-Write -Path $Path) {
        Set-Content -Path $Path -Value $Content -Encoding UTF8 -NoNewline
        Write-Ok (Split-Path $Path -Leaf)
    }
}

function Read-SourceFile {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        Write-Fail "Missing source file: $Path"
        throw "Source file not found: $Path"
    }
    return (Get-Content -Path $Path -Raw -Encoding UTF8)
}

# Strip duplicate Mandatory Governance Clauses from constraints.md
# They already appear in authority.md - no need to repeat in the combined command file.
function Strip-GovernanceClauses {
    param([string]$Content)
    return ($Content -replace "(?s)\r?\n## Mandatory Governance Clauses.*", "").Trim()
}

# Build a combined agent command file from authority.md + constraints.md
function Build-AgentCommand {
    param([string]$AgentName)
    $base = Join-Path $EnterpriseDir "agents\$AgentName"
    $auth = Read-SourceFile (Join-Path $base "authority.md")
    $cons = Strip-GovernanceClauses (Read-SourceFile (Join-Path $base "constraints.md"))
    return "$auth`n`n---`n`n$cons"
}

# ---------------------------------------------------------------
# BANNER
# ---------------------------------------------------------------
Write-Host ""
Write-Host "Enterprise BMAD - Global Bootstrap v1.0.0" -ForegroundColor White
Write-Host "  Target : $ClaudeHome" -ForegroundColor DarkGray
Write-Host "  Source : $EnterpriseDir" -ForegroundColor DarkGray
if ($DryRun) { Write-Host "  Mode   : DRY RUN (no changes)" -ForegroundColor DarkYellow }
if ($Force)  { Write-Host "  Mode   : FORCE (overwrite all)" -ForegroundColor DarkYellow }
Write-Host ""

# ---------------------------------------------------------------
# PRE-FLIGHT
# ---------------------------------------------------------------
Write-Step "Pre-flight checks"

if (-not (Test-Path $EnterpriseDir)) {
    Write-Fail "Source .enterprise/ not found at: $EnterpriseDir"
    Write-Fail "Run this script from within the enterprise-bmad repository."
    exit 1
}
if (-not (Test-Path $SpecsSource)) {
    Write-Fail "Source .specs/ not found at: $SpecsSource"
    exit 1
}
if (-not (Test-Path $SkillsSource)) {
    Write-Fail "Source agent-skills/ not found at: $SkillsSource"
    exit 1
}
Write-Ok "Source validated: $EnterpriseDir"

# ---------------------------------------------------------------
# 1. ~/.claude/CLAUDE.md - Minimal governance (always active)
# ---------------------------------------------------------------
Write-Host ""
Write-Step "Writing CLAUDE.md"

$claudeMd = @'
# Enterprise Governance -- Active

**Version:** 2.0 | **Status:** Active | **Scope:** All repositories

Full constitution: /constitution
Project setup wizard: /setup
Agent personas: /analyst · /architect · /dev · /pm · /sm · /tea · /tech-writer · /quick-flow · /ux-designer

---

## Non-Negotiables (Hard Rules)

- **GitHub is the single source of truth.** Chat history, memory, and external assumptions are NOT authoritative. If it is not in the repo, it is not guaranteed to be true.
- **Default bar is Enterprise / State-of-the-Art.** Never propose simpler alternatives that reduce robustness, governance, security, observability, resilience, or maintainability. Trade-offs require an explicit ADR draft.
- **Never remove, shrink, rewrite, or summarize away existing requirements.** Any change must be explicit, traceable, and reviewed.
- **No silent architecture reinvention.** Follow existing patterns. Propose improvements ONLY as suggestion + ADR draft, never as silent replacement.
- **Ambiguity triggers mandatory stop.** Do not guess intent. Do not average conflicting rules. Do not pick the easiest path.

---

## Agent Behavior

**MUST:**
- Read core invariants before any work (`.enterprise/.specs/core/`)
- Apply cross-cutting standards automatically
- Reference governing documents in all outputs
- Produce merge-ready, versionable artifacts
- Prefer explicitness over brevity
- Preserve enterprise rigor

**MUST NOT:**
- Invent requirements, APIs, or constraints not found in the repo
- Remove or weaken security or compliance requirements
- Change naming conventions or architectural boundaries silently
- Produce output without referencing governing standards
- Introduce undocumented assumptions
- Optimize for speed over rigor

---

## Conflict Resolution

When documents conflict:
1. STOP autonomous execution
2. Identify the conflicting documents explicitly
3. Apply precedence: **Constitution > Core > Cross > Stack > ADR > Templates > Generated**
4. Produce one of: clarification request · ADR draft · explicit deviation report

---

## Document Precedence

| Priority | Layer | Path |
|---|---|---|
| 1 (highest) | Enterprise Constitution | `.enterprise/.specs/constitution/` |
| 2 | Core Governance Standards | `.enterprise/.specs/core/` |
| 3 | Cross-Cutting Standards | `.enterprise/.specs/cross/` |
| 4 | Stack-Specific Standards | `.enterprise/.specs/<Stack>/` |
| 5 | ADRs | `.enterprise/.specs/decisions/` |
| 6 | Templates | -- |
| 7 (lowest) | Generated Artifacts | -- |
'@

Write-GovernanceFile -Path (Join-Path $ClaudeHome "CLAUDE.md") -Content $claudeMd

# ---------------------------------------------------------------
# 2. /constitution - Full constitution on-demand
# ---------------------------------------------------------------
Write-Host ""
Write-Step "Writing /constitution command"

$constitutionSource  = Join-Path $SpecsSource "constitution\Enterprise-Constitution.md"
$constitutionContent = Read-SourceFile $constitutionSource

$constitutionCmd = @"
# Enterprise Constitution -- Full Reference

The following is the complete Enterprise Constitution v2.0.
Read it, internalize it, and apply it to the current session.
After reading, confirm: "Enterprise Constitution v2.0 loaded and active."

---

$constitutionContent
"@

Write-GovernanceFile -Path (Join-Path $CommandsDir "constitution.md") -Content $constitutionCmd

# ---------------------------------------------------------------
# 3. /setup - Project initialization wizard
# ---------------------------------------------------------------
Write-Host ""
Write-Step "Writing /setup wizard command"

$setupCmd = @'
# Enterprise Governance -- Project Setup Wizard

You are the Enterprise BMAD Governance Setup Wizard.
Conduct an interactive setup to initialize governance for the current project.
Ask questions ONE AT A TIME. Wait for each answer before proceeding.

---

## Step 1 -- Stack

Ask: "Which technology stack does this project use?"

Options (pick one or more):
- Flutter
- ReactNative
- CSharp (.NET)
- Java
- Go
- PHP
- C++

Wait for the answer. Accept multiple stacks. Store as [SELECTED_STACKS].

---

## Step 2 -- Project Type

Ask: "What is the project type?"

Options:
- Mobile App
- Microservice / Backend Service
- REST API / API Gateway
- Library / Package
- Monolith
- Other (ask to describe)

Wait for the answer. Store as [PROJECT_TYPE].

---

## Step 3 -- Skills

Present the following skill groups. For each group, show the skills and their purpose.
Pre-select skills marked as (*) by default. Mark stack-specific skills only if the relevant stack was selected in Step 1.

Ask: "Which skills do you want to activate for this project? You can accept the defaults or customize."

```
GROUP: Core (always recommended)
  [*] commit-hygiene            Enforce commit and PR message hygiene
  [*] secure-coding             Guardrails for auth, secrets, input validation, PII
  [*] pr-review                 Enforce PR quality gates and governance compliance
  [*] naming-conventions        Validate naming against stack profiles
  [*] test-coverage             Validate test coverage and test pyramid compliance

GROUP: Architecture
  [ ] ddd-boundary-check        Validate DDD layer direction and bounded context isolation
  [ ] breaking-change-detection Detect breaking changes in APIs, events, DTOs, contracts
  [ ] adr-compliance            Validate ADR format, completeness, and linkage
  [ ] spec-driven               Structured 4-phase workflow: Specify > Design > Tasks > Implement

GROUP: Quality & Operations
  [ ] documentation-completeness  Validate documentation coverage for public code and APIs
  [ ] dependency-audit            Review new dependencies for security and license compliance
  [ ] observability-compliance    Validate structured logging, metrics, and tracing
  [ ] sanitize-comments           Remove methodology and AI-attribution references from code comments
  [ ] release-control             Release governance: changelog, risk classification, rollout

GROUP: Stack-specific
  (auto-selected if Flutter or ReactNative was chosen in Step 1)
  [ ] accessibility             WCAG 2.1 compliance -- Flutter and ReactNative only

GROUP: Opt-in (requires active Performance Engineering ADR)
  [ ] performance-profiling     Hot path review, zero-alloc validation, benchmark gates
                                WARNING: Only activate if your project has a Performance Engineering ADR.
```

Wait for the answer. Accept:
- "defaults" or "default" -> use all [*] pre-selected skills only
- "all" -> select all skills (warn about performance-profiling requirement)
- Individual skill names or group names
- Explicit list of skill names

Store selected skills as [SELECTED_SKILLS].

---

## Step 4 -- Mode

Ask: "How do you want to apply the governance?"

Options:
- **(A) Load into current session only** -- reads specs and skills into this conversation. No files created. Ideal for quick reference or one-off tasks.
- **(B) Install into this project** -- creates `.enterprise/` in the current directory with specs and selected skills. Ideal for onboarding a new repository.

Wait for the answer. Store as [MODE].

---

## Step 5 -- Execute

Apply the following logic based on [SELECTED_STACKS], [PROJECT_TYPE], [SELECTED_SKILLS], and [MODE].

### Specs to load (always, regardless of stack):
- `~/.claude/enterprise/.specs/constitution/Enterprise-Constitution.md`
- All files under `~/.claude/enterprise/.specs/core/`
- All files under `~/.claude/enterprise/.specs/cross/`

### Specs to load (stack-specific):
- `~/.claude/enterprise/.specs/<Stack>/` for each stack in [SELECTED_STACKS] only
- Skip all other stacks

### Skills to reference:
- `~/.claude/enterprise/governance/agent-skills/SKILLS-REGISTRY.md` (always)
- For each skill in [SELECTED_SKILLS]: `~/.claude/enterprise/governance/agent-skills/<skill>/`

### If Mode A (session only):
- Read all identified spec files and load into context
- Read SKILLS-REGISTRY.md and load into context
- Summarize: list each spec file in one line + list active skills
- Confirm: "Governance loaded for [SELECTED_STACKS] [PROJECT_TYPE]. [N] spec files + [M] skills active."

### If Mode B (install into project):

#### What goes to git vs what stays local

Two categories of files are installed. The distinction is fundamental:

| Category | What | Why |
|---|---|---|
| **Project artifacts** | `.enterprise/.specs/` | Constitution, standards, ADRs -- team decisions that must be versioned |
| **AI tooling** | `.enterprise/governance/`, `.enterprise/agents/`, `.claude/` | Skills and agent configs -- local tooling, each dev installs via /setup |

#### Installation steps

1. Check if `.enterprise/` already exists. If yes, warn and ask before overwriting.

2. Create the following structure:
  ```
  .enterprise/
  +-- .specs/                              <- PROJECT ARTIFACT -- goes to git
  |   +-- constitution/                   <- copy from ~/.claude/enterprise/.specs/constitution/
  |   +-- core/                           <- copy from ~/.claude/enterprise/.specs/core/
  |   +-- cross/                          <- copy from ~/.claude/enterprise/.specs/cross/
  |   +-- <Stack>/                        <- copy ONLY [SELECTED_STACKS]
  |   +-- decisions/                      <- create with .gitkeep (future project ADRs)
  +-- governance/                         <- AI TOOLING -- gitignored
  |   +-- agent-skills/
  |       +-- SKILLS-REGISTRY.md
  |       +-- <skill>/                    <- copy ONLY [SELECTED_SKILLS]
  +-- exceptions/                         <- create with .gitkeep (future exceptions)
  ```
  Notes:
  - DO NOT create `.enterprise/agents/` -- it is gitignored and serves no purpose empty.
  - `.gitkeep` files ensure `decisions/` and `exceptions/` are tracked by git even when empty.

3. Create `CLAUDE.md` at the project root (goes to git -- team entry point):
  ```markdown
  # Project Governance

  Stack(s): [SELECTED_STACKS]
  Type: [PROJECT_TYPE]
  Constitution: `.enterprise/.specs/constitution/Enterprise-Constitution.md`
  Active skills: [SELECTED_SKILLS]

  > AI tooling is local. Clone this repo then run /setup to restore it.

  Commands: /setup · /skills · /constitution · /architect · /dev · /pm
  ```

4. Create or update `.gitignore` at the project root with the following entries:
  ```gitignore
  # Governance AI tooling -- local only, restore via /setup
  .enterprise/governance/
  .enterprise/agents/

  # Claude Code -- local machine settings
  .claude/
  ```
  - If `.gitignore` already exists: append only the missing entries, never duplicate.
  - If it does not exist: create it with the entries above.

5. Confirm with a clear summary:
  ```
  Governance installed for [SELECTED_STACKS] [PROJECT_TYPE]

  Goes to git (project artifacts):
    .enterprise/.specs/      Constitution, standards, ADRs
    CLAUDE.md                Team entry point

  Stays local (AI tooling -- gitignored):
    .enterprise/governance/  Skills: [SELECTED_SKILLS]
    .enterprise/agents/      Agent personas
    .claude/                 Claude Code settings

  Next: git add .enterprise/.specs/ CLAUDE.md .gitignore && git commit
  ```

---

## Guardrails

- NEVER load specs for stacks not in [SELECTED_STACKS].
- NEVER skip constitution and core standards.
- NEVER activate performance-profiling without warning the user about the ADR requirement.
- NEVER add `.enterprise/.specs/` to `.gitignore` -- specs are project artifacts and must be versioned.
- If files are not found at `~/.claude/enterprise/`, ask the user to re-run: `install-global.ps1`
'@

Write-GovernanceFile -Path (Join-Path $CommandsDir "setup.md") -Content $setupCmd

# ---------------------------------------------------------------
# 4. /skills - Standalone skills wizard
# ---------------------------------------------------------------
Write-Host ""
Write-Step "Writing /skills wizard command"

$skillsCmd = @'
# Enterprise Governance -- Skills Wizard

You are the Enterprise BMAD Skills Wizard.
Use this command to install or update the governance skills for an existing project.
Ask questions ONE AT A TIME. Wait for each answer before proceeding.

---

## Step 1 -- Stack Context

Ask: "Which technology stack does this project use? (This helps pre-select relevant skills)"

Options (pick one or more):
- Flutter
- ReactNative
- CSharp (.NET)
- Java
- Go
- PHP
- C++
- Not sure / Skip

Wait for the answer. Store as [STACK].

---

## Step 2 -- Skill Selection

Present the full skill catalogue grouped below.
Pre-select [*] skills by default.
Auto-select accessibility if [STACK] includes Flutter or ReactNative.
Show the WARNING for performance-profiling.

Ask: "Which skills do you want to activate? (Accept defaults, type 'all', or list specific skills/groups)"

```
GROUP: Core (always recommended)
  [*] commit-hygiene
      Enforce commit and PR message hygiene.
      No co-authorship trailers, no AI tool names. Whole-word matching only.
      Triggers: commit, amend, PR title, PR body, changelog, release notes

  [*] secure-coding
      Guardrails for auth, tokens, secrets, input validation, PII.
      Triggers: auth, JWT, OAuth, secret, password, crypto, PII, new endpoint, SQL, RBAC

  [*] pr-review
      Enforce PR quality gates, boundary evidence, contract safety, governance compliance.
      Triggers: pull request, PR review, code review, merge request, ready to merge

  [*] naming-conventions
      Validate naming against stack profiles (C#, Dart, TypeScript, Java, Go, PHP, C++).
      Triggers: class name, method name, file name, new class, new function, identifier

  [*] test-coverage
      Validate test coverage adequacy, test pyramid compliance, and test quality.
      Triggers: test, unit test, integration test, coverage, missing tests, test pyramid

GROUP: Architecture
  [ ] ddd-boundary-check
      Validate DDD layer direction and bounded context isolation.
      Triggers: domain/, application/, infrastructure/, bounded context, aggregate, ORM

  [ ] breaking-change-detection
      Detect breaking changes in APIs, events, DTOs, and shared contracts.
      Triggers: API change, endpoint removed, field removed, contract change, OpenAPI, proto

  [ ] adr-compliance
      Validate ADR format, completeness, approval status, and linkage to standards.
      Triggers: ADR, architectural change, deviation, exception, decision record

  [ ] spec-driven
      Structured 4-phase workflow: Specify > Design > Tasks > Implement.
      Triggers: new feature, new service, planning, specification, breakdown, task list

GROUP: Quality & Operations
  [ ] documentation-completeness
      Validate documentation coverage for public code, APIs, and architecture.
      Triggers: public API, new class, new function, exported component, missing documentation

  [ ] dependency-audit
      Review new or upgraded dependencies for security, license compliance, and pinning.
      Triggers: new dependency, npm install, nuget add, pub add, lockfile changed

  [ ] observability-compliance
      Validate structured logging, metrics, tracing, and alerting requirements.
      Triggers: log, metric, trace, telemetry, correlationId, new endpoint, background job

  [ ] sanitize-comments
      Remove methodology references (FR, NFR, Story) and AI-attribution from code comments.
      Triggers: sanitize comments, clean comments, AI attribution, open-source prep

  [ ] release-control
      Release governance: changelog discipline, risk classification, rollout requirements.
      Triggers: release, version bump, semver, CHANGELOG, hotfix, production deploy

GROUP: Stack-specific
  [ ] accessibility
      WCAG 2.1 compliance for Flutter and React Native.
      Auto-selected if Flutter or ReactNative chosen above.
      Triggers: Flutter widget, React Native component, screen reader, a11y, WCAG, contrast

GROUP: Opt-in
  [ ] performance-profiling
      Hot path review, zero-alloc validation, lock-free audit, benchmark regression gates.
      WARNING: Only activate if your project has an active Performance Engineering ADR.
      Triggers: hot path, zero alloc, lock-free, benchmark, latency, throughput, flamegraph
```

Wait for the answer. Accept:
- "defaults" -> [*] pre-selected skills only
- "all" -> all skills (warn about performance-profiling)
- Group name (e.g. "architecture") -> all skills in that group
- Individual skill names

Store final selection as [SELECTED_SKILLS].

---

## Step 3 -- Mode

Ask: "How do you want to apply the selected skills?"

Options:
- **(A) Load into current session only** -- activates skills in this conversation context. No files created.
- **(B) Install into this project** -- copies selected skills into `.enterprise/governance/agent-skills/` in the current directory.

Wait for the answer.

---

## Step 4 -- Execute

### If Mode A (session only):
- Read `~/.claude/enterprise/governance/agent-skills/SKILLS-REGISTRY.md`
- Read `~/.claude/enterprise/governance/agent-skills/<skill>/SKILL-QUICK.md` for each skill in [SELECTED_SKILLS]
- Confirm active skills and their triggers in a summary table:
  | Skill | Key Triggers |
  |---|---|
  | commit-hygiene | commit, PR title, changelog |
  | ... | ... |
- Confirm: "[N] skills active for this session."

### If Mode B (install into project):
- Check if `.enterprise/governance/agent-skills/` already exists. If yes, ask before overwriting individual skills.
- Copy `SKILLS-REGISTRY.md` to `.enterprise/governance/agent-skills/SKILLS-REGISTRY.md` (always)
- For each skill in [SELECTED_SKILLS], copy from:
  `~/.claude/enterprise/governance/agent-skills/<skill>/`
  to:
  `.enterprise/governance/agent-skills/<skill>/`
- If `CLAUDE.md` exists at project root, append the skills list to the Skills line. If not, suggest running `/setup` first.
- Confirm: "[N] skills installed to .enterprise/governance/agent-skills/"
- List installed skills with their primary triggers.

---

## Guardrails

- NEVER activate performance-profiling without explicitly warning about the ADR requirement.
- NEVER skip SKILLS-REGISTRY.md -- it is required for agents to discover and load skills.
- If skill files are not found at `~/.claude/enterprise/governance/agent-skills/`, ask the user to re-run: `install-global.ps1`
'@

Write-GovernanceFile -Path (Join-Path $CommandsDir "skills.md") -Content $skillsCmd

# ---------------------------------------------------------------
# 5. Agent persona commands
# ---------------------------------------------------------------
Write-Host ""
Write-Step "Writing agent persona commands"

$agents = @(
    @{ Name = "analyst";     File = "analyst.md" }
    @{ Name = "architect";   File = "architect.md" }
    @{ Name = "dev";         File = "dev.md" }
    @{ Name = "pm";          File = "pm.md" }
    @{ Name = "sm";          File = "sm.md" }
    @{ Name = "tea";         File = "tea.md" }
    @{ Name = "tech-writer"; File = "tech-writer.md" }
    @{ Name = "quick-flow";  File = "quick-flow.md" }
    @{ Name = "ux-designer"; File = "ux-designer.md" }
)

foreach ($agent in $agents) {
    try {
        $body    = Build-AgentCommand -AgentName $agent.Name
        $label   = $agent.Name
        $content = "# Enterprise Agent -- $label`n`nYou are now operating as the **$label** agent under the Enterprise BMAD Governance overlay.`nAdopt this persona fully for the current session. All rules below are binding.`n`n---`n`n$body"
        Write-GovernanceFile -Path (Join-Path $CommandsDir $agent.File) -Content $content
    }
    catch {
        Write-Warn "Could not build command for '$($agent.Name)': $_"
    }
}

# ---------------------------------------------------------------
# 5. Copy specs to ~/.claude/enterprise/.specs/
# ---------------------------------------------------------------
Write-Host ""
Write-Step "Copying spec library to ~/.claude/enterprise/.specs/"

$specsTargetPath = Join-Path $SpecsTarget ".specs"
$skipSpecs = $false

if ($DryRun) {
    Write-Dry "Would copy: $SpecsSource -> $specsTargetPath"
}
else {
    if (Test-Path $specsTargetPath) {
        if ($Force) {
            Remove-Item -Path $specsTargetPath -Recurse -Force
            Write-Warn "Existing specs removed (Force mode)"
        }
        else {
            $ans = Read-Host "  Specs exist at $specsTargetPath -- overwrite? [y/N]"
            if ($ans -eq 'y' -or $ans -eq 'Y') {
                Remove-Item -Path $specsTargetPath -Recurse -Force
            }
            else {
                Write-Warn "Specs copy skipped by user"
                $skipSpecs = $true
            }
        }
    }

    if (-not $skipSpecs) {
        New-Item -ItemType Directory -Path $SpecsTarget -Force | Out-Null
        Copy-Item -Path $SpecsSource -Destination $specsTargetPath -Recurse -Force
        $fileCount = (Get-ChildItem -Path $specsTargetPath -Recurse -File).Count
        Write-Ok "$($fileCount) files copied to $specsTargetPath"
    }
}

# ---------------------------------------------------------------
# 6. Copy skills to ~/.claude/enterprise/governance/agent-skills/
# ---------------------------------------------------------------
Write-Host ""
Write-Step "Copying skill library to ~/.claude/enterprise/governance/agent-skills/"

$skillsTargetPath = Join-Path $SpecsTarget "governance\agent-skills"
$skipSkills = $false

if ($DryRun) {
    Write-Dry "Would copy: $SkillsSource -> $skillsTargetPath"
}
else {
    if (Test-Path $skillsTargetPath) {
        if ($Force) {
            Remove-Item -Path $skillsTargetPath -Recurse -Force
            Write-Warn "Existing skills removed (Force mode)"
        }
        else {
            $ans = Read-Host "  Skills exist at $skillsTargetPath -- overwrite? [y/N]"
            if ($ans -eq 'y' -or $ans -eq 'Y') {
                Remove-Item -Path $skillsTargetPath -Recurse -Force
            }
            else {
                Write-Warn "Skills copy skipped by user"
                $skipSkills = $true
            }
        }
    }

    if (-not $skipSkills) {
        New-Item -ItemType Directory -Path (Split-Path $skillsTargetPath) -Force | Out-Null
        Copy-Item -Path $SkillsSource -Destination $skillsTargetPath -Recurse -Force
        $skillCount = (Get-ChildItem -Path $skillsTargetPath -Recurse -File).Count
        Write-Ok "$($skillCount) files copied to $skillsTargetPath"
    }
}

# ---------------------------------------------------------------
# SUMMARY
# ---------------------------------------------------------------
Write-Host ""
Write-Host "---------------------------------------------" -ForegroundColor DarkGray
Write-Host " Enterprise BMAD Global Bootstrap -- Done" -ForegroundColor White
Write-Host "---------------------------------------------" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Installed to : $ClaudeHome" -ForegroundColor Gray
Write-Host ""
Write-Host "  Always active:" -ForegroundColor Gray
Write-Host "    ~/.claude/CLAUDE.md             Non-negotiables + behavior rules" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  On-demand commands:" -ForegroundColor Gray
Write-Host "    /constitution                   Full Enterprise Constitution v2.0" -ForegroundColor DarkGray
Write-Host "    /setup                          Project setup wizard (stack + skills)" -ForegroundColor DarkGray
Write-Host "    /skills                         Skills wizard (standalone)" -ForegroundColor DarkGray
Write-Host "    /analyst /architect /dev        Agent personas" -ForegroundColor DarkGray
Write-Host "    /pm /sm /tea /tech-writer       Agent personas" -ForegroundColor DarkGray
Write-Host "    /quick-flow /ux-designer        Agent personas" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Libraries:" -ForegroundColor Gray
Write-Host "    ~/.claude/enterprise/.specs/                Spec library" -ForegroundColor DarkGray
Write-Host "    ~/.claude/enterprise/governance/agent-skills/  Skill library" -ForegroundColor DarkGray
Write-Host ""

if ($DryRun) {
    Write-Host "  DRY RUN: no files were written." -ForegroundColor DarkYellow
    Write-Host ""
}

Write-Host "  Open a new Claude session in any directory to verify." -ForegroundColor Gray
Write-Host ""
