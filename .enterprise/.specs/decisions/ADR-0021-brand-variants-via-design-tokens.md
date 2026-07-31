# ADR-0021 — Brand Variants via Design Tokens, Not Forked Frontends

**Status:** Proposed
**Date:** 2026-07-30
**Authors:** Platform Architecture
**Affects Standards:** SOLID Principles & Software Craftsmanship Standard (§6 DRY), CI CD Pipeline Standard (§4 Environment Configuration — CI-43, §5 Artifact Management — CI-53)
**Supersedes:** N/A
**Superseded By:** N/A

---

## Context

`HideakiSolutions/srm-asset` served two visual identities from two directories: `src/srm-frontend` and `src/srm-frontend-cepol`. The second was introduced by commit `adaec20`, whose own message describes it as a *"parallel frontend"*.

Measured before removal, the two trees were near-identical:

- Same 17 workspace packages, same names.
- **0 files** existed in the base tree that were absent from the fork.
- 49 of ~186 files differed; **3** files were unique to the fork.
- Across **1502 diff lines**, the only logic-bearing change was one added `lucide-react` icon import. No divergence in API calls, fetch, hooks, state, or endpoints.

So the fork carried no behavioural difference — only colour, one logo, and product photography. The root cause was not the copy itself but what made copying the only option: colours were hardcoded hex literals in `tailwind.config.js`, so changing an identity required editing components. The fork's authors did exactly that, swapping `bg-bank-teal` for `bg-bank-blue` and `rounded-lg` for `rounded-[10px]` inline across 49 files.

Duplication of this shape is not visually obvious and decays silently. The fork had already accumulated two regressions the base did not have — `lang="en"` on a pt-BR product, and Portuguese diacritics stripped from navigation labels (`Transferencias`, `Cartoes`, `Credito`, `Relatorios`, `Configuracoes`) — while separately holding one fix the base lacked (clearing stale `dist/` before build). Fixes and regressions were flowing in both directions with no mechanism to reconcile them. Each identity also carried its own CI/CD pipeline and its own GitHub Actions cache scope, doubling build cost and deployment surface for zero functional gain.

No existing standard stated where visual identity belongs, so nothing prevented the fork. This ADR closes that gap.

---

## Decision

**We will treat brand identity as configuration of one implementation, never as a reason to fork one.**

A repository serving N visual identities MUST have exactly one implementation of each capability. Concretely:

1. **Colour lives in design tokens, never in code.** Every colour MUST be declared as a CSS custom property scoped by a brand selector (e.g. `[data-brand='<id>']`), consumed indirectly by the styling layer (e.g. Tailwind via `rgb(var(--token) / <alpha-value>)`). A colour literal in a component, a style config, or a TypeScript file is a defect: it is a value that cannot be re-themed, and therefore a future fork.

2. **Non-colour identity lives in a single typed registry.** Title, language, display name, logo, and per-brand behaviour flags MUST be declared in one registry module. Adding a brand MUST be one registry entry plus one token block — never a new directory.

3. **The registry is placed so no consumer depends upward.** It belongs in a shared package that both the host application and its feature packages already depend on. Presentational components MUST stay brand-agnostic and receive identity via props rather than importing brand state, preserving existing layering.

4. **Selection is explicit and fails safe.** The active brand MUST be resolved from a single declared input (e.g. `VITE_BRAND`) and MUST fall back to a documented default when the value is absent or unknown, emitting a warning. A misconfigured deployment MUST render the default identity rather than an unstyled or blank page.

5. **Build-time identity inputs MUST be part of the build cache key.** Any variable baked into an artifact MUST be declared in the build tool's cache-key inputs (e.g. `turbo.json` `env`). Omitting one lets a cached artifact built for brand A be published under brand B's tag.

6. **One brand, one artifact tag, one shared source.** Each identity MAY keep its own image name and pipeline, but every pipeline MUST build from the shared implementation, differing only by the brand input. Per-brand source directories are forbidden.

