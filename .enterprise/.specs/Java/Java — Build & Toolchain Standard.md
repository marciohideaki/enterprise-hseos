# Java — Build & Toolchain Standard
## Gold Standard / State-of-the-Art Backend Engineering

**Version:** 1.0
**Status:** Canonical / Normative
**Runtime:** Java 21+

> Defines mandatory build system, toolchain configuration, and CI gate requirements for Java services.

---

## 1. Runtime & Language Version

- BT-01: Java 21 is the minimum version for all new services (`--release 21` in build config).
- BT-02: Java version pinned via `.java-version` file (jenv) or `JAVA_HOME` in CI environment spec.
- BT-03: LTS versions only in production — no preview features unless behind a feature flag with ADR.
- BT-04: `--enable-preview` features require ADR approval before use in any production code path.

---

## 2. Build System

### 2.1 Maven
- BT-05: Maven 3.9+ required.
- BT-06: `maven-wrapper` (`.mvn/wrapper/`) committed — no relying on system Maven.
- BT-07: `<java.version>21</java.version>` declared in parent POM properties.
- BT-08: `maven-compiler-plugin` configured with `--release 21` and `--enable-preview` only if ADR-approved.
- BT-09: `maven-enforcer-plugin` enforces minimum Maven and Java versions.
- BT-10: BOM (Bill of Materials) used for dependency version alignment — no version duplication in child modules.
- BT-11: `dependencyManagement` section manages ALL transitive dependency versions.

```xml
<properties>
  <java.version>21</java.version>
  <maven.compiler.release>21</maven.compiler.release>
</properties>
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-enforcer-plugin</artifactId>
  <configuration>
    <rules>
      <requireJavaVersion><version>[21,)</version></requireJavaVersion>
      <requireMavenVersion><version>[3.9,)</version></requireMavenVersion>
    </rules>
  </configuration>
</plugin>
```

### 2.2 Gradle (alternative)
- BT-12: Gradle 8+ with Kotlin DSL (`build.gradle.kts`) — no Groovy DSL for new projects.
- BT-13: `gradle-wrapper` committed — no relying on system Gradle.
- BT-14: `toolchains { java { languageVersion = JavaLanguageVersion.of(21) } }` configured.
- BT-15: Gradle version catalog (`libs.versions.toml`) for dependency management.

---

## 3. Static Analysis

- BT-16: Checkstyle with Google or Sun style guide enforced — configuration committed to repo.
- BT-17: PMD with rulesets: `java/bestpractices`, `java/errorprone`, `java/performance` enforced.
- BT-18: SpotBugs with `security` plugin (find-sec-bugs) enforced.
- BT-19: ArchUnit tests enforce layer dependency rules — committed in `src/test/`.
- BT-20: Null analysis via NullAway or SpotBugs `@NonNull` enforcement.
- BT-21: All static analysis failures in CI are build failures — no warning-only mode in CI.

---

## 4. Code Formatting

- BT-22: Google Java Format enforced — no manual style discussions.
- BT-23: `spotless-maven-plugin` or `spotless-gradle-plugin` runs `google-java-format` in `verify` phase.
- BT-24: Formatting check in CI pipeline (`spotless:check`) — unformatted code blocks merge.

---

## 5. Dependency Management

- BT-25: OWASP Dependency-Check plugin runs in CI — CVSS score >= 7 blocks build.
- BT-26: No `SNAPSHOT` dependencies in production builds.
- BT-27: No version ranges in `pom.xml` — exact versions only.
- BT-28: Dependency licenses reviewed — GPL/AGPL requires approval.
- BT-29: `mvn dependency:analyze` run in CI — unused declared dependencies are warnings; undeclared used = error.

---

## 6. CI Gates

All of the following must pass before a PR can be merged:

- BT-30: `mvn verify` (or `./gradlew build`) — build + unit tests + static analysis.
- BT-31: Unit tests pass with minimum coverage thresholds (Domain >= 90%, Application >= 80%).
- BT-32: Integration tests pass (TestContainers in CI).
- BT-33: Checkstyle + PMD + SpotBugs pass — zero violations.
- BT-34: ArchUnit tests pass — zero architecture violations.
- BT-35: OWASP Dependency-Check passes (CVSS < 7 threshold).
- BT-36: Spotless format check passes.
- BT-37: `maven-enforcer-plugin` passes (Java >= 21, Maven >= 3.9).

---

## 7. Project Structure Conventions

- BT-38: Multi-module Maven projects use a parent POM with `<modules>` — no flat single-module for services with distinct layers.
- BT-39: Test source root: `src/test/java` — integration tests in `src/test/java` with `IT` suffix.
- BT-40: Resource files: `src/main/resources/application.yml` — never `application.properties`.
- BT-41: No committed `.env` files — use `application-local.yml` (gitignored) for local overrides.
