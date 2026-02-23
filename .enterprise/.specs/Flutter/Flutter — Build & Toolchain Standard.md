# Flutter / Dart — Build & Toolchain Standard
## Gold Standard / State-of-the-Art

**Version:** 1.0
**Status:** Canonical / Normative
**Runtime:** Flutter 3.19+ / Dart 3.3+

> Defines mandatory build system, toolchain configuration, and CI gate requirements for Flutter apps.

---

## 1. SDK Version Management

- BT-01: Flutter SDK version pinned in `.fvmrc` (FVM) or `pubspec.yaml` `environment.flutter` constraint.
- BT-02: FVM (Flutter Version Manager) used for team-consistent SDK versions.
- BT-03: Dart SDK version: `environment: sdk: ">=3.3.0 <4.0.0"` in `pubspec.yaml`.
- BT-04: `flutter --version` output pinned in CI environment spec.

---

## 2. Dependency Management

- BT-05: `pubspec.lock` committed — never gitignored.
- BT-06: Dependency versions: `^x.y.z` (semver compatible) — no `any` or open ranges.
- BT-07: `flutter pub outdated` run periodically — tracked in dependency review.
- BT-08: `dart pub audit` run in CI — known CVEs block build (when available).
- BT-09: Dev dependencies (`dev_dependencies`) clearly separated from production dependencies.

---

## 3. Code Generation

- BT-10: `build_runner` used for code generation — `flutter pub run build_runner build --delete-conflicting-outputs`.
- BT-11: Generated files committed to repo — not generated in CI (avoids version drift).
- BT-12: `freezed` used for immutable data classes with `copyWith`, `==`, `hashCode`, `toString`.
- BT-13: `json_serializable` used for JSON serialization in Infrastructure layer.
- BT-14: `injectable` + `get_it` used for dependency injection wiring.

---

## 4. Static Analysis

- BT-15: `analysis_options.yaml` committed with `flutter_lints` base + project-specific rules.
- BT-16: Lint rules: `lints: recommended`, `flutter_lints: recommended`, plus:
  - `avoid_print: true`
  - `prefer_const_constructors: true`
  - `prefer_const_declarations: true`
  - `avoid_unnecessary_containers: true`
- BT-17: `dart analyze` in CI — zero errors, zero warnings policy.
- BT-18: `dart fix --dry-run` checked in CI — no auto-fixable issues outstanding.

---

## 5. Code Formatting

- BT-19: `dart format` enforced — `dart format --set-exit-if-changed .` in CI.
- BT-20: Line length: 80 chars (Dart default) — configured in `analysis_options.yaml`.

---

## 6. CI Gates

All must pass before PR can be merged:

- BT-21: `flutter analyze` — zero errors/warnings.
- BT-22: `dart format --set-exit-if-changed .` — zero formatting violations.
- BT-23: `flutter test` — all unit and widget tests pass.
- BT-24: `flutter test --coverage` — coverage thresholds met.
- BT-25: `flutter build apk --release` and `flutter build ios --release` — zero build errors.
- BT-26: Integration tests pass (`flutter test integration_test/`).

---
