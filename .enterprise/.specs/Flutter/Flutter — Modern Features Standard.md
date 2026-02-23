# Flutter — Modern Features Standard

**Version:** 1.0
**Status:** Canonical / Normative
**Scope:** Flutter 3.19+ / Dart 3.3+ modern features — adoption guidance and mandatory patterns

> This document defines **mandatory adoption patterns** for modern Flutter and Dart features.
> It complements the Flutter Architecture Standard and the Flutter Idiomatic Guide.
> All rules marked with **MUST** are non-negotiable without an approved ADR.

---

## 1. Impeller Rendering Engine

### Overview

Impeller is Flutter's next-generation rendering engine, built as a replacement for Skia. It was designed from the ground up to eliminate *shader compilation jank* — the stuttering caused by Skia compiling GLSL shaders at runtime on first use.

| Platform | Status |
|---|---|
| iOS | Default since Flutter 3.10 |
| Android (Vulkan) | Default since Flutter 3.16 |
| Android (OpenGL ES) | Preview; Vulkan path is preferred |
| macOS / Desktop | In progress |

### Benefits

- Eliminates runtime shader compilation: all shaders are compiled ahead-of-time during the engine build.
- Frame times become predictable — no first-frame spikes on complex animations.
- Raster thread work is parallelised via Metal (iOS) and Vulkan (Android).

### Rules

- **MF-FL-01:** Impeller **MUST NOT** be disabled unless an ADR is filed documenting the exact runtime regression, affected device range, and the planned remediation timeline.

  ```yaml
  # pubspec.yaml — only with approved ADR
  flutter:
    # Impeller disabled — teams MUST file an ADR (e.g., ADR-XXXX-<service>-impeller-disable.md)
    # Reason: CustomPainter shader X produces incorrect output on Mali-G57 (Android 10)
    # Planned fix: Flutter 3.22 expected to resolve upstream Impeller Vulkan blending issue
  ```

  ```xml
  <!-- AndroidManifest.xml — only with approved ADR -->
  <meta-data
    android:name="io.flutter.embedding.android.EnableImpeller"
    android:value="false" />
  ```

- **MF-FL-02:** When adding a new `CustomPainter` or fragment shader (`.frag`), the author **MUST** verify the output under Impeller before merging. Use a physical device or the `--enable-impeller` flag on Android emulator.

- **MF-FL-03:** Fragment shaders used via `FragmentProgram` **MUST** be tested on the Impeller path. Shaders relying on Skia-specific behaviour (e.g., unsupported GLSL extensions) **MUST** be rewritten or removed.

  ```dart
  // Loading a fragment shader — works with Impeller on iOS/Android
  Future<FragmentShader> _loadShader() async {
    final program = await FragmentProgram.fromAsset('shaders/my_effect.frag');
    return program.fragmentShader();
  }
  ```

- **MF-FL-04:** `Canvas.drawAtlas()` and `Canvas.drawRawAtlas()` are supported by Impeller. Prefer them over individual `drawImage()` calls in sprite-heavy UIs.

### Auditing Custom Shaders for Impeller Compatibility

- **MF-FL-05:** Run `flutter run --enable-impeller` on each target platform during feature development. Do not wait for QA to discover regressions.
- **MF-FL-06:** Any visual difference between Skia and Impeller **MUST** be reported as a bug in the project issue tracker and linked to the upstream Flutter issue.

### Measuring Frame Performance

- **MF-FL-07:** Use `flutter run --profile` (never `--debug`) when measuring frame times. Debug mode disables all JIT optimisations and inflates raster times.

  ```bash
  flutter run --profile --enable-impeller
  ```

- **MF-FL-08:** Frame time baselines **MUST** be captured in Flutter DevTools → Performance tab → Frame Chart before and after any rendering-related change. A P99 raster time above **8 ms** on a mid-range device (e.g., Pixel 4a) requires investigation.

  ```dart
  // Enable build profiling in main.dart for DevTools widget rebuild view
  void main() {
    debugProfileBuildsEnabled = true; // remove before release build
    runApp(const MyApp());
  }
  ```

---

## 2. Platform Channels and FFI

### Platform Channels

Platform channels are the primary mechanism for Flutter to communicate with platform-native code (Swift/Objective-C on iOS, Kotlin/Java on Android).

| Channel Type | Use Case |
|---|---|
| `MethodChannel` | One-off request / response calls |
| `EventChannel` | Continuous native → Dart streams (sensors, subscriptions) |
| `BasicMessageChannel` | Low-level, codec-controlled bidirectional messaging |

### Rules

