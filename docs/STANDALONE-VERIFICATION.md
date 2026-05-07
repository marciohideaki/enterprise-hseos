# Standalone Verification — Smoke Test Procedure

> **Purpose:** verify HSEOS bootstraps and operates from a clean clone with no host-machine state, no global agent skills, no second-brain vault, and no pre-installed MCP servers. This is the acceptance gate for ADR-0006 Principle P5 ("zero global path") and P6 ("graceful degradation").
>
> **When to run:**
> - End of Wave 1 (this PR) — proves the decoupling closed all P5 violations
> - End of Wave 8 (Docs + Tests) — full v2.0 pre-release acceptance
> - In CI on every PR via `.github/workflows/standalone-smoke.yml` (lands in Wave 6)

---

## Procedure (manual, ~5 minutes)

### 1. Prepare an isolated environment

```bash
# Pull a clean Node.js image so no host-state can leak in.
docker run --rm -it -v "$PWD":/repo -w /repo node:20 bash
```

Inside the container:

```bash
# Belt-and-suspenders: assert no agent state is mounted from the host.
test ! -d ~/.claude     || { echo "FAIL: ~/.claude leaked"; exit 1; }
test ! -d ~/.codex      || { echo "FAIL: ~/.codex leaked";  exit 1; }
test ! -d /opt/hideakisolutions/second-brain \
                        || { echo "FAIL: vault leaked";       exit 1; }

# Confirm we're at the standalone-w1 baseline (or later).
git rev-parse --abbrev-ref HEAD
git log --oneline -1
```

### 2. Install dependencies and validate the manifest

```bash
npm ci
npm run validate:schemas    # JSON-Schema validation of .agents/, .hseos/
npm run lint                # 0 warnings expected (project enforces zero-warning)
```

### 3. Run the installation component test suite

```bash
npm run test:install
```

Expected:
- 14 agent schema tests pass
- 24 installation component tests pass (including: `.agents/manifest.yaml has portable adapters and skills`, `hseos.config.yaml is valid YAML`)

### 4. Verify the standalone invariant set

```bash
# P5 — Zero global path: no runtime asset references ~/.claude or
# /opt/hideakisolutions/second-brain or absolute $HOME paths.
! grep -rn "~/\\.claude\\|/opt/hideakisolutions/second-brain" \
    .agents/ .hseos/ .enterprise/governance/ scripts/governance/ \
    || { echo "FAIL: P5 violation detected"; exit 1; }

# P6 — Graceful degradation: the second-brain skill carries
# vault_required: false in its frontmatter.
grep -q "vault_required: false" .agents/skills/second-brain/SKILL.md
grep -q "vault_required: false" .agents/skills/second-brain/QUICK.md
```

### 5. Smoke the state-tracking subsystem

```bash
npm test    # full suite — DAL, CLI, render lib, SSE, kanban
```

Expected: `npm test` exits 0 with "Tests: passed" on every subgate.

---

## Acceptance criteria

A clone is **standalone-compliant** when **every** check below passes in a clean Docker environment:

- [ ] `npm ci` succeeds (no network calls beyond npm registry)
- [ ] `npm run validate:schemas` exits 0
- [ ] `npm run lint` exits 0 with **0 warnings**
- [ ] `npm run test:install` reports 14 agent + 24 component tests passed
- [ ] `npm test` reports the full state-tracking suite green
- [ ] `grep` checks for `~/.claude` and `/opt/hideakisolutions` return zero matches inside `.agents/`, `.hseos/`, `.enterprise/governance/`, and `scripts/governance/`
- [ ] `vault_required: false` appears in both the second-brain SKILL.md and QUICK.md frontmatter

---

## Known limitations (Wave 1 baseline)

The following items are **expected** to fail standalone today and become green at the wave indicated:

| Check | Expected at | Wave |
|---|---|---|
| `hseos doctor` returns 0 in standalone | command lands in W6 | Wave 6 |
| `hseos audit` reports zero drift | command lands in W6 | Wave 6 |
| `hseos verify` matches all hashes | manifest v2 + signatures land in W2 | Wave 2 |
| `.mcp.json` ships in the repo and is validated | bundle policy lands in W3 | Wave 3 |
| 6 platform adapters compile from `.agents/` | compiler v2 lands in W2 | Wave 2 |
| `.claude-plugin/marketplace.json` exists | plugin marketplace lands in W5 | Wave 5 |

Wave 1 closes the **P5 zero-global-path** violations only. Subsequent waves layer on the rest of the standalone contract.

---

## Failure response

If any check fails in CI or locally:

1. **Do not bypass.** The standalone smoke test is a constitutional gate per ADR-0006.
2. Open a `task/` branch off the relevant wave's `feature/` branch and fix the root cause.
3. If the failure surfaces a missing requirement that the current wave plan does not cover, escalate to ORBIT and draft an ADR amendment before fixing.
4. Re-run the full procedure inside Docker before merging the fix.
