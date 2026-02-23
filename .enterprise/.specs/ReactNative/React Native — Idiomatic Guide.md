# React Native / TypeScript — Idiomatic Guide
## Gold Standard / State-of-the-Art

**Version:** 1.0
**Status:** Canonical / Normative
**Runtime:** React Native 0.73+ / TypeScript 5.3+

> Defines mandatory TypeScript and React Native idioms, patterns, and community best practices.
> Supplements the React Native Architecture Standard.

---

## 1. TypeScript Strict Mode

- IG-01: `"strict": true` in `tsconfig.json` — mandatory for all projects. Enables: `strictNullChecks`, `noImplicitAny`, `strictFunctionTypes`, `strictPropertyInitialization`, `strictBindCallApply`.
- IG-02: `"noUncheckedIndexedAccess": true` — array/object index access returns `T | undefined`.
- IG-03: `"exactOptionalPropertyTypes": true` — prevents assigning `undefined` to optional properties.
- IG-04: `"noImplicitReturns": true` — all code paths in functions must return a value.
- IG-05: `unknown` used instead of `any` when type is genuinely unknown — requires type narrowing before use.
- IG-06: `any` forbidden except in auto-generated code or deliberate escape hatches with `// eslint-disable-next-line @typescript-eslint/no-explicit-any` and comment.

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

---

## 2. Type System Best Practices

- IG-07: Discriminated unions used for state modeling — not boolean flags.
- IG-08: `satisfies` operator (TS 4.9+) used to validate object literals without widening type.
- IG-09: `as const` used for literal type inference on readonly objects and arrays.
- IG-10: Template literal types used for string-based type constraints: `` type EventName = `on${Capitalize<string>}` ``.
- IG-11: Utility types used: `Partial<T>`, `Required<T>`, `Pick<T,K>`, `Omit<T,K>`, `Readonly<T>`, `ReturnType<F>`.
- IG-12: Custom type guards (`is` predicate) used for runtime type narrowing.
- IG-13: Branded/nominal types used for IDs to prevent mixing: `type OrderId = string & { readonly _brand: 'OrderId' }`.

```typescript
// Discriminated union for state
type OrderState =
  | { status: 'pending' }
  | { status: 'confirmed'; confirmationId: string }
  | { status: 'failed'; reason: string };

// Branded ID type
type OrderId = string & { readonly _brand: 'OrderId' };
function makeOrderId(id: string): OrderId { return id as OrderId; }

// as const for lookup tables
const ORDER_STATUS_LABELS = {
  pending:   'Awaiting confirmation',
  confirmed: 'Order confirmed',
  failed:    'Order failed',
} as const;
```

---

## 3. React Hooks Best Practices

- IG-14: Rules of Hooks enforced via ESLint `react-hooks/rules-of-hooks` — no conditional hook calls.
- IG-15: `useEffect` cleanup function returned for all subscriptions, timers, and event listeners.
- IG-16: `useCallback` used for event handlers passed to child components — prevents unnecessary re-renders.
- IG-17: `useMemo` used for expensive computations — not for every value (premature optimization).
- IG-18: Custom hooks extract reusable stateful logic — named `use{FeatureName}`.
- IG-19: `useRef` used for values that must persist across renders without causing re-renders.
- IG-20: `useReducer` preferred over multiple `useState` when state transitions are complex.
- IG-21: Dependency arrays in `useEffect`/`useCallback`/`useMemo` always complete — ESLint `react-hooks/exhaustive-deps` enforced.

```typescript
// Correct: useEffect with cleanup
useEffect(() => {
  const subscription = eventBus.subscribe('order:updated', handleUpdate);
  return () => subscription.unsubscribe(); // cleanup
}, [handleUpdate]);

// Correct: useCallback for stable reference
const handlePress = useCallback(() => {
  dispatch(placeOrder(orderData));
}, [dispatch, orderData]);
```

---

## 4. Component Design

- IG-22: Functional components only — no class components in new code.
- IG-23: Props typed with explicit `interface` or `type` — no inline prop types on complex components.
- IG-24: `React.memo()` used for pure components that receive stable props.
- IG-25: Component files export one primary component — named export preferred over default export.
- IG-26: Component names: `PascalCase`. Hook names: `camelCase` with `use` prefix.
- IG-27: Props interface named `{ComponentName}Props`.

```typescript
interface OrderCardProps {
  order: Order;
  onPress: (orderId: OrderId) => void;
}

export const OrderCard = React.memo<OrderCardProps>(({ order, onPress }) => {
  const handlePress = useCallback(() => onPress(order.id), [onPress, order.id]);
  return <Pressable onPress={handlePress}><Text>{order.total}</Text></Pressable>;
});
```

---

## 5. State Management

- IG-28: **Local state** (`useState`/`useReducer`): component-scoped data that does not need to be shared.
- IG-29: **Server state** (React Query / TanStack Query): remote data fetching, caching, synchronization.
- IG-30: **Global UI state** (Zustand / Redux Toolkit): cross-screen UI state.
- IG-31: **Navigation state**: React Navigation — not stored in global state.
- IG-32: Context API used only for low-frequency updates (theme, locale) — not for high-frequency state.
- IG-33: State management library choice must be documented in service ADR.

---

## 6. Async Patterns

- IG-34: `async`/`await` used for all async operations — no `.then()` chains.
- IG-35: `AbortController` used to cancel in-flight requests on component unmount.
- IG-36: `Promise.allSettled()` used when multiple async operations must all complete regardless of individual failures.
- IG-37: Error boundaries (`ErrorBoundary`) wrap screen-level components for graceful degradation.

---

## 7. Performance

- IG-38: `FlatList` / `SectionList` used for all lists — never `ScrollView` with `map()` for large datasets.
- IG-39: `keyExtractor` returning stable, unique string on all list components.
- IG-40: `getItemLayout` provided on `FlatList` when item height is fixed — enables scroll position restoration.
- IG-41: Images use `FastImage` or `Image` with explicit `width`/`height` — no unconstrained image rendering.

---

## 8. Anti-Patterns (Forbidden)

| Anti-Pattern | Why |
|---|---|
| `any` without justification | Defeats type safety |
| Class components | Legacy; hooks are idiomatic |
| Inline arrow functions in JSX props | New reference every render |
| `useEffect` without cleanup for subscriptions | Memory leak |
| `ScrollView` with `map()` for large lists | Performance |
| Default exports for components | Harder to refactor/find |
| Boolean state flags instead of discriminated unions | Impossible states |
| Context for high-frequency state | Performance |
