---
name: documentation-completeness
tier: quick
version: "1.0.0"
description: "Use when reviewing public APIs, modules, or architecture for missing or incomplete documentation"
---

# Documentation Completeness — Quick Check

> Tier 1: use during PR review when new public code is introduced.
> Load SKILL.md (Tier 2) for full documentation requirements per stack.

---

## Checklist

**Code Documentation**
- [ ] All new public classes documented (purpose + responsibility)
- [ ] All new public methods documented (what it does, params, return, throws/errors)
- [ ] All new public properties documented if non-obvious
- [ ] Domain concepts (aggregates, value objects, events) have doc comments explaining business meaning

**API Documentation**
- [ ] New HTTP endpoints documented in OpenAPI/Swagger spec
- [ ] Request and response schemas documented (field descriptions + types)
- [ ] Error responses documented with codes and meanings
- [ ] New gRPC services/methods documented in `.proto` file comments

**Architecture & Decision**
- [ ] If architectural change → architecture doc updated
- [ ] If ADR-worthy decision → ADR drafted (see `adr-compliance`)
- [ ] README updated if setup, config, or usage changed

**Stack-specific**
- [ ] C#: XML doc comments (`///`) on all public members
- [ ] Dart/Flutter: DartDoc (`///`) on all public members
- [ ] TypeScript/React: TSDoc (`/** */`) on exported functions/components/hooks
- [ ] Java: Javadoc (`/** */`) on all public members

---

## Verdict

**PASS** → documentation is complete.
**FAIL** → undocumented public code — load `SKILL.md` (Tier 2) for full requirements.
