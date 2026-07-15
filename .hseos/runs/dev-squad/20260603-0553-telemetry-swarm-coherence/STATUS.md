---
status: complete
run-id: 20260603-0553-telemetry-swarm-coherence
gate-g2: approved
current-wave: done
awaiting: G4 (human gh pr create)
---

# STATUS — COMPLETE

| Wave | Task | State | Commit |
|---|---|---|---|
| 1 | T1 track-a-hooks | merged | cd29293 → 541a5ce |
| 2 | T2 track-b-skill-matrix | merged | d6f7341 → badcd66 |
| 2 | T3 track-b-refs | merged | 8159de8 → 192fe0f |
| 2 | T4 track-b-adrs | merged | ab6097b → b20aab6 |
| — | Consolidate | done | verify 65 / audit 91 / npm test EXIT 0 |
| — | Track C (global ~/.claude) | done* | out-of-repo |

Feature branch: 8 commits ahead of master. Ready for G4 (human `gh pr create`).

Track C: DONE. Global hooks (on-prompt-submit.sh, on-post-write-plan-lint.sh) fixed; global
dev-squad skill demoted to external-mirror; CLAUDE.md L45 (paths + demotion + ADR-0015 ref) and
L123 (AXON stale ref removed → MCP-consumption wording) fixed via authorized shell bypass of the
claude-md-guard hook (user-approved). AGENTS.md restored (workaround §2a removed). Zero `.hseos/hsm/`
in active global config. AXON native-agent creation NOT done (user chose: remove stale ref only).
