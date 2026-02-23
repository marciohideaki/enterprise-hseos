# React Native — Modern Features Standard

**Version:** 1.0
**Status:** Canonical / Normative
**Scope:** React Native 0.73+ / New Architecture — adoption guidance and mandatory patterns

> This document defines **mandatory adoption patterns for modern React Native capabilities**.
> It covers the New Architecture (Fabric + JSI), TurboModules, Hermes, Reanimated 3, and React 18 concurrency features.
>
> Compliance is required for all new projects. Existing projects must migrate per the timelines in each section.

---

## Referenced Platform Standards (MANDATORY)

This standard **must be applied together with**:

- **React Native Architecture Standard**
- **React Native Idiomatic Guide**
- **React Native Build & Toolchain Standard**
- **React Native Testing Standard**
- **React Native Non-Functional Requirements (NFR)**

Non-compliance with any referenced document is a blocking violation.

---

## 1. New Architecture — Fabric + JSI

- MF-RN-01: The New Architecture encompasses three pillars: **Fabric** (concurrent renderer), **JSI** (JavaScript Interface, replaces the asynchronous bridge), and **TurboModules** (lazy-loaded native modules with CodeGen typing). All three must be understood together — enabling one without the others provides no benefit.
- MF-RN-02: The New Architecture is **enabled by default from React Native 0.74+**. Projects on 0.73 may enable it explicitly. Projects on 0.72 or earlier must plan migration before adding new native modules.
- MF-RN-03: **JSI eliminates the asynchronous JSON bridge**. Native calls become synchronous C++ function invocations from the JS heap — no serialization, no copy. This enables worklets and shared C++ objects between JS and native.
- MF-RN-04: **Fabric** implements React 18 concurrent rendering on mobile — priorities, `startTransition`, Suspense, and interruptible rendering are only possible with Fabric active.
- MF-RN-05: To enable the New Architecture in a **legacy Android project**, set `newArchEnabled=true` in `android/gradle.properties`. For iOS, pass `-RCT_NEW_ARCH_ENABLED=1` to CocoaPods or set `ENV['RCT_NEW_ARCH_ENABLED'] = '1'` in `Podfile`.

```ruby
# ios/Podfile — enable New Architecture
ENV['RCT_NEW_ARCH_ENABLED'] = '1'

platform :ios, min_ios_version_supported
prepare_react_native_project!
```

```properties
# android/gradle.properties — enable New Architecture
newArchEnabled=true
hermesEnabled=true
```

- MF-RN-06: **New projects MUST use the New Architecture**. Disabling it requires an ADR with documented justification and a migration timeline. "Incompatible library" is a valid temporary reason but triggers a 90-day remediation clock.
- MF-RN-07: Before migrating an existing project, **audit all native dependencies for New Architecture compatibility**. Incompatible libraries block the migration at the build level.
- MF-RN-08: Use the official compatibility tool to audit dependencies before migration.

```bash
# Check New Architecture compatibility of all dependencies
npx react-native-new-architecture check

# Or manually check a specific package
npx react-native-new-architecture check --package react-native-maps
```

- MF-RN-09: When a dependency is not New Architecture compatible, evaluate in order: (1) upgrade to a newer version, (2) replace with a compatible alternative, (3) wrap with a compatibility shim, (4) file an ADR for temporary opt-out.
- MF-RN-10: **Verification** — confirm New Architecture is active at runtime by checking the global flag. Remove this check after migration is validated in production.

```typescript
// Verify New Architecture is active (development / CI check only)
import { TurboModuleRegistry } from 'react-native';

const isNewArchEnabled = global.__turboModuleProxy != null;

if (__DEV__ && !isNewArchEnabled) {
  console.error(
    '[MF-RN-10] New Architecture is NOT active. ' +
    'Check newArchEnabled=true in gradle.properties and Podfile.',
  );
}
```

---

## 2. TurboModules

- MF-RN-11: **TurboModules** are the New Architecture replacement for Legacy Native Modules. They are lazy-loaded (instantiated on first use, not at app startup), typed via CodeGen, and communicate synchronously through JSI.
- MF-RN-12: Create a TurboModule when you need access to a platform API for which no New Architecture-compatible community library exists. Do not reinvent existing well-maintained libraries.
- MF-RN-13: Every TurboModule **MUST have a TypeScript spec file** (`Native<ModuleName>.ts`) that serves as the single source of truth. CodeGen generates C++, Java/Kotlin, and Objective-C/Swift headers from this file.

