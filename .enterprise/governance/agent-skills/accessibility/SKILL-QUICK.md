---
name: accessibility
tier: quick
version: "1.0.0"
---

# Accessibility — Quick Check

> Tier 1: use when reviewing UI components in Flutter or React Native.
> Load SKILL.md (Tier 2) for full WCAG 2.1 compliance requirements and implementation patterns.

---

## Checklist — Flutter

- [ ] Interactive elements have `Semantics` widget with meaningful `label`
- [ ] Images have semantic labels or are marked decorative (`excludeSemantics: true`)
- [ ] Touch targets are at least 48×48 dp
- [ ] Color is not the sole means of conveying information
- [ ] Text contrast ratio ≥ 4.5:1 (normal text) or ≥ 3:1 (large text)
- [ ] Screen reader announcements work for dynamic state changes (`SemanticsService.announce`)
- [ ] No timed interactions without user control to extend

## Checklist — React Native

- [ ] All interactive elements have `accessibilityLabel`
- [ ] `accessibilityRole` set correctly (`button`, `link`, `header`, `image`, etc.)
- [ ] `accessibilityHint` provided for non-obvious actions
- [ ] Images have `accessible={true}` + `accessibilityLabel` or `accessible={false}` if decorative
- [ ] Touch targets meet minimum size (44×44 points iOS / 48×48 dp Android)
- [ ] Color not used as sole information carrier
- [ ] Text contrast ratio ≥ 4.5:1 for normal text

---

## Verdict

**PASS** → accessibility requirements met.
**FAIL** → violations found — load `SKILL.md` (Tier 2) for full WCAG 2.1 requirements and remediation guidance.