A second directory for the same capability MUST NOT be created to accommodate visual identity. Where an existing fork is found, it MUST be collapsed into the shared implementation, with any assets or fixes it uniquely holds ported first and any regressions it uniquely holds discarded.

---

## Consequences

### Positive
- Removes the largest class of silent frontend drift: two trees that look interchangeable but diverge fix-by-fix. Adding a brand costs one registry entry and one token block.
- A capability is fixed once for every identity. In the originating case, collapsing removed 196 files (−18,499 lines) while *adding* brand capability.
- Regressions confined to a fork die with it — the canonical tree's correct `lang` and diacritics were restored as a side effect, not as separate remediation.
- Makes rule 5 explicit before it can ship damage. In the originating repo `turbo.json` declared no `env` at all, so no `VITE_*` variable was part of the cache key; building one brand after another returned the first brand's bundle. CI was cold-cache, so it was latent rather than live — but it would have shipped the wrong brand under a correct-looking immutable tag the moment remote caching was enabled (CI-53).

### Negative / Trade-offs
- Colour can no longer be expressed as a literal where it is used, which is briefly less direct to read. Mitigated by naming tokens semantically rather than by hue.
- Pre-blended tints that embed their own alpha cannot also accept an opacity modifier. This must be verified per token set rather than assumed.
- Brand-conditional rendering adds a branch to components whose presentation genuinely differs (e.g. illustration vs. photography), rather than each brand owning a simpler file.
- Vite-style bundlers bake the brand at build time, so one artifact serves one identity. This is a deliberate deviation from CI-43's preference for deployment-time injection: it is inherent to prebuilt SPA bundles, and the alternative (runtime fetch of brand config) would delay first paint. Recorded here rather than left implicit.

### Risks
- **Token drift returns via literals.** A new hardcoded hex silently reintroduces the fork. *Mitigation:* assert zero colour literals in the style config and registry as a build or review gate; the originating repo verifies both.
- **Fallback masks misconfiguration.** Failing safe to the default brand can hide a wrong `VITE_BRAND` in production. *Mitigation:* the fallback MUST warn, and the resolved brand SHOULD be observable in deployment logs.
- **Collapse loses fork-only assets.** *Mitigation:* enumerate files unique to the fork and diff for asset references before deletion. In the originating case this surfaced 9 image assets that a naive deletion would have destroyed.

---

## Affected Standards

| Standard | Section / Rule | Change |
|---|---|---|
| SOLID Principles & Software Craftsmanship Standard | §6 DRY — Don't Repeat Yourself | Extends — names a forked frontend as a DRY violation and states the required remedy |
| CI CD Pipeline Standard | §5 Artifact Management, CI-53 | Clarifies — artifact tag immutability is only meaningful if build inputs are part of the cache key |
| CI CD Pipeline Standard | §4 Environment Configuration, CI-43 | Deviation — brand identity is baked at build time for prebuilt SPA bundles; documented in Trade-offs |

---

## Compliance

- [ ] Approved by Engineering Leadership
- [ ] Affected standards updated to reference this ADR
- [ ] Teams notified
- [ ] Activation date: [pending approval]
- [ ] Review date: Permanent

---

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Keep both trees, add a sync process | Institutionalises the duplication. Any sync is manual or heuristic and silently degrades; the measured divergence (regressions in one tree, a fix in the other) is what an unsynced fork produces after weeks, not years. |
| Keep both trees, extract only shared logic into packages | The trees shared essentially all logic already — the divergence was presentational. Extraction would leave two shells diverging on exactly the axis that caused the problem. |
| Runtime brand config fetched from an API | Adds a network dependency and a flash of default identity before first paint, for flexibility no consumer requested. Brand is fixed per deployment. |
| Separate repository per brand | Multiplies pipelines, dependency upgrades, and security patching per identity, with no isolation benefit — the identities share every consumer-facing capability. Fails the ADR-0018 criteria for a dedicated repo. |
| Tailwind multi-config / preset per brand | Solves colour only, leaving logo, title, language, and behavioural flags unaddressed, and still emits one CSS bundle per brand. The token approach covers all identity axes with a single artifact pipeline. |