- **MF-FL-09:** Platform channel code **MUST** live exclusively under `lib/infrastructure/platform/`. It **MUST NOT** appear in presentation widgets or domain logic.

  ```
  lib/
    infrastructure/
      platform/
        battery/
          battery_channel.dart        ← channel implementation
          battery_platform_interface.dart  ← abstract interface
        location/
          location_channel.dart
  ```

- **MF-FL-10:** Every `MethodChannel` **MUST** be wrapped behind a Dart interface. The interface is what the rest of the application imports. This allows unit tests to inject a mock without touching native code.

  ```dart
  // battery_platform_interface.dart
  abstract class BatteryPlatform {
    Future<int> getBatteryLevel();
  }

  // battery_channel.dart
  class BatteryChannel implements BatteryPlatform {
    static const _channel = MethodChannel('com.example/battery');

    @override
    Future<int> getBatteryLevel() async {
      final level = await _channel.invokeMethod<int>('getBatteryLevel');
      return level ?? -1;
    }
  }
  ```

- **MF-FL-11:** `MethodChannel.invokeMethod()` calls **MUST** be wrapped in `try`/`catch` with `PlatformException` handling. Raw `PlatformException` **MUST NOT** propagate to the domain or presentation layers.

  ```dart
  @override
  Future<int> getBatteryLevel() async {
    try {
      final level = await _channel.invokeMethod<int>('getBatteryLevel');
      return level ?? -1;
    } on PlatformException catch (e) {
      throw BatteryUnavailableException(message: e.message ?? 'unknown');
    }
  }
  ```

- **MF-FL-12:** `EventChannel` streams **MUST** be closed (subscription cancelled) in the `dispose()` or widget teardown that owns them.

  ```dart
  class _LocationListenerState extends State<LocationListener> {
    final _channel = EventChannel('com.example/location');
    StreamSubscription<dynamic>? _sub;

    @override
    void initState() {
      super.initState();
      _sub = _channel.receiveBroadcastStream().listen(_onLocation);
    }

    @override
    void dispose() {
      _sub?.cancel();
      super.dispose();
    }

    void _onLocation(dynamic event) { /* handle */ }
  }
  ```

- **MF-FL-13:** Platform channel tests **MUST** use `TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler` or a mock implementation of the platform interface — never call live native code in unit tests.

  ```dart
  test('getBatteryLevel returns parsed level', () async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
      const MethodChannel('com.example/battery'),
      (call) async => call.method == 'getBatteryLevel' ? 87 : null,
    );
    final battery = BatteryChannel();
    expect(await battery.getBatteryLevel(), 87);
  });
  ```

### FFI (dart:ffi)

Use `dart:ffi` when integrating C/C++ shared libraries directly, bypassing JNI/Objective-C overhead for performance-critical paths.

- **MF-FL-14:** FFI bindings **MUST** live under `lib/infrastructure/ffi/`. The generated bindings (`ffigen` output) **MUST** be committed as checked-in source — never regenerated at runtime.

- **MF-FL-15:** `package:ffi` **MUST** be used for struct allocation and string marshalling. Raw `Pointer<Void>` manipulation without `package:ffi` helpers is forbidden.

  ```dart
  import 'dart:ffi';
  import 'package:ffi/ffi.dart';

  final _lib = DynamicLibrary.open('libnative.so');

  final _nativeHash = _lib.lookupFunction<
    Int32 Function(Pointer<Utf8>),
    int Function(Pointer<Utf8>)
  >('native_hash');

  int computeHash(String input) {
    final ptr = input.toNativeUtf8();
    try {
      return _nativeHash(ptr);
    } finally {
      calloc.free(ptr);  // always free — no GC for native memory
    }
  }
  ```

- **MF-FL-16:** All native memory allocated via `calloc` or `malloc` **MUST** be freed in a `finally` block. Memory leaks in FFI code will not be caught by the Dart GC.

- **MF-FL-17:** FFI code **MUST** have contract tests validating the ABI boundary: correct function signatures, correct return types, and null pointer behaviour.

- **MF-FL-18:** Use `package:ffigen` to generate bindings from C headers. The `ffigen.yaml` configuration **MUST** be version-controlled alongside the library headers.

---

## 3. State Management — Architectural Decision

### Supported Options

| Solution | Status | When to Use |
|---|---|---|
| Riverpod 2.x | **Recommended for new projects** | Greenfield, type-safe, full code-gen support |
| BLoC / flutter_bloc | Permitted | Teams with established BLoC expertise; do not migrate for the sake of it |
| Provider | Legacy only | Gradual migration path from existing Provider codebases |
| `setState` | Permitted for local ephemeral UI state | Form field focus, animation toggles within a single widget |

