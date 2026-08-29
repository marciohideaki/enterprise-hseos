# G9 Observation Schedule Plan Checkpoint

**Artifact type:** Governed goal checkpoint
**Scope:** Deterministic recurring observation deployment plan
**Status:** Plan capability complete; no unit installed or enabled
**Governing documents:** Enterprise Constitution; ADR-0022; ADR-0023; automated-validation policy
**Authority:** Plan-only; operational deployment and cutover remain unauthorized

## Capability

`compatibility-observe-plan` converts one explicit project, evidence directory,
Node executable, CLI path and hourly UTC minute into a deterministic canonical
plan. The plan contains one project-derived instance identity, the exact argv
and environment, prerequisites, rollback instructions and a systemd user
service/timer adapter.

The service is oneshot, networkless and restricted to the declared evidence
directory. It disables the CLI update check, requires a healthy current-hour
observation, preserves JSON output in the supervising journal and relies on the
schema-v2 capture path to append atomic scope-bound evidence. The persistent
timer defaults to minute 20 of each UTC hour so a 15-minute heartbeat cadence
has time to populate the current bucket.

## Fail-closed properties

- Project, Node, CLI and evidence inputs must be absolute real paths without
  symlink traversal; Node must be executable and files cannot be hard-linked.
- An existing evidence directory must be private and cannot live under the
  operational state directory.
- Systemd command arguments and directive paths use separate escaping rules;
  control characters are rejected.
- The generated units use `ProtectSystem=strict`, an exact `ReadWritePaths`,
  `NoNewPrivileges`, `PrivateTmp`, kernel/control-group protection,
  `RestrictAddressFamilies=AF_UNIX` and `IPAddressDeny=any`.
- Every result says `plan_only: true` and `activation_authorized: false`.

## Verification

- Four focused tests prove deterministic output, zero filesystem effects,
  permission/path/executable rejection, metacharacter escaping, public CLI JSON
  behavior and successful offline `systemd-analyze verify` on the current host.
- The compatibility suite includes the schedule-plan tests alongside audit and
  observation coverage.
- The complete quality gate passed with zero failures and one historical
  warning. Its immutable validation log is
  `.logs/validation/gate-20260824T230536.log` with SHA-256
  `50d593c981468b739c8253258597fcd0be02f56c24558768c704ce27cd5657d0`.
- No systemd manager, evidence directory, live database, manifest or process was
  changed while generating or testing the plan.

## Rollback and gate

Before deployment, discard this task commit to remove the planning surface. If
deployment is later authorized, disable and remove only the project-derived
timer/service while preserving the evidence directory and journal. Installation
or enablement still requires explicit operational authorization and does not
authorize A13/G9 cutover.
