# A13 Checkpoint — Provider Binding and Environment Gate

**Status:** binding/configuration plane completed in an isolated task worktree; no real provider probe or activation
**Baseline:** `afddd96`
**Authority:** active model-agnostic framework goal and prior authorization to proceed; secret access and cutover remain separate gates
**Scope:** immutable OpenAI-compatible binding, late secret resolution, provider registry assembly and sandbox-gated environment probe

## Outcome

The candidate profile is no longer only a catalog declaration. A strict provider-binding schema now materializes a concrete endpoint, model, capabilities, limits, transport policy and secret reference into an immutable `ModelProviderRegistry` snapshot. The factory returns the same provider port consumed by the Agent Kernel; no kernel source branch depends on the chosen endpoint or model.

`hseos agent-provider-validate --binding <yaml>` validates the binding without reading its secret or performing network I/O. `--probe` is explicit and remains blocked before secret resolution or HTTP dispatch unless the required `ai-jail` lockdown environment is green. Successful probes expose normalized event types and opaque response evidence only; provider text and credential values do not enter the report.

The shipped example uses `env://HSEOS_MODEL_PROVIDER_API_KEY` as a reference, never a value. `env://` is resolved by the built-in adapter only at dispatch. `secret://`, `file://`, `vault://` and `keychain://` require an explicitly injected resolver; missing or failed resolvers become sanitized `unauthorized` provider evidence.

## Adversarial evidence

- Nested binding state and registry manifests are immutable.
- In-memory callers cannot bypass the file parser with `operational:true`, `authorized:true`, unknown fields or weakened secret declarations.
- Symlinks and hardlinks are rejected.
- URLs containing credentials, query strings, fragments or non-HTTP protocols are rejected.
- Structural validation performs zero secret reads and zero fetches.
- Missing required sandbox performs zero secret reads and zero fetches.
- Missing secrets fail with an allowlisted error code and no resolver details.
- A successful fake-endpoint probe proves the exact Authorization dispatch and emits only `content.delta`, `usage`, `completed` evidence.

## Verification

- `npm run test:agent-provider-binding` — 8/8.
- `npm run test:agentic-activation` — 4/4.
- `npm run test:model-providers` — 15/15.
- `npm run test:capabilities` — 97/97.
- Strict worktree-manager gate — 0 failures, 1 unrelated historical placeholder warning.
- Gate log — `.logs/validation/gate-20260823T235433.log`.
- Gate SHA-256 — `39511532961e378d5934c318725bcf257bea887008d24030450f26a1d0c6ed54`.
- ESLint and `git diff --check` — passed.

## Boundary and next action

No real secret was accessed, no real endpoint was contacted and no operational state changed. The next reversible implementation step is to bind this immutable snapshot into the generic temporary Agent Kernel run/resume/cancel assembly. Operational use still requires the sandbox, real provider probe, G9 window, final stable audit and explicit cutover authorization.
