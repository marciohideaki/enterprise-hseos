# Flutter / Dart — Idiomatic Guide
## Gold Standard / State-of-the-Art

**Version:** 1.0
**Status:** Canonical / Normative
**Runtime:** Flutter 3.19+ / Dart 3.3+

> Defines mandatory Dart language idioms, Flutter patterns, and community best practices.
> Supplements the Flutter Architecture Standard.

---

## 1. Modern Dart Feature Adoption

- IG-01: Dart 3.3+ / Flutter 3.19+ minimum for all new features.
- IG-02: Sound null safety mandatory — no `!` (bang operator) without documented justification.
- IG-03: Records (Dart 3.0+) used for lightweight, anonymous data structures and multiple return values.
- IG-04: Patterns (Dart 3.0+) used for destructuring and matching: `switch`, `if-case`, list/map patterns.
- IG-05: Sealed classes (Dart 3.0+) used for closed type hierarchies (state machines, result types).
- IG-06: `final` variables everywhere possible — `var` only when reassignment is needed.
- IG-07: `const` constructors used on all widget classes that support it — enables widget caching.
- IG-08: Extension methods used to add functionality to existing types without subclassing.
- IG-09: Named parameters preferred for functions with 2+ parameters — positional only for obvious pairs.

```dart
// Records for multiple return values
(double lat, double lng) getCoordinates() => (51.5, -0.1);
final (lat, lng) = getCoordinates();

// Sealed class for exhaustive state
sealed class OrderState {}
final class OrderPending extends OrderState {}
final class OrderConfirmed extends OrderState { final String confirmationId; ... }
final class OrderFailed extends OrderState { final String reason; ... }

// Pattern matching (exhaustive switch)
Widget build(BuildContext context) => switch (state) {
  OrderPending()     => const PendingWidget(),
  OrderConfirmed(confirmationId: var id) => ConfirmedWidget(id: id),
  OrderFailed(reason: var r)  => FailedWidget(reason: r),
};
```

---

## 2. Null Safety Idioms

- IG-10: `?.` null-aware access used for optional chaining.
- IG-11: `??` null-coalescing for default values: `name ?? 'Anonymous'`.
- IG-12: `??=` null-coalescing assignment for lazy initialization.
- IG-13: `!` bang operator forbidden in production code without a comment explaining why null is impossible.
- IG-14: `required` keyword on named parameters that must be provided.
- IG-15: Late initialization (`late`) used only when a variable cannot be initialized in the constructor — document why.

---

## 3. Immutability

- IG-16: `final` fields in all classes — no mutable public fields.
- IG-17: `const` constructors on all value-like classes (Value Objects, DTOs).
- IG-18: `copyWith` pattern on immutable data classes:

```dart
@immutable
class UserProfile {
  const UserProfile({required this.name, required this.email});
  final String name;
  final String email;

  UserProfile copyWith({String? name, String? email}) =>
      UserProfile(name: name ?? this.name, email: email ?? this.email);
}
```

- IG-19: `@immutable` annotation on all classes that must not change after construction.
- IG-20: `List<T>.unmodifiable()`, `Map.unmodifiable()` for returning collections from domain methods.

---

## 4. Widget Patterns

- IG-21: `const` widget constructors used wherever possible — critical for performance.
- IG-22: Widget composition over inheritance — prefer composing small widgets over extending existing ones.
- IG-23: `StatelessWidget` preferred; use `StatefulWidget` only when local mutable state is genuinely needed.
- IG-24: Extract widgets into separate classes (not methods) when they have their own lifecycle or keys.
- IG-25: `Key` parameters on list items, reorderable widgets, and widgets with state that must be preserved.
- IG-26: `BuildContext` never stored across `async` gaps — check `mounted` before using context after `await`.

```dart
// Extract widget — not a method
class OrderItemCard extends StatelessWidget {
  const OrderItemCard({super.key, required this.item});
  final OrderItem item;

  @override
  Widget build(BuildContext context) => Card(child: Text(item.name));
}

// Check mounted after async
Future<void> _submit() async {
  await _repo.save(order);
  if (!mounted) return;           // guard before using context
  Navigator.of(context).pop();
}
```

---

## 5. Async / Future / Stream

- IG-27: `async`/`await` used for all asynchronous code — no raw `Future.then()` chains.
- IG-28: `Stream` used for continuous data sequences — not repeated `Future` calls.
- IG-29: `StreamController` closed in `dispose()` — no stream leaks.
- IG-30: `FutureBuilder`/`StreamBuilder` used for reactive UI binding — no manual `setState` on Future completion.
- IG-31: Error handling in async: `try`/`catch` with specific exception types.
- IG-32: `unawaited()` used to explicitly mark intentionally unawaited futures.

---

## 6. Concurrency (Isolates)

- IG-33: `Isolate.run()` (Dart 2.19+) used for CPU-bound work — keeps UI thread free.
- IG-34: `compute()` (Flutter) used as simpler alternative to `Isolate.run()` for single function calls.
- IG-35: No heavy computation on the main isolate — JSON parsing of large payloads, image processing, crypto.
- IG-36: Isolates share no memory — pass only plain objects (no `BuildContext`, no `ChangeNotifier`).

```dart
// Off main isolate
final result = await Isolate.run(() => parseHeavyJson(rawJson));

// Or compute() shorthand
final items = await compute(parseItemList, jsonString);
```

---

## 7. Error Handling

- IG-37: Custom exception hierarchy per feature domain.
- IG-38: `Result<T>` pattern (or `Either<L, R>`) used at repository/use-case boundaries.
- IG-39: `FlutterError.onError` and `PlatformDispatcher.instance.onError` configured at app startup for uncaught errors.
- IG-40: Never swallow exceptions with empty `catch {}`.

---

## 8. Anti-Patterns (Forbidden)

| Anti-Pattern | Why |
|---|---|
| `!` bang without comment | Runtime null crash |
| Storing `BuildContext` across async | Stale context, crashes |
| Widget build methods with business logic | Separation of concerns |
| Heavy computation on main isolate | UI jank |
| Raw `Future.then()` chains | Hard to read/debug |
| Non-const widget constructors where const possible | Rebuild performance loss |
| Mutable public fields on domain objects | Breaks immutability |

---
