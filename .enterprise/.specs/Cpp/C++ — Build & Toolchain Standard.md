# C++ — Build & Toolchain Standard
## Gold Standard / State-of-the-Art Backend Engineering

**Version:** 1.0
**Status:** Canonical / Normative
**Runtime:** C++20 / C++23 | CMake 3.28+

> Defines mandatory build system, toolchain configuration, and CI gate requirements for C++ services.

---

## 1. Language Standard & Compiler

- BT-01: C++20 minimum (`CMAKE_CXX_STANDARD 20`, `CMAKE_CXX_STANDARD_REQUIRED ON`).
- BT-02: Supported compilers: GCC 13+, Clang 16+, MSVC 19.37+ (VS 2022 17.7+).
- BT-03: Compiler version pinned in CI environment spec.
- BT-04: `CMAKE_CXX_EXTENSIONS OFF` — no compiler-specific extensions.

---

## 2. CMake

- BT-05: CMake 3.28+ required — `cmake_minimum_required(VERSION 3.28)`.
- BT-06: CMake presets (`CMakePresets.json`) committed — standardizes configure/build/test invocations.
- BT-07: Modern CMake: `target_*` commands only — no directory-level `include_directories`, `add_definitions`.
- BT-08: Targets explicitly declare dependencies: `target_link_libraries(mylib PUBLIC dep1 PRIVATE dep2)`.
- BT-09: `INTERFACE` targets used for header-only libraries.
- BT-10: Install rules defined for all library targets — `install(TARGETS ...)`.

```cmake
cmake_minimum_required(VERSION 3.28)
project(OrderService LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
```

---

## 3. Compiler Flags

- BT-11: Mandatory warning flags (all builds): `-Wall -Wextra -Wpedantic`.
- BT-12: Warnings as errors in CI: `-Werror` (GCC/Clang) or `/WX` (MSVC).
- BT-13: Additional hardening flags: `-Wconversion -Wshadow -Wundef -Wnull-dereference`.
- BT-14: Release optimization: `-O2` (GCC/Clang) — not `-O3` without benchmark proof.
- BT-15: Debug build: `-O0 -g3 -fno-omit-frame-pointer`.
- BT-16: Stack protection: `-fstack-protector-strong` in release builds.

---

## 4. Dependency Management

- BT-17: Conan 2+ or vcpkg for all third-party dependencies — no manual download/include.
- BT-18: Dependency versions pinned: Conan lockfile (`conan.lock`) or vcpkg baseline committed.
- BT-19: `FetchContent` acceptable only for small, header-only, or vendored dependencies — with pinned git tag.
- BT-20: No system-installed (non-pinned) dependencies in production builds.
- BT-21: Dependency vulnerability scanning via `conan inspect` security advisories or OSV scanner.

---

## 5. Static Analysis

- BT-22: `clang-tidy` with `.clang-tidy` config committed — run in CI.
- BT-23: Mandatory clang-tidy checks: `modernize-*`, `readability-*`, `bugprone-*`, `performance-*`, `cppcoreguidelines-*`.
- BT-24: `clang-tidy` warnings treated as errors in CI.
- BT-25: `cppcheck` run as secondary static analyzer.
- BT-26: `include-what-you-use` (IWYU) run to prevent unnecessary header inclusions.

---

## 6. Code Formatting

- BT-27: `clang-format` with `.clang-format` config committed — enforced in CI.
- BT-28: Based on Google style with project-specific overrides.
- BT-29: Formatting check in CI: `clang-format --dry-run --Werror` on all source files.

---

## 7. Sanitizers (CI)

- BT-30: AddressSanitizer (`-fsanitize=address`) CI build — catches buffer overflows, use-after-free.
- BT-31: UndefinedBehaviorSanitizer (`-fsanitize=undefined`) CI build.
- BT-32: ThreadSanitizer (`-fsanitize=thread`) CI build for concurrent code.
- BT-33: LeakSanitizer enabled via ASan on Linux.
- BT-34: Sanitizer builds separate from normal builds — never ship sanitizer-instrumented binaries.

---

## 8. CI Gates

All must pass before PR can be merged:

- BT-35: `cmake --build` with `-Wall -Wextra -Werror` — zero warnings.
- BT-36: Unit tests pass (Google Test / Catch2).
- BT-37: Integration tests pass.
- BT-38: `clang-tidy` — zero violations.
- BT-39: `clang-format --dry-run --Werror` — zero formatting violations.
- BT-40: ASan + UBSan build passes — zero sanitizer errors.
- BT-41: TSan build passes for concurrent code.
- BT-42: Dependency vulnerability scan passes.
- BT-43: Coverage thresholds met (Domain >= 90%, Application >= 80%).
