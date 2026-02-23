# React Native / TypeScript — Testing Standard
## Gold Standard / State-of-the-Art

**Version:** 1.0
**Status:** Canonical / Normative
**Runtime:** React Native 0.73+ / Jest 29+ / React Native Testing Library

> Defines mandatory testing conventions, patterns, and tooling for React Native apps.

---

## 1. Test Naming Convention

- TS-01: Test names are descriptive sentences in English: `'should display order total when order is loaded'`.

```typescript
it('should show loading indicator while fetching orders', () => {});
it('should display error message when request fails', async () => {});
describe('OrderCard', () => {
  it('renders the order total correctly', () => {});
});
```

- TS-02: `describe` blocks group tests by component or feature.
- TS-03: Test file mirrors source: `OrderCard.tsx` → `OrderCard.test.tsx`.

---

## 2. Test Framework

- TS-04: Jest 29+ as test runner.
- TS-05: React Native Testing Library (RNTL) for component tests — no Enzyme.
- TS-06: `@testing-library/jest-native` for extended RNTL matchers (`toBeVisible`, `toHaveTextContent`).

---

## 3. Component Testing (RNTL)

- TS-07: `render()` from RNTL used to render components under test.
- TS-08: Query by accessible semantics: `getByRole`, `getByLabelText`, `getByText` — not `getByTestId` as primary selector.
- TS-09: `getByTestId` used only when no semantic selector is available — always paired with `accessibilityLabel`.
- TS-10: `userEvent` (RNTL 12+) preferred over `fireEvent` for simulating user interactions.
- TS-11: `waitFor` used for async state updates — not arbitrary `setTimeout`.

```typescript
import { render, screen } from '@testing-library/react-native';
import { userEvent } from '@testing-library/react-native';

it('places order when submit is pressed', async () => {
  const user = userEvent.setup();
  render(<OrderForm onSubmit={mockSubmit} />);

  await user.type(screen.getByLabelText('Quantity'), '3');
  await user.press(screen.getByRole('button', { name: 'Place Order' }));

  expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({ quantity: 3 }));
});
```

---

## 4. Mocking

- TS-12: `jest.mock()` used to mock modules — declared at top of test file.
- TS-13: Manual mocks in `__mocks__/` directory for complex module replacements.
- TS-14: `jest.fn()` for mock functions — `mockReturnValue`, `mockResolvedValue`, `mockRejectedValue`.
- TS-15: `jest.spyOn()` for partial mocking of real objects.
- TS-16: Native module mocks set up in `jest/setup.ts` — no per-test native module mocking.

---

## 5. Hook Testing

- TS-17: `renderHook` from RNTL used for testing custom hooks in isolation.
- TS-18: `act()` wraps state-updating calls in hook tests.

```typescript
it('returns order total correctly', () => {
  const { result } = renderHook(() => useOrderTotal(mockItems));
  expect(result.current.total).toBe(150);
});
```

---

## 6. E2E Tests (Detox)

- TS-19: Detox used for critical user journey E2E tests.
- TS-20: E2E tests cover: login flow, core purchase flow, error recovery.
- TS-21: `testID` props added to interactive elements for Detox selectors.
- TS-22: E2E tests run in CI against debug build — separate pipeline from unit tests.

---

## 7. Coverage

- TS-23: Domain/use-case layer: >= 80% line coverage.
- TS-24: Component layer: >= 70% line coverage.
- TS-25: Coverage configured in `jest.config.js` with `coverageThreshold`.
- TS-26: `jest --coverage --coverageReporters=lcov` for CI reporting.

```javascript
// jest.config.js
module.exports = {
  coverageThreshold: {
    './src/domain/': { lines: 90 },
    './src/application/': { lines: 80 },
    './src/components/': { lines: 70 },
  },
};
```
