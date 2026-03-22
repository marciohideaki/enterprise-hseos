# Structural Execution Governance
**Status:** Mandatory
**Scope:** HSEOS installer, update, compile-agent, and governed tool selection flows
**Version:** 1.0

---

## 1. Purpose

Structural Execution Governance ensures that runtime-affecting actions are evaluated against explicit,
versioned policy packs before HSEOS mutates a target project.

---

## 2. Policy Pack Location

Execution governance policy packs MUST live under:

`.enterprise/policies/execution/`

Each pack MUST use the naming convention:

`<pack-name>.policy.yaml`

---

## 3. Mandatory Controls

Every execution governance pack MAY constrain:

- module selection
- tool visibility and tool selection
- installation and custom-content paths
- custom content ingress
- aggregate selection budgets

If a constraint is declared, HSEOS MUST enforce it structurally before mutation.

---

## 4. Fail-Closed Rule

If policy resolution fails, policy validation fails, or an execution request violates policy:

- execution MUST stop
- HSEOS MUST emit explicit denial evidence
- no installation or update mutation may proceed

---

## 5. Visibility Control

Policy packs MAY hide governed tools from interactive selection surfaces.

If a hidden or denied tool is still requested explicitly through command-line input or preserved state,
execution MUST be denied.

---

## 6. Inspectability

HSEOS MUST expose policy inspection commands so operators can validate and explain a policy pack before use.

---

## 7. Acceptance

All contributors and operators are bound by this policy.