### Why Riverpod is the Default

Riverpod solves the main weaknesses of Provider:

- Providers are declared globally but scoped via `ProviderScope` — no `BuildContext` required to read a provider.
- Compile-time safety: accessing an unregistered provider is a compile error, not a runtime crash.
- `AsyncNotifier` and `Notifier` replace `ChangeNotifier` with an explicit async lifecycle.
- Trivially testable: override any provider in tests via `ProviderContainer` without a widget tree.

### Rules

- **MF-FL-19:** The choice of state management solution for a project **MUST** be recorded in an ADR before the first feature is implemented. The ADR **MUST** evaluate Riverpod, BLoC, and local `setState` for the project's scale.

- **MF-FL-20:** A single project **MUST NOT** mix Riverpod, BLoC, and `setState` for equivalent layers of state management. Mixing is permitted only when `setState` is used for purely local ephemeral UI state (e.g., hover, focus) alongside a global solution.

- **MF-FL-21:** For new projects using Riverpod, the `@riverpod` annotation with `riverpod_generator` **MUST** be used. Manual provider declarations are only permitted for providers that cannot be expressed with the annotation.

  ```dart
  // users_provider.dart
  import 'package:riverpod_annotation/riverpod_annotation.dart';
  part 'users_provider.g.dart';

  @riverpod
  class UsersNotifier extends _$UsersNotifier {
    @override
    Future<List<User>> build() => ref.watch(userRepositoryProvider).fetchAll();

    Future<void> refresh() async {
      state = const AsyncLoading();
      state = await AsyncValue.guard(
        () => ref.read(userRepositoryProvider).fetchAll(),
      );
    }
  }
  ```

- **MF-FL-22:** `AsyncNotifier.build()` **MUST** contain only the initial data load. Side effects (refresh, mutations) **MUST** be separate methods.

- **MF-FL-23:** Riverpod providers **MUST** be scoped to their feature via file organisation. Cross-feature providers live in `lib/shared/providers/`. A feature **MUST NOT** directly `ref.watch` a provider from a sibling feature — it **MUST** go through a shared interface.

- **MF-FL-24:** In tests, every Riverpod provider **MUST** be overridable. Use `ProviderContainer` for unit tests and `ProviderScope(overrides: [...])` for widget tests.

  ```dart
  test('UsersNotifier emits user list', () async {
    final container = ProviderContainer(overrides: [
      userRepositoryProvider.overrideWithValue(FakeUserRepository()),
    ]);
    addTearDown(container.dispose);

    await expectLater(
      container.read(usersNotifierProvider.future),
      completion(hasLength(3)),
    );
  });
  ```

- **MF-FL-25:** BLoC projects **MUST** use `flutter_bloc` 8.x+ with sealed classes for events and states — not plain abstract classes with `extends`. This enables exhaustive pattern matching.

- **MF-FL-26:** `StreamController`-based state management outside of BLoC/Riverpod primitives is **FORBIDDEN** in new code. If a `StreamController` is genuinely needed, it **MUST** be wrapped in a provider or BLoC.

---

## 4. Records and Patterns (Dart 3)

### Records

Records are anonymous, immutable, structurally-typed aggregate types introduced in Dart 3.0. They are value-equal by default.

```dart
// Positional record
(String name, int age) getUser() => ('Alice', 30);
final (name, age) = getUser();

// Named record fields
({String name, int age}) getUserNamed() => (name: 'Alice', age: 30);
final user = getUserNamed();
print(user.name);   // Alice
print(user.age);    // 30
```

### Rules

- **MF-FL-27:** Records **MUST** be used instead of `Map<String, dynamic>` or positional `List` for multiple return values. Type safety is non-negotiable.

- **MF-FL-28:** Named record fields **MUST** be used when a record has more than two fields or when field semantics are not immediately obvious from position.

  ```dart
  // Preferred — named fields, self-documenting
  ({double latitude, double longitude, double accuracy}) getPosition();

  // Forbidden — positional with 3+ fields, order ambiguous
  (double, double, double) getPosition();
  ```

- **MF-FL-29:** Records are appropriate for local DTOs that do not cross module boundaries. If a type is part of a public API (function signature visible across features), define a named class or use a sealed class instead.

- **MF-FL-30:** Destructuring **MUST** be used when consuming records — do not access fields by name only when the values are immediately bound to local variables.

  ```dart
  final (:latitude, :longitude) = getPosition();
  // Equivalent to:
  // final latitude = pos.latitude; final longitude = pos.longitude;
  ```