```typescript
// src/specs/NativeBiometrics.ts — TurboModule spec
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  readonly authenticate: (reason: string) => Promise<boolean>;
  readonly isAvailable: () => Promise<boolean>;
  readonly getSupportedTypes: () => Promise<string[]>;
}

export default TurboModuleRegistry.strictGet<Spec>('Biometrics');
```

- MF-RN-14: CodeGen is invoked via the build system automatically when spec files are placed in the correct directory. Manual invocation for validation during development:

```bash
# Validate spec and generate headers (run from project root)
yarn react-native codegen

# Inspect generated output
ls android/app/build/generated/source/codegen/
ls ios/build/generated/ios/
```

- MF-RN-15: **New native modules MUST be TurboModules**. Legacy Native Modules (`NativeModules.ModuleName`) are forbidden in new code. Existing Legacy modules must be migrated when touched for any reason other than a critical bug fix.
- MF-RN-16: **Performance difference** — Legacy modules are all registered at startup, increasing TTI proportionally to module count. TurboModules are instantiated only when first called, with zero startup cost if unused.
- MF-RN-17: Consume a TurboModule through its typed spec — never via the untyped `NativeModules` object.

```typescript
// Correct: typed, lazy, New Architecture compatible
import NativeBiometrics from '../specs/NativeBiometrics';

export async function authenticate(reason: string): Promise<boolean> {
  const available = await NativeBiometrics.isAvailable();
  if (!available) return false;
  return NativeBiometrics.authenticate(reason);
}

// FORBIDDEN: untyped Legacy access
// NativeModules.Biometrics.authenticate(reason) — violates MF-RN-15
```

- MF-RN-18: **Mocking TurboModules in Jest** — mock the spec module directly; do not mock `NativeModules`.

```typescript
// jest/__mocks__/NativeBiometrics.ts
const NativeBiometricsMock = {
  authenticate: jest.fn().mockResolvedValue(true),
  isAvailable: jest.fn().mockResolvedValue(true),
  getSupportedTypes: jest.fn().mockResolvedValue(['fingerprint', 'face']),
};

export default NativeBiometricsMock;
```

```typescript
// In jest.config.js or jest.setup.ts
jest.mock('../src/specs/NativeBiometrics');
```

---

## 3. Fabric Custom Components

- MF-RN-19: **Fabric** is React Native's new concurrent renderer. It operates in three phases — Render (JS), Commit (shadow tree diff, C++), and Mount (native views) — and integrates with React 18's scheduler for interruptible rendering.
- MF-RN-20: A **Custom Fabric Component** is a native view registered with the Fabric renderer via a TypeScript spec and CodeGen. It replaces the Legacy `requireNativeComponent` pattern.
- MF-RN-21: Every Fabric Component **MUST have a TypeScript spec file** (`<ComponentName>NativeComponent.ts`) defining props via `ViewProps` and the `codegenNativeComponent` factory.

```typescript
// src/specs/VideoPlayerNativeComponent.ts — Fabric component spec
import type { ViewProps } from 'react-native';
import type { HostComponent } from 'react-native';
import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';

interface NativeProps extends ViewProps {
  readonly uri: string;
  readonly paused?: boolean;
  readonly muted?: boolean;
  readonly resizeMode?: 'cover' | 'contain' | 'stretch';
}

export default codegenNativeComponent<NativeProps>(
  'VideoPlayer',
) as HostComponent<NativeProps>;
```

- MF-RN-22: Consume the generated Fabric component with full TypeScript typing — props are validated at compile time.

```typescript
// Usage of the Fabric custom component
import VideoPlayer from '../specs/VideoPlayerNativeComponent';

export function VideoScreen({ uri }: { uri: string }) {
  return (
    <VideoPlayer
      uri={uri}
      paused={false}
      muted={false}
      resizeMode="cover"
      style={{ width: '100%', height: 200 }}
    />
  );
}
```

