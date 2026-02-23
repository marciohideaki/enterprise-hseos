# React Native / TypeScript — Build & Toolchain Standard
## Gold Standard / State-of-the-Art

**Version:** 1.0
**Status:** Canonical / Normative
**Runtime:** React Native 0.73+ / TypeScript 5.3+ / Node 20+

> Defines mandatory build system, toolchain configuration, and CI gate requirements for React Native apps.

---

## 1. Runtime & Language Version

- BT-01: React Native 0.73+ for all new projects.
- BT-02: TypeScript 5.3+ — version pinned in `package.json` `devDependencies`.
- BT-03: Node.js 20 LTS pinned via `.nvmrc` or `.node-version`.
- BT-04: `"strict": true` in `tsconfig.json` — non-negotiable.
- BT-05: `engines` field in `package.json`: `{ "node": ">=20.0.0" }`.

---

## 2. Package Management

- BT-06: npm or Yarn Classic (1.x) — choice consistent within project, documented in README.
- BT-07: Lockfile (`package-lock.json` / `yarn.lock`) committed — never gitignored.
- BT-08: `npm ci` (or `yarn --frozen-lockfile`) used in CI — not `npm install`.
- BT-09: Exact versions for critical dependencies (`"react-native": "0.73.4"`) — `^` allowed for dev dependencies.
- BT-10: `npm audit` / `yarn audit` run in CI — high/critical CVEs block build.

---

## 3. Static Analysis (ESLint)

- BT-11: ESLint 8+ with TypeScript parser (`@typescript-eslint/parser`).
- BT-12: Mandatory plugins:
  - `@typescript-eslint` — TypeScript-aware rules
  - `react-hooks` — hooks rules enforcement
  - `react-native` — RN-specific rules
  - `import` — import ordering
- BT-13: Rules enforced (non-exhaustive):
  - `@typescript-eslint/no-explicit-any: error`
  - `@typescript-eslint/no-unused-vars: error`
  - `react-hooks/rules-of-hooks: error`
  - `react-hooks/exhaustive-deps: error`
  - `no-console: warn`
- BT-14: ESLint failures in CI are build failures.
- BT-15: `.eslintrc.js` committed — no inline `eslint-disable` without ticket reference comment.

---

## 4. Code Formatting (Prettier)

- BT-16: Prettier 3+ for code formatting — `.prettierrc` committed.
- BT-17: Prettier config: `{ "singleQuote": true, "trailingComma": "all", "printWidth": 100 }`.
- BT-18: `prettier --check .` run in CI — unformatted code blocks merge.
- BT-19: ESLint + Prettier integrated via `eslint-config-prettier` — no rule conflicts.

---

## 5. Type Checking

- BT-20: `tsc --noEmit` run in CI as separate type-check step.
- BT-21: Zero TypeScript errors — `strict: true` enforced.
- BT-22: `tsconfig.json` `paths` used for absolute imports — no `../../..` relative hell.

---

## 6. CI Gates

All must pass before PR can be merged:

- BT-23: `tsc --noEmit` — zero type errors.
- BT-24: `eslint . --max-warnings 0` — zero lint violations.
- BT-25: `prettier --check .` — zero formatting violations.
- BT-26: `jest --coverage` — all tests pass, coverage thresholds met.
- BT-27: `npm audit --audit-level high` — zero high/critical CVEs.
- BT-28: E2E tests pass (Detox — if configured).
- BT-29: `react-native bundle` — iOS and Android bundles build without error.
