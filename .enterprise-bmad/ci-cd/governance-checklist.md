# CI/CD Governance Validation Checklist
**Status:** Mandatory  
**Version:** 1.0  

---

## 1. Constitution Validation
- [ ] `/enterprise-bmad/constitution/` exists
- [ ] Constitution file exists
- [ ] Addendum exists

---

## 2. Policy Validation
- [ ] sharding-policy.md exists
- [ ] documentation-policy.md exists
- [ ] adr-policy.md exists
- [ ] pre-flight-checks.md exists
- [ ] automated-validation.md exists
- [ ] minimal-wiring.md exists
- [ ] exceptions.md exists

---

## 3. Agent Governance Validation
For each agent folder:
- [ ] authority.md exists
- [ ] constraints.md exists

Missing any → FAIL.

---

## 4. Sharding Validation
- [ ] No oversized unsharded docs modified
- [ ] index.md exists where sharding applies

---

## 5. ADR Validation
If changes include:
- architecture
- requirements
- standards
- cross-cutting concerns

Then:
- [ ] ADR exists
- [ ] ADR structure is complete
- [ ] ADR status is valid

---

## 6. Exception Validation
If `/enterprise-bmad/exceptions/` exists:
- [ ] All exceptions have expiration/review
- [ ] No expired exceptions
- [ ] No implicit exceptions

---

## 7. Final Gate
If any item fails → PIPELINE FAILS.

**End of Checklist**