- MF-RN-23: Create a Custom Fabric Component when wrapping a platform view (e.g., `AVPlayer`, `ExoPlayer`, `MapView`) for which no New Architecture-compatible community package exists.
- MF-RN-24: **New custom native view components MUST use Fabric**. `requireNativeComponent` is forbidden in new code. Existing Legacy components must migrate when the enclosing feature is worked on.

---

## 4. Expo vs. Bare Workflow

- MF-RN-25: **Expo SDK 50+** fully supports the New Architecture and Hermes. Expo-managed workflow on SDK 50+ is acceptable for projects without custom native modules that are unsupported by Expo's plugin system.
- MF-RN-26: **Expo Go is for prototyping only**. It MUST NOT be used as the runtime for production or staging environments. Production builds MUST use EAS Build or a custom native build pipeline.
- MF-RN-27: **Expo bare workflow** (Expo SDK + generated `ios/` and `android/` directories) is the **preferred starting point for new projects**. It provides Expo's tooling, OTA updates, and EAS Build while allowing arbitrary native customization.
- MF-RN-28: `npx expo prebuild` generates the native project directories from `app.json` / `app.config.ts` and config plugins. Prebuild output MUST be committed to version control.

```bash
# Create a new project with Expo bare workflow and New Architecture
npx create-expo-app MyApp --template bare-minimum
cd MyApp

# Prebuild to generate native directories
npx expo prebuild --clean

# Verify New Architecture is enabled
grep -r "newArchEnabled" android/gradle.properties
```

- MF-RN-29: **Expo config plugins** are the mandatory mechanism for configuring native build settings in Expo projects — not direct edits to `Podfile` or `build.gradle` where a plugin exists.

```typescript
// app.config.ts — typed Expo configuration
import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'MyApp',
  slug: 'my-app',
  version: '1.0.0',
  plugins: [
    ['expo-camera', { cameraPermission: 'Allow $(PRODUCT_NAME) to access your camera.' }],
    ['expo-build-properties', { android: { newArchEnabled: true }, ios: { newArchEnabled: true } }],
  ],
};

export default config;
```

- MF-RN-30: Use **React Native CLI (no Expo)** when: the project requires native modules not supported by any Expo config plugin, the build pipeline requires platform-level customization incompatible with Expo's abstractions, or a legal/compliance requirement mandates it.
- MF-RN-31: **The choice between Expo bare and React Native CLI REQUIRES an ADR**. The ADR must document: evaluation criteria, libraries assessed for Expo compatibility, build pipeline requirements, and team mobile expertise level.
- MF-RN-32: **EAS Build** is the preferred CI/CD platform for React Native apps. Custom Jenkins/GitHub Actions native build pipelines are permitted but must achieve feature parity with EAS (code signing, environment variables, build artifacts, OTA channel management) and justify the operational overhead in an ADR.

```yaml
# eas.json — EAS Build configuration
{
  "cli": { "version": ">= 7.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "staging": {
      "distribution": "internal",
      "env": { "APP_ENV": "staging" }
    },
    "production": {
      "autoIncrement": true,
      "env": { "APP_ENV": "production" }
    }
  }
}
```

---

## 5. Hermes Engine

- MF-RN-33: **Hermes** is a JavaScript engine optimized for React Native, built by Meta. It replaces JavaScriptCore (JSC) as the default engine. It compiles JS to bytecode at build time, reducing parse time at app launch.
- MF-RN-34: Hermes is **enabled by default from React Native 0.70+** and is non-negotiable for New Architecture projects. The combination Hermes + New Architecture is the mandatory baseline for production performance.
- MF-RN-35: Hermes benefits: pre-compiled bytecode (faster cold start), lower peak memory usage, smaller JS bundle footprint, deterministic GC optimized for mobile memory pressure.
- MF-RN-36: **Debug with Hermes** using the Chrome DevTools Hermes profiler or Flipper's Hermes Debugger plugin. The legacy `chrome://inspect` debugger is not Hermes-aware.

```typescript
// Confirm Hermes is active at runtime (dev/CI assertion only)
declare const HermesInternal: { getRuntimeProperties?: () => Record<string, string> } | undefined;

if (__DEV__) {
  const isHermes = typeof HermesInternal !== 'undefined';
  if (!isHermes) {
    console.error(
      '[MF-RN-36] Hermes is NOT active. ' +
      'Check hermesEnabled=true in gradle.properties and ios/Podfile.',
    );
  }
}
```

