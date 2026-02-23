# Go — Build & Toolchain Standard
## Gold Standard / State-of-the-Art Backend Engineering

**Version:** 1.0
**Status:** Canonical / Normative
**Runtime:** Go 1.22+

> Defines mandatory build system, toolchain configuration, and CI gate requirements for Go services.

---

## 1. Runtime & Language Version

- BT-01: Go 1.22+ is the minimum version for all new services.
- BT-02: Go version pinned in `go.mod`: `go 1.22.0` — no floating versions.
- BT-03: Toolchain directive specified: `toolchain go1.22.4` in `go.mod`.
- BT-04: `go.sum` committed — never gitignored.

---

## 2. Module Management

- BT-05: One `go.mod` per service — no nested modules except in monorepo tool setups.
- BT-06: `go.work` used only for local multi-module development — never committed for production builds.
- BT-07: `vendor/` directory: either always used (`go mod vendor`) or never used — consistent per project.
- BT-08: Indirect dependencies listed in `go.mod` — `go mod tidy` run before every commit.
- BT-09: Module path uses full domain: `module github.com/org/service` — no short names.
- BT-10: CGO disabled by default (`CGO_ENABLED=0`) unless native library integration is explicitly required and ADR-approved.

---

## 3. Build

- BT-11: `Makefile` committed with standard targets: `build`, `test`, `lint`, `fmt`, `generate`, `docker`.
- BT-12: Build flags for reproducibility: `go build -ldflags="-s -w -X main.version=$(VERSION)"`.
- BT-13: Build tags used for environment-specific code: `//go:build integration` for integration tests.
- BT-14: Binary stripped of debug symbols in release builds: `-ldflags="-s -w"`.
- BT-15: Multi-stage Docker build: builder stage with `golang:1.22-alpine`, runner stage with `scratch` or `distroless`.

---

## 4. Static Analysis & Linting

- BT-16: `golangci-lint` v1.56+ with the following linters enabled (committed `.golangci.yml`):
  - `errcheck` — no unchecked errors
  - `govet` — reports suspicious constructs
  - `staticcheck` — comprehensive static analysis
  - `revive` — opinionated style
  - `gocyclo` — cyclomatic complexity <= 15
  - `godot` — comment punctuation
  - `misspell` — spelling in comments
  - `unused` — unused code
  - `gosec` — security issues
  - `bodyclose` — HTTP response body close
  - `noctx` — HTTP requests without context

- BT-17: `golangci-lint` failures in CI are build failures — no warning-only mode.
- BT-18: `go vet ./...` run in CI separately — zero warnings policy.
- BT-19: `govulncheck ./...` run in CI — known vulnerabilities block merge.

---

## 5. Code Formatting

- BT-20: `gofmt` enforced — non-formatted code blocks merge.
- BT-21: `goimports` enforced — import grouping: stdlib / external / internal.
- BT-22: Formatting check in CI: `gofmt -l . | grep .` exits non-zero if any file unformatted.
- BT-23: Line length: 120 chars soft limit — `golangci-lint` `lll` linter configured.

---

## 6. Code Generation

- BT-24: Generated code uses `//go:generate` directives — documented in `README`.
- BT-25: Mock generation via `mockery` — `mockery --name=InterfaceName --output=./mocks`.
- BT-26: Generated files not manually edited — marked with `// Code generated ... DO NOT EDIT.`.

---

## 7. Dependency Management

- BT-27: `govulncheck` run in CI — known CVEs block build.
- BT-28: Dependency licenses reviewed via `go-licenses` — GPL/AGPL require approval.
- BT-29: Minimal dependencies — no importing large frameworks for single utility.
- BT-30: Prefer stdlib over third-party where equivalent — e.g., `log/slog` over third-party logger when no structured logging is required.

---

## 8. CI Gates

All of the following must pass before a PR can be merged:

- BT-31: `go build ./...` — zero errors.
- BT-32: `go test ./...` — all unit tests pass.
- BT-33: `go test -race ./...` — zero race conditions.
- BT-34: `golangci-lint run` — zero lint violations.
- BT-35: `go vet ./...` — zero warnings.
- BT-36: `govulncheck ./...` — no known vulnerabilities.
- BT-37: `gofmt -l .` — zero unformatted files.
- BT-38: Integration tests pass (build tag `integration`, with Testcontainers).
- BT-39: Coverage gates enforced (`go test -cover` with thresholds).
