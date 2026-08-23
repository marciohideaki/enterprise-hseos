# G7 Checkpoint — Capability Schema v2 and Exact Materialization

**Status:** completed
**Completed:** 2026-08-21T16:01:41Z
**Scope:** capability catalog, resolver, compiler-owned skill/adaptor output, installer wiring, tests, and documentation
**Operational data:** unchanged

## Delivered

- Promoted both capability documents to fail-closed schema v2.
- Rejected unknown fields, duplicate IDs/values, malformed families and references, unsafe POSIX/Windows paths, inherited-object keys, invalid hook modes, invalid defaults, and any change to the exact three-component mandatory baseline.
- Removed repeated baseline declarations from profiles; the resolver injects the baseline deterministically and profiles cannot override or repeat it.
- Normalized equivalent selector sets to byte-equivalent plans and made generated skill paths explicit in `install_paths`.
- Wired `capabilityPlan.skills` into the real installer/compiler path. The compiler now emits only selected governed skills, fails when selected and emitted sets diverge, and removes stale compiler-owned skill files on profile changes.
- Reconciled Goose mirrors and removes a prior Goose surface only when the prior manifest proves compiler ownership.
- Connected `adapter:goose` to the real Goose emitter; every profile now proves selected adapters equal emitted platforms.
- Preserved legacy installs without a capability plan: `selectedSkills` remains undefined and all governed skills compile as before.

## Deterministic evidence

- `node test/test-capability-catalog.js`: **87 passed, 0 failed**.
- Every one of the seven profiles proves:
  - selected skills equal manifest skills;
  - selected skills equal generated directories;
  - planned skill paths equal emitted `SKILL.md`/`QUICK.md` files;
  - selected adapters equal emitted manifest platforms;
  - the exact mandatory baseline remains present.
- `full -> minimal` proves stale skills and the previously generated Goose surface are removed.
- `npm run lint -- --no-cache`: exit 0.
- `git diff --check`: exit 0.
- `./scripts/governance/quality-gates.sh --phase code --strict`: exit 0, **0 failures, 0 warnings**.
- Final quality log: `.logs/validation/gate-20260821T160020.log`.
- Final quality log SHA-256: `d1751a7a05b043608a64523253e992ef3f491f85bdf766a1abb6ebead3a5790c`.

## Independent verification

The independent verifier first falsified Goose activation, prototype-chain lookups, hook-profile closure, and cross-platform path validation. Each finding became a regression test. A second pass found Windows root-relative/device paths; the implementation moved to `path.win32.isAbsolute`. The final pass reported **PRONTO para G7**, with zero residual BLOCKER/HIGH/MEDIUM/LOW findings.

## Safety and rollback

- No deployment, push, operational database migration, or production protocol activation occurred.
- Legacy non-profile compilation remains available for the bounded compatibility window.
- Rollback is the isolated G7 commit; generated target surfaces can be regenerated from the prior compiler/catalog contract.

## Handoff

G8 may normalize plugins against the now-exact capability surface. Scaffold plugins must not remain active, and generated adapter trees remain outputs rather than authoring sources.
