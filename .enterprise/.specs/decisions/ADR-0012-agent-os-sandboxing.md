# ADR-0012 — Optional Agent OS Sandboxing

**Status:** Proposed
**Date:** 2026-05-30
**Authors:** Platform Architecture
**Approved by:** —
**Affects Standards:** `AGENTS.md` execution governance, `.agents/skills/policy-layer/SKILL.md`, `.agents/skills/agent-permissions/SKILL.md`, `.hseos/config/hseos.config.yaml`
**Supersedes:** N/A
**Superseded By:** N/A
**Depends on:** ADR-0006, ADR-0007, ADR-0008

---

## Context

HSEOS already governs agent execution through task branches, worktree isolation, quality gates, hooks, human approval gates, permissions policy, and audit/state tracking. That boundary controls Git state and engineering workflow integrity, but it does not restrict what an invoked agent process can see or touch at the host OS level.

The reference repository `/opt/references/ai-jail` covers a different layer: process and operating-system isolation through `bwrap` on Linux, optional Landlock/seccomp/rlimits hardening, private home directories, masked files, disabled Docker/display/GPU passthrough, and lockdown mode. Its package is `GPL-3.0-only`, while HSEOS is MIT, so direct code absorption would create licensing and maintenance risk.

This ADR records the intended integration boundary: HSEOS may orchestrate an external sandbox provider, but it must not vendor or reimplement ai-jail internals in the core.

## Decision

HSEOS will add optional OS-level sandbox support through an external `ai-jail` provider.

The initial integration is opt-in:

- `hseos sandbox doctor` reports sandbox readiness without requiring installation by default.
- `hseos sandbox run -- <command...>` builds and executes an ai-jail command using HSEOS profiles.
- `hseos sandbox run --dry-run -- <command...>` prints the command and does not execute ai-jail or the target command.
- `hseos agent-core doctor` includes sandbox readiness as an optional check unless `sandbox.required=true`.

The default HSEOS policy defines two profiles:

- `standard`: writable project, private home, Docker/display/GPU disabled, common secret files masked.
- `lockdown`: ai-jail lockdown mode, no saved ai-jail config, common secret files masked, TCP ports allowlisted only when explicitly configured.

HSEOS will not add broad `Bash(ai-jail:*)` permissions, will not enable ai-jail defaults blindly, and will not bundle ai-jail binaries or Rust source into the MIT core.

## Alternatives Considered

### Option A — External ai-jail provider with HSEOS profiles

- **Description:** Keep ai-jail outside HSEOS and add a thin CLI/config/doctor integration.
- **Pros:** Preserves license boundary, minimal maintenance burden, clear user experience, works as defense in depth.
- **Cons:** Requires users to install ai-jail and platform dependencies separately.
- **Chosen because:** It gives HSEOS a practical OS sandbox path without absorbing GPL code or kernel-hardening maintenance.

### Option B — Absorb ai-jail code into HSEOS

- **Description:** Copy or port ai-jail sandbox implementation into the HSEOS repository.
- **Pros:** Single packaged user experience.
- **Cons:** GPL-3.0-only licensing conflict, high security maintenance burden, exposes HSEOS to low-level sandbox correctness risk.
- **Rejected because:** It conflicts with the MIT core strategy and duplicates specialized sandbox work.

### Option C — Do Nothing

- **Description:** Keep HSEOS limited to worktree/task/process governance.
- **Pros:** No new CLI surface or dependency.
- **Cons:** Agent processes still inherit host-level exposure unless users manually configure external tooling.
- **Rejected because:** Host OS isolation is a real gap that can be addressed with a low-coupling optional provider.

## Consequences

### Positive

- Separates Git/task isolation from host OS/process isolation in a documented policy.
- Adds a low-cognitive-load entry point for users who want sandboxed agent execution.
- Keeps `agent-core doctor` useful as a preflight without making ai-jail mandatory for all installations.
- Avoids GPL code absorption while still reusing proven concepts and operational defaults.

### Negative / Trade-offs

- Sandbox enforcement is not automatic in `dev-squad` or other existing workflows.
- Readiness depends on local platform state: ai-jail, bwrap, user namespaces, AppArmor, and Linux kernel support.
- macOS support is best-effort only because ai-jail relies on legacy `sandbox-exec` there.

### Risks & Mitigations

- **Risk:** Users assume worktree isolation is a security sandbox. **Mitigation:** Document that worktree isolation governs Git while sandbox isolation governs host OS exposure.
- **Risk:** ai-jail defaults expose Docker, display, GPU, or inherited secrets. **Mitigation:** HSEOS profiles disable Docker/display/GPU and mask common secret files by default.
- **Risk:** Optional sandbox check creates false failures in normal installs. **Mitigation:** `sandbox.required=false` by default; doctor only fails when the project explicitly requires sandboxing.
- **Risk:** License contamination from GPL code. **Mitigation:** HSEOS calls ai-jail externally and does not vendor source or binaries.

## Affected Standards

- `AGENTS.md` — execution governance gains optional OS sandbox guidance; branch/worktree rules remain unchanged.
- `.agents/skills/policy-layer/SKILL.md` — tool access and HITL policy must treat sandboxing as defense in depth, not as permission broadening.
- `.agents/skills/agent-permissions/SKILL.md` — broad ai-jail command permissions remain prohibited unless a future ADR defines a least-privilege pattern.
- `.hseos/config/hseos.config.yaml` — adds `sandbox` policy block with provider, required flag, default profile, and profile flags.

## Validation

- `hseos sandbox doctor --json` returns structured readiness checks.
- `hseos sandbox run --dry-run -- codex` prints an ai-jail command without requiring ai-jail to be installed.
- `hseos agent-core doctor` includes a sandbox readiness check and still passes in projects where sandboxing is optional.
- Tests cover missing ai-jail with `required=false` and `required=true`.

## Rollback

- Remove the `sandbox` block from `.hseos/config/hseos.config.yaml`.
- Remove `hseos sandbox` CLI command and sandbox library.
- Remove the sandbox check from `agent-core doctor`.
- Keep this ADR as `Deprecated` or supersede it with a new ADR if a different sandbox strategy is adopted.
