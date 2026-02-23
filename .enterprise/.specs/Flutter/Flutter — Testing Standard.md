# Flutter / Dart — Testing Standard
## Gold Standard / State-of-the-Art

**Version:** 1.0
**Status:** Canonical / Normative
**Runtime:** Flutter 3.19+ / flutter_test

> Defines mandatory testing conventions, patterns, and tooling for Flutter apps.

---

## 1. Test Naming Convention

- TS-01: Test names are descriptive sentences: `'should show loading indicator when fetching orders'`.

```dart
test('should reject order with empty items', () { });
testWidgets('should display order total correctly', (tester) async { });
```

- TS-02: Test file mirrors the source file: `order.dart` → `order_test.dart`.
- TS-03: Test files live in `test/` mirroring `lib/` structure.

---

## 2. Test Pyramid

- TS-04: **Unit tests** (`test/`): domain logic, use case handlers, mappers — no Flutter dependencies.
- TS-05: **Widget tests** (`test/`): individual widget rendering and interaction — `testWidgets`.
- TS-06: **Integration tests** (`integration_test/`): full app flows on device/emulator.

---

## 3. Widget Testing

- TS-07: `testWidgets` used for all widget tests — wraps in `WidgetsFlutterBinding`.
- TS-08: `WidgetTester.pumpWidget()` used to render widget under test.
- TS-09: `tester.pump()` after interactions — `pumpAndSettle()` for animations.
- TS-10: `find.byType()`, `find.byKey()`, `find.text()` for widget finding.
- TS-11: Semantic labels (`find.bySemanticsLabel`) used for accessibility-aware tests.

```dart
testWidgets('shows order items after loading', (WidgetTester tester) async {
    // Arrange
    await tester.pumpWidget(const MaterialApp(home: OrderListScreen()));
    await tester.pump();

    // Act
    await tester.tap(find.byType(RefreshIndicator));
    await tester.pumpAndSettle();

    // Assert
    expect(find.byType(OrderItemCard), findsWidgets);
});
```

---

## 4. Mocking

- TS-12: `mocktail` or `mockito` (with build_runner) used for mocking.
- TS-13: Mock classes created with `class MockOrderRepository extends Mock implements OrderRepository {}`.
- TS-14: `when(() => mock.method()).thenReturn(value)` (mocktail) or `when(mock.method()).thenReturn(value)` (mockito).
- TS-15: `verify(() => mock.method()).called(1)` for interaction verification.

---

## 5. Golden Tests

- TS-16: Golden tests used for pixel-perfect widget regression testing.
- TS-17: Goldens committed in `test/goldens/` — updated intentionally via `--update-goldens`.
- TS-18: `matchesGoldenFile('widget_name.png')` matcher used.
- TS-19: Goldens generated on consistent platform (CI Linux) — not mixed OS.

---

## 6. Coverage

- TS-20: Domain layer: >= 90% line coverage.
- TS-21: Application layer: >= 80% line coverage.
- TS-22: `flutter test --coverage` generates `coverage/lcov.info`.
- TS-23: `lcov` + `genhtml` used for HTML coverage reports.
- TS-24: Coverage thresholds enforced via `lcov --fail-under-lines` in CI.
