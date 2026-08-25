# G9 Observation Scheduler Deployment Checkpoint

**Artifact type:** Governed goal checkpoint  
**Scope:** Authorized local A22 integration and recurring G9 evidence capture  
**Status:** Scheduler installed, enabled and observing; compatibility cutover remains unauthorized  
**Governing documents:** Enterprise Constitution; ADR-0022; ADR-0023; automated-validation policy  
**Authority:** Explicit human authorization on 2026-08-25 to merge A22 locally and install/activate the proposed G9 timer; no push, migration, provider activation or compatibility cutover

## Local integration

The provider-conformance task commit `d5301bafdfb2152705f32e3ddfad25d7d1b312fc`
was integrated locally into `feature/harness-g9-observation-monitor` by merge commit
`35c137179ac001ac748bb4eb59ff280a0f4298c6`. No remote branch, pull request,
schema, provider endpoint or production profile was changed.

## Deployed observation boundary

The authorized deployment created the private evidence directory
`/opt/hideakisolutions/hseos-compatibility-observation` with mode `0700`, installed
the project-derived user units
`hseos-compatibility-observe-9f48b9461c5d.service` and
`hseos-compatibility-observe-9f48b9461c5d.timer` with mode `0600`, and enabled the
timer for minute 20 of every UTC hour. The generated and installed units are
byte-exact, the timer is enabled and active, and `systemd-analyze --user verify`
accepts the pair.

The timer executes a private local monitor snapshot at
`/opt/hideakisolutions/hseos-releases/35c137179ac001ac748bb4eb59ff280a0f4298c6`.
Its `RELEASE_SHA` is the same integrated commit and its Git tree is
`3b7d2d8dd38160a1ae3a51a32aeb0b24752013c4`. This snapshot supplies only the
new observation command. The operational compatibility services and the
manifest-bound observation target remain release
`5df935d180cf57a36ad321a40bdb09c7552cbe35`; the scheduler does not replace,
migrate or activate that release.

## Runtime correction and evidence

The first generated user service failed before Node with
`218/CAPABILITIES`. Isolated transient-unit probes proved that
`ProtectKernelModules=true` was the sole failing directive on this nested user
manager. The canonical generator now omits only that directive. It retains
`NoNewPrivileges`, `ProtectSystem=strict`, an exact `ReadWritePaths`, kernel
tunable and control-group protection, SUID/SGID restriction, personality lock,
`RestrictAddressFamilies=AF_UNIX` and `IPAddressDeny=any`. The correction does
not grant module-loading capability and leaves the service networkless.

The first corrected manual invocation reached the monitor and atomically wrote
`observation-20260825T030735342Z.json`, SHA-256
`5fe623f847cd572ae56c5deb2aa81d95d6a8ae9e41167027c3375685e438393d`, as
chain member one. It correctly reported degraded current-hour coverage before
the four compatibility observers emitted their next heartbeat. At
`2026-08-25T03:13:12Z`, a read-only recheck reported healthy 4/4 current-hour
coverage, no new legacy use and the unchanged latest legacy request at
`2026-08-24T21:07:20.167Z`. The timer remains fail-closed through
`--require-current-hour`; a degraded observation is evidence, not success or
cutover authority.

The first automatic trigger completed successfully at
`2026-08-25T03:20:14Z` and wrote
`observation-20260825T032014407Z.json`, SHA-256
`3b41aa5dec9cebea345fe44b9043c9dbbeca609d423bb9b5344d7d0b8be23d11`.
The verifier reports a two-member chain with that latest digest and the stable
binding SHA-256
`f5a4b486d52b8b02a09c3e9e54646cf674adc8fda74ab3da31ebb96e54ca1db0`.
The automatic report is healthy, monitor-only and explicitly says both
`ready_for_cutover: false` and `cutover_authorized: false`; the next trigger is
scheduled for `2026-08-25T04:20:00Z`.

Focused observation/plan tests pass 14/14, provider conformance passes 8/8,
lint and diff checks pass, and the independent adversarial verdict is `READY`
with no residual blocker, high or medium finding. The reviewer confirmed that
the delta is minimal and the AF_UNIX plus IP-deny egress boundary remains
closed. The full governed quality gate passed with zero failures and one
historical placeholder warning. Its log is
`.logs/validation/gate-20260825T031648.log`, SHA-256
`3b28d45c60ee80911beed29c9d9343b8b2c1bd6055b4f73879c21a3646b53943`.

## Rollback and remaining gate

Operational rollback is limited to disabling the exact timer, removing the two
exact unit files and reloading the user manager. The evidence directory,
journal and monitor snapshot must be preserved for audit. The deployment begins
durable collection only; it does not retroactively create a valid day.

G9 remains open at 0/30 complete consecutive zero-use UTC days. A real
release-pinned downstream bundle, remote reachability verification, final
stable-snapshot audit, zero internal legacy runtime references and separate
explicit human cutover authorization remain required.
