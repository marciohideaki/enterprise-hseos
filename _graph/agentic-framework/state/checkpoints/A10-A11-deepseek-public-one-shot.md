# A10/A11 DeepSeek Public One-Shot Checkpoint

**Artifact type:** Governed goal checkpoint
**Scope:** Sandboxed public run-only profile for the external DeepSeek ACP runtime
**Status:** Complete for deterministic candidate assembly; operational activation remains gated
**Authority:** Explicit user instruction to proceed; no provider activation inferred

## Outcome

HSEOS now exposes `agent-deepseek-one-shot-candidate` through the same public
`hseos agent run` surface used by its other agent profiles. The profile binds a
canonical executable, ACP entrypoint, exact tool-free composition, working
directory, selected environment names, secret references and one network port.
It deliberately rejects `resume`, `cancel` and `create-only`, matching the
connection-owned lifecycle of the referenced DeepSeek ACP implementation.

The public route requires the existing `ai-jail` lockdown supervisor. Sandbox
readiness is verified before the declared secret is read or a worker is
launched. The worker receives only the selected environment, and the binding,
entrypoint, composition and working directory must be inside the sandboxed
project. A canonical binding digest crosses the supervisor boundary and is
recomputed inside the worker; content drift between authorization and ACP spawn
fails closed. The composition and executable hashes are revalidated again
immediately before the external process is created.

One provider instance performs ACP create and prompt in the same process, then
persists normalized terminal truth in the delegated runtime ledger. The durable
manifest contains names, hashes, references and sandbox evidence, but never a
resolved secret. The candidate remains non-operational and makes no claim of
cross-process DeepSeek resume or cancellation.

## Evidence

- `tools/cli/lib/delegated-deepseek-runtime.js`
- `tools/cli/lib/delegated-deepseek-supervisor.js`
- `tools/cli/lib/delegated-deepseek-worker.js`
- `tools/cli/commands/agent.js`
- `.agents/capabilities/profiles.yaml`
- `.agents/capabilities/components.yaml`
- `.agents/activation/provider-bindings/deepseek-acp.example.yaml`
- `test/test-delegated-deepseek-cli.js`
- `test:delegated-deepseek-cli` — 6/6
- `test:runtime-providers` — 63/63
- `test:delegated-runtime-host` — 9/9
- `test:agent-capability-cli` — 8/8
- `test:capabilities` — 112/112
- `validate:schemas` — passed
- Full quality gate — 0 failures, 1 unrelated historical documentation warning
- Strict-mode exit remains non-zero because warnings are fatal; no false strict-pass claim
- `.logs/validation/gate-20260824T023439.log`
- SHA-256 `0fd95848a18397613ef4acb4a663243fa0c3cdb9366c3acf2355f68997428c58`
- DeepSeek reference commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

No real credential was read, no model request was made, no external DeepSeek
runtime was activated and no operational schema or protocol was changed.

## Remaining gates

- Prove readiness with the real required `ai-jail` binary.
- Run the separately authorized, sanitized provider-environment probe.
- Complete harness-unification G9's consecutive zero-legacy-use window.
- Repeat the final stable-snapshot A12/A13 audit.
- Obtain explicit human authorization before any operational cutover.
