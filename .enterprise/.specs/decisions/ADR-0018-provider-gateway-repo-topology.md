# ADR-0018 — Provider/Integration Gateway: New Repo vs. Folder in an Existing Repo

**Status:** Proposed
**Date:** 2026-07-14
**Authors:** Platform Architecture
**Affects Standards:** API Management & Versioning Standard (§7.5 canonical envelope adoption), Code & API Documentation Standard (§5.4 developer portal requirements), `.enterprise/policies/shared-infrastructure.md`
**Supersedes:** N/A
**Superseded By:** N/A

---

## Context

`cambioreal/kira-sdk` is a .NET client library wrapping the Kira Financial AI provider API. It is consumed today only as a NuGet package, in-process, by `cambioreal/cambio-real-v3`. Extending Kira access to more of the development team — without every consumer taking a direct .NET dependency on the SDK, and without coupling every consumer's release cycle to `cambio-real-v3`'s — required exposing the SDK as an HTTP service.

No existing standard answered the resulting question: does that HTTP service live as a new folder inside an existing repository (`kira-sdk` or `cambio-real-v3`), or as its own dedicated repository? The decision was made explicitly for this case (`cambioreal/kira-gateway`, a new dedicated repo), but the criteria behind it were not written down anywhere agents or humans could reuse for the next provider integration. This ADR closes that gap.

## Decision

A **new dedicated repository** is REQUIRED when **all** of the following hold:

1. **Independent deployment and versioning.** The unit ships its own container image, has its own release cadence, and its own CI/CD pipeline — it is not lock-stepped with an existing service's release train.
2. **Distinct consumer surface.** The unit exposes an API surface consumed by a different (or broader) set of consumers than the source library/service — e.g., teams that do not otherwise depend on the source repo now need access.
3. **Access-control fit.** Folding the unit into the existing repo would either over-scope permissions (new consumers would need write access to the source repo just to open issues/PRs against the gateway) or under-scope them (the existing repo's access model does not fit the new unit's team boundary).

A **folder within an existing repo** is preferred when:

- The component has no independent deployment lifecycle — it always ships atomically with the parent service, in the same pipeline, as the same image.
- Splitting it out would add coordination overhead (a second repo, a second CI/CD pipeline, a second GitOps entry) without adding any real isolation value.

**Worked example (this repo's own precedent):** `cambioreal/kira-sdk` (client library, own repo, distributed via NuGet, consumed in-process) vs. `cambioreal/kira-gateway` (HTTP service wrapping the SDK, deployed independently to k3s with its own image/CI/CD/GitOps entry, consumed over HTTP by any internal service that needs Kira — not just `cambio-real-v3`). All three "new repo" criteria are satisfied: independent deploy cadence, a broader/different consumer set (any internal HTTP client vs. only .NET processes that reference the SDK package), and a distinct access-control boundary (the gateway's dev team does not need write access to the SDK repo, and vice versa).

Every new gateway/provider-integration service MUST check these criteria explicitly (see Compliance) before choosing repo topology. When only some criteria are met, default to a folder in the existing repo and revisit if/when the missing criteria later hold.

## Consequences

### Positive
- Removes an ad-hoc judgment call — the next provider integration (or any new deployable service) has a concrete, checkable test instead of "whatever seems right at the time."
- Prevents both failure modes simultaneously: unnecessary repo sprawl (one repo per trivial adapter) and folder-bloat (unrelated deployables crammed into one repo because "it's already there").
- Keeps access control correctly scoped per consumer/team boundary from day one.

### Negative / Trade-offs
- More repos to keep GitOps, `pass`/secrets, and CI/CD conventions consistent across (each new gateway repo repeats the NuGet/GHCR/GitOps scaffold).
- Onboarding overhead: a new engineer now has to know about "yet another repo" per provider.

### Risks
- The criteria could be gamed to justify unnecessary repo proliferation by treating any minor scope difference as a "distinct consumer surface." Mitigation: require all three criteria to be explicitly checked off (not just asserted) in the PR/issue that proposes the new repo, per Compliance below.

---

## Affected Standards

| Standard | Section / Rule | Change |
|---|---|---|
| API Management & Versioning Standard | §7.5 (AM-76 to AM-82) | Cross-referenced — a new gateway repo created under this ADR MUST adopt the canonical `Envelope<T>` contract from inception (AM-82) |
| Code & API Documentation Standard | §5.4 (CD-40 to CD-44) | Cross-referenced — a new gateway repo created under this ADR MUST ship Scalar-based, self-service documentation from inception |
| `.enterprise/policies/shared-infrastructure.md` | Procedural rules | Cross-referenced — a new gateway repo still consumes shared infra (Redis, Postgres, etc.) per that policy; this ADR does not create an exception |

---

## Compliance

- [ ] Approved by Engineering Leadership
- [ ] Affected standards updated to reference this ADR
- [ ] Teams notified
- [ ] Activation date: 2026-07-14 (upon merge)
- [ ] Review date: Permanent (revisit if repo-topology pain resurfaces)

When proposing a new dedicated repo for a provider/integration gateway, the proposal MUST explicitly check off criteria 1–3 above (not merely assert "it should probably be its own repo").

---

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Always use a folder in the source library's repo (`kira-sdk/src/KiraGateway.Api`) | Couples the gateway's release cadence and CI/CD to the SDK's; forces every gateway consumer/contributor to have access to the SDK repo; the SDK is versioned as a NuGet package on its own cadence, which is a different lifecycle than a deployed service. |
| Always use a folder in the primary consumer's repo (`cambio-real-v3/services/kira-gateway`) | Defeats the actual goal of this initiative — decoupling the ecosystem from `cambio-real-v3` behind isolated provider services — by re-coupling the new gateway to the exact monolith it exists to relieve. |
| Case-by-case decision with no written criteria (status quo before this ADR) | Produces inconsistent outcomes and forces every future agent/engineer to rediscover the reasoning from scratch; this ADR exists specifically because that gap was hit in practice. |
