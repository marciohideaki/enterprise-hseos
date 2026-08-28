# A10/A11 Tool-Free One-Shot Composition Checkpoint

**Artifact type:** Governed goal checkpoint
**Scope:** Hash-bound tool-free ACP composition and honest one-shot lifecycle
**Status:** Partial — composition gate complete; sandboxed public CLI remains open
**Authority:** Explicit user instruction to proceed; no provider activation inferred

## Outcome

The HSEOS external ACP adapter can now distinguish an arbitrary deployment from
an exact tool-free composition. The validator accepts only the declared model
adapter and ACP process plugin, with workspace context, skills, Bash, job tools
and goals all disabled. Unknown
fields, additional plugins, multiple models, route mismatch, symlinks and
hardlinks fail closed. Accepted source produces an immutable SHA-256 evidence
reference and the explicit lifecycle `one_shot`.

That host-side evidence may satisfy the missing ACP `instructions_only`
metadata for the exact validated composition. It permits a no-op host
reattachment only while the original process and session are still live, which
allows a future create+send one-shot assembly. A new provider still requires
ACP `loadSession` and returns `capability_unavailable` when the external
runtime does not provide it. No durable lifecycle capability was added to the L0 manifest.

## Evidence

- External ACP composition validator
- Canonical tool-free provider-binding example
- External ACP composition test suite
- `test/test-process-acp-peer.js`
- `npm run test:runtime-providers` — 63/63
- `npm run lint -- --no-warn-ignored` — passed
- Full strict gate — 0 failures, 1 unrelated historical warning
- `.logs/validation/gate-20260824T021403.log`
- SHA-256 `ac0a7a0198691c98778e2d52c8c7820d546cf5cf7e40df29861632af1d5d5641`
- Deterministic fixtures prove that disable switches prevent effectful consumers from being mounted

No credential was read, no model request was made and no external runtime was
activated.

## Remaining gate

Before a public ACP one-shot profile exists, the assembly must run under
the required OS-sandbox supervisor, revalidate the composition hash immediately
before process spawn, bind the executable and arguments immutably, persist the
normalized terminal truth, and reject `resume`, `cancel` and `create-only` as
unsupported profile actions.