- MF-RN-37: **Disabling Hermes requires an ADR** with: a reproducible benchmark showing JSC outperforming Hermes on the target device tier, sign-off from a senior mobile engineer, and a re-evaluation date within 60 days.
- MF-RN-38: When profiling startup performance, measure **Time-to-Interactive (TTI)** with Hermes bytecode pre-compilation active. Report startup regressions against the NFR baseline defined in the Non-Functional Requirements Standard.

---

## 6. React Native Reanimated 3 and Worklets

- MF-RN-39: **Reanimated 3** provides a worklet-based animation system that runs entirely on the **UI thread**, avoiding JS thread frame drops. It requires JSI and is the mandatory animation library for performance-sensitive animations.
- MF-RN-40: **Worklets** are JS functions annotated with `'worklet'` that are serialized and executed on the UI thread. They have access to shared values but not to the full JS runtime — closures are allowed, but async operations and most third-party libraries are not.
- MF-RN-41: Core Reanimated 3 primitives — `useSharedValue` (cross-thread reactive value), `useAnimatedStyle` (derives animated style from shared values), `withTiming` (easing-based transition), `withSpring` (physics-based spring).

```typescript
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming,
} from 'react-native-reanimated';

export function AnimatedCard() {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const onPress = () => {
    scale.value = withSpring(0.95, { damping: 15, stiffness: 200 });
    opacity.value = withTiming(0.8, { duration: 120 });
  };

  return <Animated.View style={animatedStyle} onTouchStart={onPress} />;
}
```

- MF-RN-42: **Animações de 60/120fps DEVEM usar Reanimated 3**. The legacy `Animated` API from React Native core runs on the JS thread and is forbidden for any animation visible during user interaction (scroll, drag, press feedback, transitions).
- MF-RN-43: `useAnimatedScrollHandler` is the mandatory API for scroll-driven animations. Using `onScroll` with a regular handler and `Animated.event` is forbidden for performance-critical scroll interactions.

```typescript
import Animated, { useSharedValue, useAnimatedScrollHandler, useAnimatedStyle, interpolate } from 'react-native-reanimated';

export function CollapsibleHeader({ children }: React.PropsWithChildren) {
  const scrollY = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      'worklet';
      scrollY.value = event.contentOffset.y;
    },
  });

  const headerStyle = useAnimatedStyle(() => ({
    height: interpolate(scrollY.value, [0, 100], [120, 60], 'clamp'),
    opacity: interpolate(scrollY.value, [0, 80], [1, 0], 'clamp'),
  }));

  return (
    <>
      <Animated.View style={headerStyle} />
      <Animated.ScrollView onScroll={scrollHandler} scrollEventThrottle={16}>
        {children}
      </Animated.ScrollView>
    </>
  );
}
```

- MF-RN-44: **Gestos interativos com animações DEVEM usar `react-native-gesture-handler` integrado ao Reanimated 3**. `TouchableOpacity`, `TouchableHighlight`, and `PanResponder` are forbidden for gestures that drive animations.
- MF-RN-45: Use `Gesture.Pan()`, `Gesture.Tap()`, `Gesture.Pinch()` from the Gesture Handler imperative API. Compose gestures with `Gesture.Simultaneous()`, `Gesture.Exclusive()`, `Gesture.Race()`.

```typescript
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, runOnJS,
} from 'react-native-reanimated';

export function SwipeableCard({ onDismiss }: { onDismiss: () => void }) {
  const translateX = useSharedValue(0);

  const panGesture = Gesture.Pan()
    .onUpdate((e) => { translateX.value = e.translationX; })
    .onEnd((e) => {
      if (Math.abs(e.translationX) > 150) {
        runOnJS(onDismiss)();
      } else {
        translateX.value = withSpring(0);
      }
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View style={[{ width: '100%', height: 200 }, cardStyle]} />
    </GestureDetector>
  );
}
```

- MF-RN-46: **`runOnJS`** is the only permitted mechanism to call regular JS functions from a worklet context (e.g., dispatching a Redux action on dismiss). Avoid calling `runOnJS` inside `onUpdate` handlers — call it only in terminal gesture callbacks (`onEnd`, `onFinalize`).

---

