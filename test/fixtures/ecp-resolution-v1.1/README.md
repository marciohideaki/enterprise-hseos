# ECP resolution v1.1 fixtures

Vendored, byte-identical copies of files from the ECP repository (`HideakiSolutions/enterprise-capability-platform`).

- Source branch: `develop` (`origin/develop`; W2 merged by merge commit `88afd1a4b486ed5c35ce89c39298d074341d31cb`)
- Source commit: `88afd1a4b486ed5c35ce89c39298d074341d31cb` (`origin/develop` when vendored; not yet tagged)
- Specification: ECP Decision 0011 (stack vocabulary and targets) and `docs/contracts/resolution-v1.md`

| File                    | ECP path                                                   | sha256                                                             |
| ----------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| `cases.json`            | `contracts/conformance/resolution/cases.json`              | `caa61d3479da8311c58fd9c4962b567fddfcf4fba2b9cf35074946123199df33` |
| `registry.fixture.json` | `contracts/conformance/resolution/registry.fixture.json`   | `91630bebdb5db1da228bebb2e3c2ae1c7b3a9434f9264a35433a744e30342cab` |
| `stacks.json`           | `contracts/stacks.json`                                    | `3493ab2b549d3b91fde521c8be6df4865819dbe5f27e12c358ccd072b81cfb03` |

`cases.json` holds 97 vectors: 78 resolution v1 vectors, unchanged, and 19 v1.1 vectors (stack aliases, directional
non-transitive `accepts`, direct-before-via choice, `missing_targets`). `test/test-capability-resolution-conformance.js`
runs all of them against the HSEOS resolver and the `capability-check` verdict rules, and checks the three hashes
above, so a drifting copy fails the test. The 78 v1 vectors also run without a vocabulary to prove the v1 rules are intact.

Do not edit these files by hand. Refresh them together from the ECP release that ships stack vocabulary 1.0.0, then
update the commit and the hashes here.
