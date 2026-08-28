# A13 Required Sandbox Runtime Checkpoint

**Artifact type:** Governed goal checkpoint
**Scope:** Real host readiness for the optional external OS sandbox provider
**Status:** Host runtime gate complete; provider activation remains gated
**Authority:** Explicit user authorization to install `ai-jail` and `bwrap`

## Outcome

The Ubuntu 24.04 x86_64 host now has the external AkitaOnRails `ai-jail`
provider and its Linux `bubblewrap` backend. HSEOS continues to keep
`sandbox.required: false` globally; installation does not activate a model,
runtime profile, credential, network route, schema or protocol.

The initial binary-only preflight was insufficient. A real lockdown smoke
failed because Ubuntu's AppArmor user-namespace restriction prevented `bwrap`
from configuring loopback. The project-recommended narrow AppArmor profile was
installed for `/usr/bin/bwrap`; the global
`kernel.apparmor_restrict_unprivileged_userns=1` protection remains enabled.
After that correction, direct and HSEOS-mediated lockdown smokes completed and
reported fully enforced Landlock isolation.

The run also exposed a false-negative HSEOS preflight: `forceRequired` treated
the global AppArmor sysctl as a hard failure even when the scoped profile made
the sandbox functional. The doctor now runs a clean, non-networked lockdown
probe using `/usr/bin/true`. A successful probe satisfies the AppArmor check;
an installed-but-nonfunctional backend fails required readiness. This proves
effective isolation instead of inferring it from binary presence or one sysctl.

## Environment evidence

- `ai-jail 1.20.0`, installed from the locked crates.io release
- `ai-jail` SHA-256: `9dbb68ebd94166423e2550c722bbde15f34ecabc3c14f5731fd355f77cc9870e`
- `bubblewrap 0.9.0-1ubuntu0.1 amd64`, installed from Ubuntu Noble updates
- `/usr/bin/bwrap` SHA-256: `52231e1caf55bcbc667b269f49c63599a6f7db4767ae6a039580d0ff853db712`
- AppArmor service active; scoped `bwrap` profile loaded
- Global AppArmor user-namespace restriction remains enabled
- Direct clean lockdown smoke: passed
- `hseos sandbox run --profile lockdown`: passed
- Required HSEOS runtime probe: passed with zero warnings/errors

## Repository evidence

- `tools/cli/lib/sandbox.js`
- `test/test-sandbox-cli.js`
- `test:sandbox` — 7/7
- `test:bound-kernel-supervisor` — 5/5
- Delegated ACP one-shot CLI suite — 6/6
- `test:agentic-activation` — 4/4
- `test:verify` — 20/20
- `npm run lint` — passed
- `git diff --check` — passed
- Full governed gate — 0 failures, 1 unrelated historical documentation warning
- `.logs/validation/gate-20260824T031409.log`
- SHA-256 `3bc032ab9e0b50ff92aac40958fd1ba0fda2b4dd5a0d524874af10963064db71`

No credential was read, no model/provider request was made and no operational
HSEOS data or schema was changed.

## Remaining gates

- Bind a selected provider environment and its allowed TCP port without
  persisting credential values.
- Run any real provider smoke only under separate credential/network authority.
- Complete harness-unification G9's zero-legacy-use window.
- Repeat the final stable-snapshot audit.
- Obtain explicit human authorization before operational cutover.

## Rollback

The host installation can be reversed independently by uninstalling the Cargo
package, unloading/removing the scoped `/etc/apparmor.d/bwrap` profile and
removing the Ubuntu `bubblewrap` package. The repository correction is one
isolated task commit and does not change the optional global policy.
