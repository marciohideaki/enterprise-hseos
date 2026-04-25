# E2E_GATE — Wave 3 Human Smoke Test (Gate G3)

**Owner:** Marcio (human)
**Run:** 20260425-2010-state-w3-validation
**Purpose:** validate Sprint 1 dual-write end-to-end against a real `/dev-squad` invocation. Mark Sprint 1 feature-complete only after this passes.

## Pre-flight

1. Wave 1+2+3 PRs merged into master (#41, #42, this one).
2. Working from latest `master`.
3. `better-sqlite3` installed locally:
   ```bash
   npm install --save-optional better-sqlite3
   ```
4. CLI available:
   ```bash
   hseos --version       # or: npm link && hseos --version
   ```

## Smoke checklist

### 1. Bare CLI smoke (no skill involvement)

```bash
TMP=$(mktemp -d)
hseos state-emit start --directory "$TMP" --run R-smoke --task T1 --agent ME --silent
hseos state-emit heartbeat --directory "$TMP" --run R-smoke --task T1 --agent ME --silent
hseos state-list --directory "$TMP"
hseos state-describe R-smoke --directory "$TMP"
hseos state-render R-smoke --directory "$TMP" --output "$TMP/render"
ls "$TMP/render"   # PLAN.md  RESUME-PROMPT.md  STATUS.md
```

✅ **Pass criteria:** all commands exit 0; render directory contains the 3 markdown files; `state-describe` shows 1 task + 1 agent_run + recent events.

### 2. Orphan detection

```bash
sqlite3 "$TMP/.hseos/state/project.db" \
  "UPDATE as_agent_runs SET last_heartbeat_at = datetime('now', '-30 minutes')"
hseos state-list --orphans --directory "$TMP"
```

✅ **Pass criteria:** the agent_run appears in the orphan list (since heartbeat is 30 min old, threshold default 10).

### 3. Dual-write integration with `/dev-squad`

In a real HSEOS repo with at least 3 small heterogeneous tasks:

```bash
export HSEOS_CURRENT_RUN_ID=$(date +%Y%m%d-%H%M)-e2e
export HSEOS_CURRENT_AGENT=SWARM
hseos state-emit start --silent

/dev-squad <prompt heterogêneo>
# Approve PLAN at G2.
# Let it run a wave or two.
```

In another shell, observe live state:

```bash
hseos state-list
hseos state-describe "$HSEOS_CURRENT_RUN_ID"
```

✅ **Pass criteria:**
- `as_runs` row exists with the run id.
- `as_events` shows `start` + `tool_call` events as the session proceeds.
- Manual `state-emit heartbeat` calls update `last_heartbeat_at`.
- After session kill (close terminal mid-wave), `hseos state-list --orphans --stale-minutes 1` shows the run.

### 4. Render-from-SQLite consistency check

After a real run with markdown run-dir populated:

```bash
RUN_ID=<your-run-id>
hseos state-render "$RUN_ID" --output /tmp/rendered
diff /tmp/rendered/PLAN.md .hseos/runs/dev-squad/"$RUN_ID"/PLAN.md
# Diff is expected — markdown is hand-authored, render is projection.
# Document the structural similarity in the wave report.
```

✅ **Pass criteria:** rendered PLAN/STATUS contain the run id, project, phase, and at least the task IDs that were tracked. Exact byte-equality is NOT a Sprint 1 requirement (achieved only after Wave 5 inversion).

## Failure escalation

- Any command exits non-zero → log output, file Issue, halt promotion of Wave 3 PR.
- DB file not created → check `better-sqlite3` install, check `.hseos/state/` permissions.
- Hook shim crashes Claude Code session → revert `.claude/hooks.json` Stop entry, reproduce, file Issue.

## Sign-off

When all four sections pass:

- [ ] Section 1 — bare CLI smoke
- [ ] Section 2 — orphan detection
- [ ] Section 3 — `/dev-squad` integration
- [ ] Section 4 — render consistency

After sign-off: comment "G3 PASSED" on Wave 3 PR, then merge.

After Wave 3 merge: Sprint 1 is feature-complete. Sprint 2 (Wave 4 MCP expansion + Wave 5 inversion) opens.
