# C# / .NET — Build & Toolchain Standard
## Gold Standard / State-of-the-Art Backend Engineering

**Version:** 1.0
**Status:** Canonical / Normative
**Runtime:** .NET 8+ / C# 12+

> Defines mandatory build system, toolchain configuration, and CI gate requirements for .NET services.

---

## 1. Runtime & Language Version

- BT-01: .NET 8 (LTS) minimum for all new services — pinned via `global.json`.
- BT-02: `global.json` committed at solution root: `{ "sdk": { "version": "8.x.xxx", "rollForward": "latestPatch" } }`.
- BT-03: `<TargetFramework>net8.0</TargetFramework>` in every `.csproj`.
- BT-04: `<LangVersion>latest</LangVersion>` in `Directory.Build.props` — enables latest C# features.
- BT-05: Preview features require ADR before use in production code.

---

## 2. Project & Solution Structure

- BT-06: `Directory.Build.props` at solution root — shared properties across all projects (Nullable, TreatWarningsAsErrors, ImplicitUsings).
- BT-07: `Directory.Packages.props` (Central Package Management) — all NuGet versions centralized, no version attributes in individual `.csproj` files.
- BT-08: Solution file (`.sln`) committed — no loose project files.
- BT-09: Project naming: `{Company}.{Service}.{Layer}` — e.g., `Acme.Orders.Domain`.
- BT-10: `.editorconfig` committed at solution root — formatting rules applied by all IDEs.

```xml
<!-- Directory.Build.props -->
<Project>
  <PropertyGroup>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    <LangVersion>latest</LangVersion>
    <AnalysisMode>All</AnalysisMode>
  </PropertyGroup>
</Project>
```

---

## 3. Static Analysis

- BT-11: `<TreatWarningsAsErrors>true</TreatWarningsAsErrors>` in `Directory.Build.props` — all warnings are errors in CI.
- BT-12: `<AnalysisMode>All</AnalysisMode>` enables all Roslyn analyzers.
- BT-13: StyleCop.Analyzers enforced — style violations = build failures.
- BT-14: SonarAnalyzer.CSharp enforced for bug and code smell detection.
- BT-15: `dotnet format --verify-no-changes` in CI — formatting violations block merge.

---

## 4. Code Formatting

- BT-16: `.editorconfig` defines: indent_size=4, end_of_line=lf, charset=utf-8-bom, trim_trailing_whitespace=true.
- BT-17: `dotnet format` run as part of `pre-commit` hook and CI gate.
- BT-18: Brace style: Allman (opening brace on new line) — enforced via EditorConfig.

---

## 5. Dependency Management

- BT-19: NuGet Central Package Management (`Directory.Packages.props`) — single version truth.
- BT-20: `dotnet list package --vulnerable` run in CI — known CVEs block merge.
- BT-21: No pre-release (alpha/beta/rc) packages in production builds without ADR.
- BT-22: `PackageLockFile` (`RestoreLockedMode`) enabled in CI — prevents unexpected updates.
- BT-23: License compatibility reviewed — GPL/AGPL require explicit approval.

---

## 6. CI Gates

All must pass before PR can be merged:

- BT-24: `dotnet build --no-incremental -warnaserror` — zero warnings.
- BT-25: `dotnet test` — all tests pass.
- BT-26: `dotnet format --verify-no-changes` — formatting clean.
- BT-27: `dotnet list package --vulnerable` — zero known CVEs.
- BT-28: Coverage thresholds met (Domain ≥ 90%, Application ≥ 80%).
- BT-29: Architecture tests (NetArchTest or ArchUnitNET) pass.
- BT-30: Static analysis (Roslyn/StyleCop/SonarAnalyzer) — zero violations.