### Pattern Matching

- **MF-FL-31:** `switch` expressions with exhaustive patterns **MUST** be used for sealed classes — do not use `if`/`else if` chains over sealed subtype checks.

  ```dart
  sealed class Result<T> {}
  final class Ok<T> extends Result<T> { const Ok(this.value); final T value; }
  final class Err<T> extends Result<T> { const Err(this.message); final String message; }

  String describe<T>(Result<T> result) => switch (result) {
    Ok(:final value)   => 'Success: $value',
    Err(:final message) => 'Error: $message',
  };
  ```

- **MF-FL-32:** `if-case` **MUST** be used for single-branch pattern extraction — do not cast manually.

  ```dart
  void handleEvent(Object event) {
    if (event case UserLoggedIn(:final userId)) {
      _analytics.trackLogin(userId);
    }
  }
  ```

- **MF-FL-33:** List and map patterns are permitted for simple structural matching. Avoid nesting them more than two levels deep — extract intermediate variables for readability.

- **MF-FL-34:** Sealed class hierarchies used as discriminated unions (state, result, events) **MUST** use `sealed class` at the root and `final class` for concrete subtypes. This enables Dart's exhaustiveness checker.

  ```dart
  sealed class AuthState {}
  final class AuthInitial extends AuthState {}
  final class AuthLoading extends AuthState {}
  final class AuthAuthenticated extends AuthState {
    const AuthAuthenticated({required this.user});
    final User user;
  }
  final class AuthError extends AuthState {
    const AuthError({required this.message});
    final String message;
  }
  ```

---

## 5. Isolates and Compute

### Concurrency Model

Dart is single-threaded per isolate. Isolates are independent workers with their own heap — no shared memory, no race conditions. Communication happens via `SendPort`/`ReceivePort` message passing.

| API | Use Case |
|---|---|
| `compute(fn, message)` | Simple one-shot offload; Flutter-specific helper |
| `Isolate.run(fn)` | Modern one-shot isolate; Dart 2.19+; preferred |
| `Isolate.spawn(fn, message)` | Long-lived isolate with bidirectional communication |

### Rules

- **MF-FL-35:** Any synchronous operation that benchmarks above **16 ms** on a mid-range device **MUST** be moved off the main isolate. Use Flutter DevTools → Performance → CPU Profiler to identify hot paths.

- **MF-FL-36:** JSON parsing of responses with more than **100 objects** or a raw payload larger than **50 KB MUST** use `Isolate.run()` or `compute()`.

  ```dart
  // Correct — parse on background isolate
  Future<List<Product>> _parseProducts(String json) =>
      Isolate.run(() {
        final decoded = jsonDecode(json) as List<dynamic>;
        return decoded.map((e) => Product.fromJson(e as Map<String, dynamic>)).toList();
      });
  ```

- **MF-FL-37:** Image processing (resizing, filtering, encoding) **MUST** be performed off the main isolate. Use `Isolate.run()` or the `image` package's isolate-aware APIs.

  ```dart
  Future<Uint8List> _resizeImage(Uint8List bytes, int targetWidth) =>
      Isolate.run(() {
        final img = decodeImage(bytes)!;
        final resized = copyResize(img, width: targetWidth);
        return Uint8List.fromList(encodePng(resized));
      });
  ```

- **MF-FL-38:** Only plain, serialisable objects may be passed across isolate boundaries. **MUST NOT** pass `BuildContext`, `ChangeNotifier`, `Stream`, `StreamController`, `ProviderContainer`, or any object containing a native handle.

- **MF-FL-39:** `compute()` is a Flutter-layer helper equivalent to `Isolate.run()` for one-shot tasks. Prefer `Isolate.run()` in new code — it is the canonical Dart API and works in non-Flutter Dart as well.

- **MF-FL-40:** Long-lived isolates created with `Isolate.spawn()` **MUST** have an explicit shutdown protocol. The owning object **MUST** send a sentinel message and await the isolate's exit before `dispose()` completes.

  ```dart
  class _WorkerIsolate {
    late final Isolate _isolate;
    late final SendPort _sendPort;

    Future<void> start() async {
      final receivePort = ReceivePort();
      _isolate = await Isolate.spawn(_worker, receivePort.sendPort);
      _sendPort = await receivePort.first as SendPort;
    }

    Future<void> stop() async {
      _sendPort.send(null); // null = shutdown sentinel
      await _isolate.kill(priority: Isolate.immediate);
    }
  }
  ```

- **MF-FL-41:** Crypto operations (hashing, encryption of large buffers) **MUST** run in an isolate when the input exceeds **10 KB**.