## 7. React 18 Features in React Native

- MF-RN-47: React 18 concurrent features are available in React Native when Fabric is active. This includes `useTransition`, `useDeferredValue`, `Suspense` for data, and `startTransition`. These APIs are only effective with the New Architecture — they are no-ops in the legacy renderer.
- MF-RN-48: **`useTransition`** marks a state update as non-urgent. The UI remains responsive to urgent updates (e.g., input typing) while the non-urgent update (e.g., filtering a large list) is processed in the background.

```typescript
import { useState, useTransition } from 'react';
import { TextInput, FlatList, ActivityIndicator } from 'react-native';

export function SearchableList({ items }: { items: string[] }) {
  const [query, setQuery] = useState('');
  const [filtered, setFiltered] = useState(items);
  const [isPending, startTransition] = useTransition();

  const onChangeText = (text: string) => {
    setQuery(text); // urgent — updates input immediately
    startTransition(() => {
      setFiltered(items.filter((item) => item.includes(text)));
    });
  };

  return (
    <>
      <TextInput value={query} onChangeText={onChangeText} />
      {isPending && <ActivityIndicator />}
      <FlatList data={filtered} renderItem={({ item }) => <>{item}</>} />
    </>
  );
}
```

- MF-RN-49: **`useDeferredValue`** defers a value update to a lower priority render pass. Use it when a component re-renders are expensive and the value drives a costly computation (e.g., a large sorted table derived from a search input).

```typescript
import { useState, useDeferredValue, useMemo } from 'react';

function useFilteredResults(items: readonly string[], query: string) {
  const deferredQuery = useDeferredValue(query);
  return useMemo(
    () => items.filter((item) => item.toLowerCase().includes(deferredQuery.toLowerCase())),
    [items, deferredQuery],
  );
}
```

- MF-RN-50: **`Suspense`** in React Native (with Fabric) is the mandatory pattern for lazy component loading and asynchronous data boundaries. Wrap lazily-loaded screens or data-fetching components in `<Suspense fallback={<LoadingScreen />}>`.

```typescript
import { Suspense, lazy } from 'react';
import { LoadingScreen } from '../components/LoadingScreen';

// Note: React.lazy requires a bundler that supports dynamic import()
// Verify support with Metro's experimentalImportSupport flag before adopting
const DashboardScreen = lazy(() => import('../screens/DashboardScreen'));

export function AppNavigator() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <DashboardScreen />
    </Suspense>
  );
}
```

- MF-RN-51: **`React.lazy` in React Native** depends on Metro bundler support for dynamic `import()`. As of React Native 0.73, enable `experimentalImportSupport` in `metro.config.js`. Verify the Metro version in the project before adopting `React.lazy` universally — it is not enabled by default.

```javascript
// metro.config.js — enable dynamic import support for React.lazy
const { getDefaultConfig } = require('@react-native/metro-config');

const config = getDefaultConfig(__dirname);
config.transformer.experimentalImportBundleNames = true;

module.exports = config;
```

- MF-RN-52: **`startTransition`** (imperative form, outside hooks) is used for marking updates as non-urgent in event handlers outside React components — e.g., in response to a WebSocket message or a timer callback. It is equivalent to the `startTransition` returned by `useTransition` but usable anywhere.

```typescript
import { startTransition } from 'react';

// In a WebSocket message handler outside a component
socket.onmessage = (event) => {
  const payload = JSON.parse(event.data) as LiveFeedItem;
  startTransition(() => {
    setLiveFeedItems((prev) => [payload, ...prev].slice(0, 100));
  });
};
```

---

## Compliance Summary

| Rule ID | Description | Enforcement |
|---|---|---|
| MF-RN-06 | New projects use New Architecture | ADR required to opt-out |
| MF-RN-15 | New native modules are TurboModules | PR review gate |
| MF-RN-24 | New native views use Fabric | PR review gate |
| MF-RN-31 | Expo vs. bare decision requires ADR | Architecture review |
| MF-RN-37 | Hermes disablement requires ADR + benchmark | ADR with expiry |
| MF-RN-42 | 60/120fps animations use Reanimated 3 | PR review gate |
| MF-RN-44 | Interactive gestures use Gesture Handler | PR review gate |

---

*Last updated: 2026-02-21*
