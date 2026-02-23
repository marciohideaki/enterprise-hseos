# Flutter Feature Template
## Gold Standard — Copy & Paste Ready

This document defines the **standard feature template** for a modern Flutter application following the Flutter Architecture Standard.

---

## 1. Feature Folder Structure

```text
features/<feature_name>/
  presentation/
    pages/
      <feature>_page.dart
    widgets/
    state/
      <feature>_controller.dart
      <feature>_state.dart
    routes/
      <feature>_routes.dart
  application/
    usecases/
      <action>_<feature>.dart
    dtos/
    mappers/
  domain/
    entities/
    value_objects/
    repositories/
      <feature>_repository.dart
    errors/
  data/
    datasources/
      remote/
      local/
    models/
    repositories/
      <feature>_repository_impl.dart
```

---

## 2. Mandatory Rules

- No UI logic in `domain` or `application`
- No HTTP calls outside `data`
- No state mutation inside widgets
- All async calls return `Result<T>`

---

## 3. Controller Example (Simplified)

```dart
class FeatureController extends StateNotifier<FeatureState> {
  final FeatureUseCase useCase;

  FeatureController(this.useCase) : super(const FeatureState.initial());

  Future<void> load() async {
    state = const FeatureState.loading();

    final result = await useCase.execute();

    state = result.when(
      success: (data) => FeatureState.success(data),
      failure: (error) => FeatureState.error(error),
    );
  }
}
```

---

## 4. Widget Responsibility

- Render UI only
- Dispatch intents to controller
- React to state changes

---

## 5. Ownership

Each feature must have a clear owner and a README describing its scope.