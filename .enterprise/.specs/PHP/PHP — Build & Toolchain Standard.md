# PHP — Build & Toolchain Standard
## Gold Standard / State-of-the-Art Backend Engineering

**Version:** 1.0
**Status:** Canonical / Normative
**Runtime:** PHP 8.3+

> Defines mandatory build system, toolchain configuration, and CI gate requirements for PHP services.

---

## 1. Runtime & Language Version

- BT-01: PHP 8.3 minimum for all new services.
- BT-02: PHP version pinned via `.php-version` file (phpenv) or Dockerfile `FROM php:8.3-fpm-alpine`.
- BT-03: `declare(strict_types=1)` enforced on all files — PHP-CS-Fixer rule `declare_strict_types` enabled.
- BT-04: OPcache enabled and configured for staging and production.

---

## 2. Dependency Management (Composer)

- BT-05: Composer 2.x required.
- BT-06: `composer.lock` committed — never gitignored.
- BT-07: `composer install --no-dev --optimize-autoloader` used in production builds.
- BT-08: No version ranges with `*` — use `^x.y` (semver compatible) or `~x.y.z` (patch only).
- BT-09: `composer audit` run in CI — known CVEs block build.
- BT-10: `composer outdated` run periodically — tracked in dependency review process.

---

## 3. Static Analysis

- BT-11: PHPStan at **level 8** minimum — `phpstan.neon` committed to repo.
- BT-12: PHPStan `strict-rules` extension enabled.
- BT-13: PHPStan baseline (`phpstan-baseline.neon`) used ONLY for legacy code — new code never added to baseline.
- BT-14: Psalm as alternative to PHPStan — same strictness requirements apply.
- BT-15: PHPStan/Psalm failures in CI are build failures.

```neon
# phpstan.neon
parameters:
    level: 8
    paths:
        - app
    excludePaths:
        - app/Infrastructure/Config
includes:
    - vendor/phpstan/phpstan-strict-rules/rules.neon
```

---

## 4. Code Style & Formatting

- BT-16: PHP-CS-Fixer with PSR-12 + custom ruleset committed as `.php-cs-fixer.dist.php`.
- BT-17: Formatting check in CI: `php-cs-fixer check --diff` — unformatted code blocks merge.
- BT-18: Mandatory PHP-CS-Fixer rules: `declare_strict_types`, `no_unused_imports`, `ordered_imports`, `single_quote`.

---

## 5. Architecture Enforcement

- BT-19: Deptrac with `deptrac.yaml` committed — layer dependency rules enforced.
- BT-20: PHPArkitect as alternative — `phparkitect check` in CI.
- BT-21: Architecture violations in CI are build failures.

```yaml
# deptrac.yaml (example layers)
layers:
  - name: Domain
    collectors:
      - type: className
        regex: '^App\\Domain\\.*'
  - name: Application
    collectors:
      - type: className
        regex: '^App\\Application\\.*'
  - name: Infrastructure
    collectors:
      - type: className
        regex: '^App\\Infrastructure\\.*'
ruleset:
  Domain: []
  Application: [Domain]
  Infrastructure: [Application, Domain]
```

---

## 6. CI Gates

All must pass before PR can be merged:

- BT-22: `composer install` — zero errors.
- BT-23: `phpunit --testsuite=Unit` — unit tests pass.
- BT-24: `phpunit --testsuite=Integration` — integration tests pass.
- BT-25: `phpstan analyse` (level 8) — zero errors.
- BT-26: `php-cs-fixer check --diff` — zero formatting violations.
- BT-27: `deptrac analyse` — zero architecture violations.
- BT-28: `composer audit` — zero known CVEs.
- BT-29: Coverage thresholds met (Domain >= 90%, Application >= 80%).
