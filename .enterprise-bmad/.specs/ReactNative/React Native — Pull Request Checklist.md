# React Native — Pull Request Checklist
## Extension of Pull Request Checklist — Standard (Frontend)

**Version:** 1.0  
**Status:** Normative (Extends Standard)  
**Stack:** React Native + TypeScript  

> ⚠️ **IMPORTANT**
>
> This document **EXTENDS** the **Pull Request Checklist — Standard**.
> All items defined in the **Standard Checklist are mandatory and assumed as prerequisites**.
>
> This checklist **does not replace, override or weaken** any global requirement.
>
> Reviewers and AI agents **must evaluate this checklist only after full compliance with the Standard**.

---

## 1. Architecture & Structure (React Native)

- [ ] Feature structure follows the **React Native Architecture Standard**
- [ ] Feature-first organization is respected
- [ ] No cross-feature dependency leakage
- [ ] Shared logic lives only in `shared/`
- [ ] No global `utils` / `helpers` / `common` folders introduced

---

## 2. Feature Template Compliance

- [ ] Feature follows the **React Native Feature Template** exactly
- [ ] Presentation, application, domain and data layers are clearly separated
- [ ] No business logic exists in presentation components
- [ ] Domain layer is pure TypeScript (no React Native imports)

---

## 3. State Management & Side Effects

- [ ] State is local by default and scoped to the feature
- [ ] Global state usage is minimal and justified
- [ ] Side effects are isolated outside UI components
- [ ] State transitions are explicit and predictable

---

## 4. Networking & Integrations

- [ ] All HTTP calls use the **React Native Core Networking Package**
- [ ] No direct `fetch`, `axios` or similar usage outside the package
- [ ] `Result<T>` is handled explicitly
- [ ] No exceptions leak into UI layers
- [ ] Correlation identifiers are propagated when available

---

## 5. Data Contracts & Compatibility

- [ ] DTO parsing tolerates missing fields
- [ ] Unknown fields are ignored safely
- [ ] Enums define an explicit `unknown` value
- [ ] Breaking changes result in new API versions

---

## 6. Error Handling

- [ ] Errors are explicit, typed and deterministic
- [ ] UI does not infer meaning from raw error strings
- [ ] Domain and infrastructure errors are mapped intentionally

---

## 7. Offline & Resilience

- [ ] Read flows degrade gracefully when offline
- [ ] Write flows provide explicit offline feedback
- [ ] Retry behavior is bounded and user-aware
- [ ] Cached data is clearly distinguished from live data

---

## 8. Security

- [ ] Tokens are stored using secure storage
- [ ] Tokens, secrets and PII are never logged
- [ ] Unauthorized states are handled gracefully
- [ ] Security-sensitive changes are documented

---

## 9. Observability

- [ ] Crashes are captured and reported
- [ ] Network failures are observable
- [ ] Performance metrics are collected for critical flows
- [ ] Diagnostic context propagates across async boundaries

---

## 10. Documentation (Mandatory)

- [ ] All exported components, hooks and services are documented (TSDoc)
- [ ] Side effects and assumptions are documented
- [ ] Documentation reflects actual behavior

---

## 11. Testing

- [ ] Domain and application logic is unit-tested
- [ ] UI components support deterministic testing
- [ ] External dependencies are mockable
- [ ] Tests pass locally and in CI

---

## 12. AI-Assisted Development

- [ ] AI-generated code complies with Architecture, FR and NFR
- [ ] No architectural shortcuts introduced by AI
- [ ] Generated code follows the Feature Template

---

## Final Declaration

- [ ] This PR **fully complies** with the Pull Request Checklist — Standard
- [ ] This PR **fully complies** with this React Native-specific extension

---

## Reviewer Sign-off

- Architecture verified: ⬜ Yes ⬜ No
- Feature template compliance verified: ⬜ Yes ⬜ No
- Security reviewed: ⬜ Yes ⬜ No
- Ready to merge: ⬜ Yes ⬜ No

---

## Hierarchy Reminder

```
Pull Request Checklist — Standard   (CANONICAL)
└── React Native Pull Request Checklist (EXTENSION)
```

Any conflict is resolved **in favor of the Standard**.

