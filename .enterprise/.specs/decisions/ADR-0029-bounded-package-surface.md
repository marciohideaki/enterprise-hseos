# ADR-0029: Bounded Package Surface

## Status

Accepted on 2026-08-28 by explicit human authorization.

## Context

The root package relied on npm's `.gitignore` fallback and published the whole
tracked repository. The resulting archive included tests, internal goal-graph
evidence, run histories, CI files, logs, and a redundant specification archive.
That expanded install size, exposed non-runtime records, and made future files
publishable by accident.

The package still needs source governance, compiled portable assets, workflow
definitions, runtime modules, CLI code, and governance scripts so install and
compile remain standalone.

## Decision

The root package uses an explicit `files` allowlist. It publishes only:

- root entrypoint, security, changelog, license, and package metadata;
- `.agents`, `.enterprise`, and `.hseos` runtime/governance assets;
- `packages`, `scripts`, `src`, and `tools` implementation trees.

Run histories, tests, internal graph evidence, CI configuration, logs, and the
redundant specification archive are excluded. `.hseos/runs` is never published.
The duplicate binary specification archive is removed from the repository; the
versioned source files remain canonical.

A package-surface test verifies required runtime assets, forbidden prefixes,
entry count, and unpacked size on every full test run.

## Alternatives Considered

### Maintain a large `.npmignore`

Rejected because deny lists publish new top-level files unless every addition
is reviewed against package policy.

### Publish only CLI JavaScript

Rejected because standalone installation requires governance, workflows,
skills, source modules, and compiled adapter assets.

### Keep the binary specification archive outside the package

Rejected because it would remain a redundant, drift-prone repository artifact.

## Consequences

### Positive

- Package contents are intentional and regression-tested.
- Internal evidence and run history are not distributed.
- Unpacked size and archive size are substantially reduced.
- The declared MIT license now has a packaged license file.

### Negative

- New runtime top-level directories require an explicit allowlist update.
- Repository-only documentation and tests are unavailable in installed
  packages.

## Mitigations

- Test representative assets from every required runtime tree.
- Keep README, changelog, security policy, and license automatically available
  to package consumers.
- Bound both file count and unpacked bytes with headroom for controlled growth.

## References

- `package.json`
- `test/test-package-surface.js`
- `ADR-0006-standalone-architecture.md`
