# C# / .NET — Testing Standard
## Gold Standard / State-of-the-Art Backend Engineering

**Version:** 1.0
**Status:** Canonical / Normative
**Runtime:** .NET 8+ / xUnit 2+

> Defines mandatory testing conventions, patterns, and tooling for .NET services.

---

## 1. Test Naming Convention

- TS-01: Test method names follow: `MethodName_Scenario_ExpectedResult`.

```csharp
[Fact] public void PlaceOrder_WithEmptyItems_ThrowsInvalidOrderException() {}
[Fact] public void Execute_WithValidCommand_ReturnsOrderId() {}
[Fact] public async Task FindById_WhenNotFound_ReturnsFailureResult() {}
```

- TS-02: Test class named after class under test + `Tests`: `OrderTests`, `PlaceOrderHandlerTests`.
- TS-03: Integration test classes use `IntegrationTests` suffix.
- TS-04: `[Trait("Category", "Unit")]` / `[Trait("Category", "Integration")]` used on all test classes.

---

## 2. Test Structure (AAA)

- TS-05: All tests follow Arrange-Act-Assert — each section separated by a blank line with comment.
- TS-06: One logical assertion per test — do not assert unrelated state.
- TS-07: No logic (loops, conditions) in test bodies — extract to helpers.

```csharp
[Fact]
public void Execute_WithValidCommand_ReturnsOrderId()
{
    // Arrange
    var command = new PlaceOrderCommand(CustomerId, Items);
    _repo.FindById(Arg.Any<OrderId>()).Returns(Result.Ok(existingOrder));

    // Act
    var result = _handler.Execute(command);

    // Assert
    result.IsSuccess.Should().BeTrue();
    result.Value.Should().NotBeNull();
}
```

---

## 3. Test Framework & Libraries

- TS-08: xUnit v2+ as test framework — no MSTest or NUnit for new services.
- TS-09: FluentAssertions for all assertions — no `Assert.Equal`.
- TS-10: NSubstitute for mocking — `Substitute.For<IOrderRepository>()`.
- TS-11: AutoFixture for test data generation — avoid hardcoded magic values.
- TS-12: Bogus for realistic domain-specific fake data.

---

## 4. Parameterized Tests

- TS-13: `[Theory]` + `[InlineData]` for simple parameterized tests.
- TS-14: `[Theory]` + `[MemberData]` for complex objects or large data sets.
- TS-15: `[Theory]` + `[ClassData]` for test data requiring setup logic.

```csharp
[Theory]
[InlineData(0)]
[InlineData(-1)]
[InlineData(int.MinValue)]
public void Create_WithInvalidQuantity_ThrowsException(int quantity)
{
    Action act = () => OrderItem.Create(ProductId, quantity);
    act.Should().Throw<InvalidOrderItemException>();
}
```

---

## 5. Architecture Tests

- TS-16: NetArchTest or ArchUnitNET used for architecture rule enforcement.
- TS-17: Architecture test class: `ArchitectureTests.cs` in dedicated test project.
- TS-18: Mandatory rules tested:
  - Domain has no references to Infrastructure or Application.
  - `IRepository` interfaces live only in Domain.
  - `Controller` classes live only in API layer.
  - No `[Entity]` / EF Core attributes in Domain.

```csharp
[Fact]
public void Domain_Should_Not_Reference_Infrastructure()
{
    var result = Types.InAssembly(DomainAssembly)
        .ShouldNot().HaveDependencyOn("Infrastructure")
        .GetResult();
    result.IsSuccessful.Should().BeTrue();
}
```

---

## 6. Integration Tests

- TS-19: `Microsoft.AspNetCore.Mvc.Testing` (`WebApplicationFactory`) for API integration tests.
- TS-20: Testcontainers for .NET used for database/broker integration tests.
- TS-21: `IClassFixture<T>` used for shared container state across test class.
- TS-22: `[Collection("Integration")]` used to prevent parallel container conflicts.

---

## 7. Coverage

- TS-23: Domain layer: ≥ 90% line coverage.
- TS-24: Application layer: ≥ 80% line coverage.
- TS-25: Infrastructure adapters: ≥ 60%.
- TS-26: Coverage measured via `coverlet.collector` and reported in CI.
- TS-27: Coverage thresholds enforced: `dotnet test /p:CollectCoverage=true /p:Threshold=80`.
- TS-28: Coverage exclusions declared via `[ExcludeFromCodeCoverage]` — not blanket directory exclusions.
