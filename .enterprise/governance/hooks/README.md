# Hook Registry Contract

`registry.yaml` is the canonical hook source. Schema v2 requires every entry to
declare its activation status explicitly:

- `active` is eligible for adapter emission;
- `inactive`, `pending`, and `deprecated` remain visible for governance and are
  not emitted.

The compiler validates the complete canonical registry before writing
`.agents/hooks/registry.yaml`. Schema v1 inputs remain supported only at the
compatibility boundary; an omitted legacy status is normalized to `active`
before adapters receive it.

## Capability intake guard: legacy path known gaps

`handlers/capability-intake-guard.sh` is the decision for projects **without** `.hseos/config/platform-bindings.yaml`.
It is kept byte-for-byte unchanged (a golden test compares its output with a frozen copy). Known gaps of that path:

| Gap                                                                                      | Effect                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `export {}` and `export default class {}` leave the symbol pipeline empty under `set -e` | the hook reports a non-blocking error (exit 1) instead of a decision                                                                                                                                                  |
| the export pattern is narrow                                                             | `export async function`, `export enum`, `export abstract class`, `export const enum`, anonymous `export default`, CommonJS `module.exports`/`exports.x =`, multi-line declarations and most C# types are not detected |
| the acknowledgement is a substring match                                                 | `CORE_INTAKE_ACK=intake` is accepted when any intake document contains the word                                                                                                                                       |
| paths are matched as given                                                               | relative paths and symlink aliases into `packages/` are not watched                                                                                                                                                   |
| `MultiEdit` is not inspected                                                             | the tool input has no `content`, so the call is allowed                                                                                                                                                               |

**Fixed for projects with platform bindings.** As soon as `.hseos/config/platform-bindings.yaml` exists, the handler
hands every Write, Edit and MultiEdit call to `hseos platform-bindings guard` (node starts on each call; the legacy
pre-filters are skipped, so the widened rules below reach the CLI). If the CLI or node is unavailable or fails, the
legacy decision above applies. The guard:

- detects the export forms above, including multi-line declarations and C# `public`/`internal` types;
- ignores comments and string literals (`//`, `/* */`, quoted and template strings; C# verbatim, interpolated and raw
  strings), so `// export class A {}` is not an export;
- does not treat re-exports with a `from` clause (`export * from '…'`, `export { a } from '…'`,
  `export type { T } from '…'`) as new capabilities; a local `export { a, b }` still counts;
- exempts TypeScript declaration files (`*.d.ts`, `*.d.mts`, `*.d.cts`) like test, mock and `dist` files;
- resolves paths against the project root and through symlinks, and evaluates `MultiEdit` edits;
- requires an acknowledgement shaped like an intake reference (prefix, hyphen, a digit, at least five characters) matched
  as a whole token;
- also writes the denial reason to stderr.

Writes through the Bash tool are not intercepted by either path.