- **MF-FL-42:** Use `package:async` (`StreamQueue`, `AsyncMemoizer`, `CancelableOperation`) for high-level async primitives rather than raw `Completer` or manual `StreamController` wiring.

---

## 6. Flutter DevTools and Performance

### Widget Rebuild Tracking

- **MF-FL-43:** `debugProfileBuildsEnabled = true` **MUST** be used during active performance investigation. It **MUST NOT** be committed to production code. Gate it behind a compile-time constant or remove before the release build.

  ```dart
  void main() {
    // Remove or gate behind kDebugMode before release
    assert(() {
      debugProfileBuildsEnabled = true;
      return true;
    }());
    runApp(const MyApp());
  }
  ```

- **MF-FL-44:** No widget that does not change its output **MUST** rebuild during navigation or parent state changes. Use `const` constructors, granular `Consumer` / `ref.watch` scopes, and `select` to narrow subscriptions.

  ```dart
  // Granular selector — only rebuilds when userName changes, not the entire user object
  final userName = ref.watch(userProvider.select((u) => u.name));
  ```

### Raster Thread Jank

- **MF-FL-45:** When the DevTools Frame Chart shows raster thread frames exceeding **8 ms**, investigate in this order:
  1. Identify offending widgets via the Raster metrics tab.
  2. Wrap expensive subtrees with `RepaintBoundary` to isolate raster work.
  3. Cache complex `CustomPaint` output using `Picture` or `ImageCache`.

  ```dart
  // Isolate expensive chart from the rest of the screen
  RepaintBoundary(
    child: ComplexChartWidget(data: snapshot.data!),
  )
  ```

- **MF-FL-46:** `RepaintBoundary` **MUST NOT** be added speculatively. Add it only after profiling confirms a paint boundary reduces raster thread time. Overuse increases memory pressure (each boundary creates an offscreen layer).

### List Performance

- **MF-FL-47:** `ListView.builder` (or `SliverList.builder`) **MUST** be used for any list whose item count is not known at compile time or may exceed 20 items. `ListView(children: [...])` is **FORBIDDEN** for variable-length lists — it builds all children eagerly.

  ```dart
  // Correct
  ListView.builder(
    itemCount: products.length,
    itemBuilder: (context, index) => ProductCard(product: products[index]),
  )

  // Forbidden for lists of unknown or large size
  // ListView(children: products.map((p) => ProductCard(product: p)).toList())
  ```

### Image Caching

- **MF-FL-48:** Network images **MUST** be loaded with explicit dimension constraints to prevent unnecessary over-decoding. Use `cacheWidth` / `cacheHeight` on `Image.network`, or use `CachedNetworkImage` with `memCacheWidth` / `memCacheHeight`.

  ```dart
  // Decode at display size — avoids decoding a 2048x2048 image for a 80x80 avatar
  Image.network(
    user.avatarUrl,
    width: 80,
    height: 80,
    cacheWidth: 160,   // 2x for high-DPI screens
    cacheHeight: 160,
  )

  // Preferred for HTTP caching + memory caching
  CachedNetworkImage(
    imageUrl: user.avatarUrl,
    memCacheWidth: 160,
    memCacheHeight: 160,
    width: 80,
    height: 80,
  )
  ```

---

## Compliance Summary

| Rule | Enforcement |
|---|---|
| MF-FL-01 | ADR required to disable Impeller |
| MF-FL-02 | CustomPainter/shader verified on Impeller before merge |
| MF-FL-09 | Platform channel code in `lib/infrastructure/platform/` |
| MF-FL-10 | Every MethodChannel behind a Dart interface |
| MF-FL-13 | Platform channel unit tests use mock handler |
| MF-FL-16 | FFI native memory freed in `finally` |
| MF-FL-19 | State management choice documented in ADR |
| MF-FL-20 | One state management solution per project (no mixing) |
| MF-FL-21 | Riverpod: `@riverpod` annotation mandatory in new projects |
| MF-FL-27 | Records instead of `Map<String, dynamic>` for multiple returns |
| MF-FL-31 | Sealed classes consumed via exhaustive `switch` expressions |
| MF-FL-36 | Large JSON parsed in `Isolate.run()` or `compute()` |
| MF-FL-37 | Image processing off main isolate |
| MF-FL-44 | No unnecessary widget rebuilds on navigation |
| MF-FL-47 | `ListView.builder` mandatory for variable-length lists |
| MF-FL-48 | `cacheWidth`/`cacheHeight` on all network images |

> **ADR:** Architecture Decision Record — stored under `.enterprise/.specs/decisions/`.
