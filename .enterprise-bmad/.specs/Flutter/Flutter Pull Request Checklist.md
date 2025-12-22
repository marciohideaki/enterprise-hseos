# Flutter Pull Request Checklist
## Flutter — Gold Standard / State of the Art

> This checklist is **mandatory** for all Flutter pull requests.
> It enforces compliance with the **Flutter Architecture Standard**, **Functional Requirements (FR)**, **Non-Functional Requirements (NFR)** and **AI Usage Policy**.

A PR **must not be approved** if any required item is not satisfied.

---

## 1. General Information

- [ ] The PR has a **clear title and description** explaining *what* and *why*.
- [ ] The PR scope is **small and focused** (no unrelated changes).
- [ ] The PR references a **ticket, story or task** (if applicable).
- [ ] Breaking changes are **explicitly documented**.

---

## 2. Architecture Compliance

- [ ] Code follows **feature-first organization**.
- [ ] Feature boundaries are respected (no cross-feature leakage).
- [ ] Presentation, Application, Domain and Data layers are correctly separated.
- [ ] Domain layer has **no dependency on Flutter, plugins or infrastructure**.
- [ ] No architectural deviations were introduced.
- [ ] Any necessary deviation is backed by an **approved ADR**.

---

## 3. State Management

- [ ] Business state is **not managed inside widgets**.
- [ ] State mutations occur only in controllers / blocs / providers.
- [ ] State models are **immutable**.
- [ ] Explicit states exist (initial / loading / success / error).
- [ ] Side effects are isolated from UI components.

---

## 4. Networking & Communication

- [ ] All external communication uses the **Core Networking Package**.
- [ ] No direct HTTP/Dio usage exists outside the networking layer.
- [ ] All async IO returns `Result<T>`.
- [ ] No raw exceptions propagate to UI or features.
- [ ] Errors are mapped to **typed error models**.
- [ ] Retry, timeout and auth handling are not duplicated.

---

## 5. Error Handling & UX

- [ ] Technical errors are not exposed to end users.
- [ ] Error states are handled explicitly in UI.
- [ ] User-facing error messages are clear and actionable.
- [ ] Failure scenarios were considered and tested.

---

## 6. Security & Privacy

- [ ] No secrets, tokens or sensitive data are committed.
- [ ] Sensitive data is not logged.
- [ ] Authentication and authorization flows are respected.
- [ ] Logout clears sensitive local state.

---

## 7. Performance

- [ ] No heavy computation runs on the UI thread.
- [ ] Widget rebuilds are minimized and intentional.
- [ ] Loading states are displayed for async operations.
- [ ] No unnecessary re-renders were introduced.

---

## 8. Testing

- [ ] Domain/Application logic is covered by unit tests.
- [ ] New or changed features include relevant tests.
- [ ] External dependencies are mocked or stubbed.
- [ ] Tests pass locally and in CI.

---

## 9. Observability & Logging

- [ ] Logs are structured and meaningful.
- [ ] Logs do not contain PII or sensitive information.
- [ ] Errors include sufficient contextual information.
- [ ] Observability hooks are preserved or improved.

---

## 10. Code Quality & Conventions

- [ ] Code follows naming and formatting conventions.
- [ ] Files are small, cohesive and readable.
- [ ] No dead code or commented-out logic remains.
- [ ] No unnecessary abstractions were introduced.

---

## 11. AI-Assisted Development (If Applicable)

- [ ] AI-generated code follows all architectural standards.
- [ ] AI output was **reviewed and validated by a human**.
- [ ] No sensitive data was shared with AI tools.
- [ ] The author takes full ownership of AI-assisted code.

---

## 12. Documentation & Governance

- [ ] README or feature documentation was updated (if needed).
- [ ] New patterns or decisions are documented via ADR.
- [ ] This PR does not introduce undocumented conventions.

---

## Final Declaration

- [ ] I confirm that this PR **fully complies** with the Flutter Architecture Standard, FR, NFR and AI Usage Policy.
- [ ] I understand that non-compliant PRs may be rejected regardless of functionality.

---

## Reviewer Notes

- Architecture compliance verified: ⬜ Yes ⬜ No
- Tests reviewed: ⬜ Yes ⬜ No
- Security reviewed: ⬜ Yes ⬜ No
- Ready to merge: ⬜ Yes ⬜ No
