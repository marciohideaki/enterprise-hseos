---
name: accessibility
description: WCAG 2.1 compliance validation for Flutter and React Native UI components — screen reader support, touch targets, contrast, and keyboard navigation.
license: Apache-2.0
metadata:
  owner: platform-governance
  version: "1.0.0"
---

# Accessibility

## When to use
Use this skill when:
- building or reviewing UI components in Flutter or React Native
- introducing new screens or interactive flows
- auditing an existing screen for accessibility compliance
- generating accessible component code

---

## 1. Core Principles (WCAG 2.1 — Level AA)

The four WCAG principles — POUR — apply to all mobile UI:

- A11Y-01: **Perceivable** — content must be presentable in ways users can perceive (screen reader, contrast).
- A11Y-02: **Operable** — UI components must be operable (touch targets, no timing traps).
- A11Y-03: **Understandable** — content and operation must be understandable (clear labels, predictable behavior).
- A11Y-04: **Robust** — content must be interpreted by assistive technologies (semantic markup).

---

## 2. Flutter Accessibility Rules

### 2.1 Semantic Labels
- A11Y-05: Every interactive widget (buttons, icons, form fields) MUST have a semantic label via `Semantics(label: '...')`.
- A11Y-06: `IconButton` MUST set `tooltip` or `Semantics(label: ...)`.
- A11Y-07: Images conveying information MUST use `Semantics(label: '...')`.
- A11Y-08: Decorative images MUST be excluded from semantics: `ExcludeSemantics(child: Image(...))`.
- A11Y-09: Custom tap targets (GestureDetector) MUST wrap with `Semantics(button: true, label: '...')`.

### 2.2 Touch Targets
- A11Y-10: All interactive elements MUST have a minimum touch target of **48×48 dp**.
- A11Y-11: Use `SizedBox` or padding to ensure minimum target size even if the visual element is smaller.

### 2.3 Color & Contrast
- A11Y-12: Text contrast ratio MUST be ≥ **4.5:1** for normal text (< 18pt).
- A11Y-13: Large text (≥ 18pt regular or ≥ 14pt bold) contrast ratio MUST be ≥ **3:1**.
- A11Y-14: Color MUST NOT be the sole differentiator for conveying information — use icons, labels, or patterns alongside color.

### 2.4 Screen Reader Support
- A11Y-15: Dynamic state changes (loading, error, success) MUST announce updates via `SemanticsService.announce(message, TextDirection.ltr)`.
- A11Y-16: Focus order MUST follow a logical reading sequence.
- A11Y-17: Modal dialogs and bottom sheets MUST trap focus within the overlay.
- A11Y-18: `Semantics(liveRegion: true)` MUST be used for content that updates dynamically.

### 2.5 Forms & Inputs
- A11Y-19: `TextField` MUST have a `labelText` or explicit `Semantics(label: ...)`.
- A11Y-20: Validation errors MUST be announced to screen readers, not only displayed visually.
- A11Y-21: Required fields MUST be indicated semantically, not just visually.

---

## 3. React Native Accessibility Rules

### 3.1 Accessibility Props
- A11Y-22: All interactive elements MUST have `accessibilityLabel` describing the action or content.
- A11Y-23: `accessibilityRole` MUST be set correctly:
  - `button` for tap actions
  - `link` for navigation
  - `header` for section headings
  - `image` for images
  - `checkbox`, `radio`, `switch` for form controls
- A11Y-24: `accessibilityHint` MUST be provided for actions whose outcome is not obvious from the label.
- A11Y-25: `accessibilityState` MUST be set for stateful elements: `{ disabled, selected, checked, expanded }`.

### 3.2 Images
- A11Y-26: Images conveying information MUST have `accessible={true}` and `accessibilityLabel`.
- A11Y-27: Decorative images MUST have `accessible={false}` to hide from screen readers.

### 3.3 Touch Targets
- A11Y-28: All interactive elements MUST meet minimum touch target: **44×44 points (iOS)** / **48×48 dp (Android)**.
- A11Y-29: Insufficient visual sizes MUST be extended using padding or `hitSlop`.

### 3.4 Color & Contrast
- A11Y-30: Same contrast requirements as Flutter (4.5:1 normal, 3:1 large text).
- A11Y-31: Color MUST NOT be the sole information carrier.

### 3.5 Screen Reader & Focus
- A11Y-32: `AccessibilityInfo.announceForAccessibility(message)` MUST be used for important dynamic updates.
- A11Y-33: Modal screens MUST use `accessibilityViewIsModal={true}` on the container.
- A11Y-34: Focus MUST be managed explicitly on screen transitions for screen reader users.

### 3.6 Forms & Inputs
- A11Y-35: `TextInput` MUST have `accessibilityLabel` and `placeholder` (placeholder alone is insufficient).
- A11Y-36: Error messages MUST be announced to screen readers on validation failure.

---

## 4. Testing Accessibility

- A11Y-37: Screen reader testing MUST be performed on real devices:
  - iOS: VoiceOver
  - Android: TalkBack
- A11Y-38: Automated accessibility linting SHOULD be configured in CI:
  - Flutter: `flutter_accessibility_tools` or manual widget tests with `SemanticsController`
  - React Native: `eslint-plugin-react-native-a11y`
- A11Y-39: Contrast ratios MUST be validated using a contrast checker tool before merging.

---

## 5. Common Anti-Patterns

### Unlabeled Icon Buttons
```dart
// ❌ Bad
IconButton(icon: Icon(Icons.delete), onPressed: onDelete)

// ✅ Good
IconButton(icon: Icon(Icons.delete), tooltip: 'Delete order', onPressed: onDelete)
```

### Color-Only Status
```
// ❌ Bad: red text = error, green text = success (screen reader sees same text)
// ✅ Good: "Error: Invalid email" or "Success: Order placed" + semantic announcement
```

### Tiny Touch Targets
```dart
// ❌ Bad: 16×16 icon with no padding
// ✅ Good: Wrap with SizedBox(width: 48, height: 48) or add padding
```
