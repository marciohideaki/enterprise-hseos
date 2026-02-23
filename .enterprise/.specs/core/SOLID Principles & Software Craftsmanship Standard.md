# SOLID Principles & Software Craftsmanship Standard
## Core — Mandatory

**Version:** 1.0
**Status:** Canonical / Normative
**Scope:** All stacks — universal principles of object-oriented and functional design
**Classification:** Core (Organizational Invariant)

> This document defines the mandatory design principles that govern every unit of code produced in this organization, regardless of stack or paradigm.
> These rules apply to human-written and AI-generated code equally.
> Violations are compliance failures, not stylistic preferences.

---

## Referenced Standards (MANDATORY)

- **Enterprise Constitution**
- **Hexagonal & Clean Architecture Standard**
- **Naming & Conventions Standard**
- **Quality Gates & Compliance Standard**
- **Engineering Governance Standard**

---

## 1. Single Responsibility Principle

> A class or module has **exactly one reason to change**.

- **SP-01:** Every class, struct, or module MUST have exactly one well-defined responsibility that can be stated in a single sentence without the word "and".
- **SP-02:** A source file exceeding **200 lines** is a signal of an SRP violation and MUST be reviewed for decomposition.
- **SP-03:** A method or function exceeding **20 lines** (excluding blank lines and comments) is a signal of a responsibility leak and MUST be refactored.
- **SP-04:** Any class whose name contains `And`, `Manager`, `Helper`, `Utils`, `Service` (when generic) or `Processor` is presumed to violate SRP until proven otherwise. A code review justification is REQUIRED.
- **SP-05:** An agent generating a new class MUST be able to state its responsibility in one phrase before writing the first line of code. If it cannot, decomposition is required first.
- **SP-06:** I/O concerns (HTTP, database, file system) MUST NOT be mixed with business logic in the same class.
- **SP-07:** Validation logic MUST NOT reside in persistence or presentation layers. It belongs to the Domain layer.
- **SP-08:** Mapping logic (e.g., DTO ↔ Domain) MUST be isolated in dedicated mapper classes or functions — not inlined in handlers or repositories.
- **SP-09:** In Hexagonal Architecture, each layer carries a single responsibility: Domain holds rules, Application orchestrates use cases, Infrastructure handles I/O. Cross-layer logic is a violation.
- **SP-10:** A class that is difficult to name without a conjunction is evidence of a design problem, not a naming problem. Rename only after decomposing.

### 1.1 Violation and Correction — C#

```csharp
// VIOLATION: UserService does persistence, email, and business validation
public class UserService {
    public void Register(string email, string password) {
        if (!email.Contains("@")) throw new ArgumentException("Invalid email");
        _db.Users.Add(new User { Email = email, Password = Hash(password) });
        _db.SaveChanges();
        _smtp.Send(email, "Welcome!", "Your account is ready.");
    }
}

// CORRECTION: each class has one reason to change
public class UserRegistrationUseCase {
    public UserRegistrationUseCase(
        IUserRepository repository,
        IEmailPort emailPort,
        UserValidator validator) { ... }

    public void Execute(RegisterUserCommand cmd) {
        validator.Validate(cmd);                  // Domain rule
        var user = User.Create(cmd.Email, cmd.Password);
        repository.Save(user);                    // Port → Infrastructure
        emailPort.SendWelcome(user.Email);        // Port → Infrastructure
    }
}
```

### 1.2 Violation and Correction — Go

```go
// VIOLATION: handler mixes HTTP parsing, DB writes, and email dispatch
func RegisterHandler(w http.ResponseWriter, r *http.Request) {
    var req RegisterRequest
    json.NewDecoder(r.Body).Decode(&req)
    db.Exec("INSERT INTO users ...", req.Email, hash(req.Password))
    smtp.Send(req.Email, "Welcome!")
    w.WriteHeader(http.StatusCreated)
}

// CORRECTION: handler only handles HTTP; use case owns the workflow
func RegisterHandler(uc RegisterUserUseCase) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        var cmd RegisterUserCommand
        json.NewDecoder(r.Body).Decode(&cmd)
        if err := uc.Execute(r.Context(), cmd); err != nil {
            http.Error(w, err.Error(), http.StatusBadRequest)
            return
        }
        w.WriteHeader(http.StatusCreated)
    }
}
```

---

## 2. Open/Closed Principle

> Software entities MUST be **open for extension** and **closed for modification**.

- **SP-11:** New behaviors MUST be added by writing new code, not by editing existing, tested code.
- **SP-12:** A `switch` or `if/else if` chain with **more than 4 branches** that dispatches on a type, status, or kind field is a presumed OCP violation. Replace with polymorphism or the Strategy pattern.
- **SP-13:** Ports (Hexagonal) embody OCP: a new adapter is a new class implementing an existing interface — existing code is untouched.
- **SP-14:** MUST NOT add a new `case` to an existing `switch` in production code as the primary extension mechanism. Add a new implementation class instead.
- **SP-15:** Plugin-style extension (e.g., registering handlers in a DI container) is the preferred mechanism for extending behavior in Application and Infrastructure layers.
- **SP-16:** Domain rules that vary by context MUST be expressed as Strategy or Policy objects, not as conditional branches inside entities.
- **SP-17:** Decorators and middleware pipelines are valid OCP extensions. Modifying the core pipeline to add a cross-cutting concern is a violation.
- **SP-18:** An agent adding a new payment method, notification channel, or report format MUST create a new implementation — it MUST NOT modify the existing dispatcher.
- **SP-19:** Configuration-driven behavior is acceptable for simple feature flags; it MUST NOT substitute for proper polymorphism when behavior diverges substantially.
- **SP-20:** Abstract base classes used solely for sharing utility code (not contracts) violate OCP. Extract shared behavior to a collaborator instead.

### 2.1 Violation and Correction — Java

```java
// VIOLATION: every new payment method forces modification of existing code
public class PaymentProcessor {
    public void process(Payment p) {
        switch (p.getType()) {
            case CREDIT_CARD: chargeCreditCard(p); break;
            case PIX:         processPix(p); break;
            case BOLETO:      emitBoleto(p); break;
            // Adding CRYPTO requires editing this class — OCP violation
        }
    }
}

// CORRECTION: new methods add a new class, not a new case
public interface PaymentStrategy {
    void process(Payment payment);
}

public class CreditCardStrategy implements PaymentStrategy { ... }
public class PixStrategy       implements PaymentStrategy { ... }
public class CryptoStrategy    implements PaymentStrategy { ... } // no existing code touched

public class PaymentProcessor {
    private final Map<PaymentType, PaymentStrategy> strategies;
    public void process(Payment p) {
        strategies.get(p.getType()).process(p);
    }
}
```

### 2.2 Violation and Correction — TypeScript

```typescript
// VIOLATION: adding a new notification channel modifies this function
function notify(user: User, channel: string, message: string) {
  if (channel === "email") sendEmail(user.email, message);
  else if (channel === "sms") sendSms(user.phone, message);
  else if (channel === "push") sendPush(user.deviceToken, message);
}

// CORRECTION: each channel is a closed, independent unit
interface NotificationChannel {
  send(user: User, message: string): Promise<void>;
}

class EmailChannel implements NotificationChannel { ... }
class SmsChannel   implements NotificationChannel { ... }
class PushChannel  implements NotificationChannel { ... }

class NotificationDispatcher {
  constructor(private channels: NotificationChannel[]) {}
  async notify(user: User, message: string) {
    await Promise.all(this.channels.map(c => c.send(user, message)));
  }
}
```

---

## 3. Liskov Substitution Principle

> Subtypes MUST be substitutable for their base types **without altering the correctness of the program**.

- **SP-21:** Every overriding method MUST honor the contract of the method it overrides: same or weaker preconditions, same or stronger postconditions.
- **SP-22:** A subclass that throws an exception in an overriding method where the base class does not throw is a direct LSP violation and MUST be refactored.
- **SP-23:** The Rectangle/Square problem is the canonical LSP failure: a `Square` that overrides `SetWidth` and `SetHeight` together breaks callers expecting independent dimensions. Do NOT inherit when the shape of the contract changes.
- **SP-24:** Returning `null` or an empty stub from an overriding method to satisfy a method signature without fulfilling the contract is a violation.
- **SP-25:** Value Objects MUST NOT override equality in a way that breaks the contract of the base type or the interface they implement.
- **SP-26:** Aggregates that extend a base Aggregate MUST obey all invariants of the base. If they cannot, the inheritance hierarchy is incorrect.
- **SP-27:** An agent inheriting from a base class MUST explicitly verify: (a) preconditions are not strengthened, (b) postconditions are not weakened, (c) all abstract members can be fully implemented without stubs.
- **SP-28:** `new` (method hiding) in C# used to change behavior is always a LSP violation. Use `override` only when the full contract is honored.
- **SP-29:** Covariant return types are acceptable. Contravariant parameter types are acceptable. The reverse (narrower parameters on override) is a violation.
- **SP-30:** When LSP cannot be satisfied, prefer composition: wrap the problematic type rather than inheriting from it.

### 3.1 Violation and Correction — C# (Rectangle / Square)

```csharp
// VIOLATION: Square breaks the contract callers rely on
public class Rectangle {
    public virtual int Width  { get; set; }
    public virtual int Height { get; set; }
    public int Area() => Width * Height;
}

public class Square : Rectangle {
    public override int Width  { set { base.Width = base.Height = value; } get => base.Width; }
    public override int Height { set { base.Width = base.Height = value; } get => base.Height; }
}
// Caller sets Width=4, Height=5 and expects Area()=20 — Square returns 25. Program is incorrect.

// CORRECTION: no inheritance; share a common abstraction without coupling
public interface IShape { int Area(); }
public class Rectangle : IShape { public int Width; public int Height; public int Area() => Width * Height; }
public class Square    : IShape { public int Side;                      public int Area() => Side * Side; }
```

### 3.2 Violation and Correction — C# (NotImplementedException)

```csharp
// VIOLATION: subtype cannot honor all base contracts
public class ReadOnlyRepository : IUserRepository {
    public User GetById(Guid id) => _data[id];
    public void Save(User user)  => throw new NotImplementedException(); // LSP violation
    public void Delete(Guid id)  => throw new NotImplementedException(); // LSP violation
}

// CORRECTION: segregate the interface (connects to ISP)
public interface IUserReader    { User GetById(Guid id); }
public interface IUserWriter    { void Save(User user); void Delete(Guid id); }
public interface IUserRepository : IUserReader, IUserWriter { }

public class ReadOnlyUserStore : IUserReader {
    public User GetById(Guid id) => _data[id]; // full contract honored
}
```

---

## 4. Interface Segregation Principle

> Clients MUST NOT be forced to depend on interfaces they do not use.

- **SP-31:** Interfaces MUST be defined from the **client's perspective**, not from the implementor's capabilities.
- **SP-32:** Any implementation class with a method that throws `NotImplementedException`, `UnsupportedOperationException`, or returns a hardcoded default to satisfy a signature is a direct ISP violation.
- **SP-33:** An interface with more than **5–7 methods** is a candidate for decomposition. Document the justification if kept unified.
- **SP-34:** Ports in Hexagonal Architecture MUST be granular: one Port per use case or per tightly cohesive group of operations. A single `IRepository` exposing 15 methods is an ISP violation.
- **SP-35:** Composing multiple small interfaces into a larger one for convenience (e.g., `IUserRepository : IUserReader, IUserWriter`) is valid. The inverse (splitting a large one reactively) is a design smell.
- **SP-36:** Framework-imposed interfaces (e.g., `IDisposable`, `IComparable`) are excluded from the 5–7 method guideline when they are mandated by the runtime.
- **SP-37:** Test doubles (mocks, stubs) for large interfaces are a maintenance liability. If a mock requires 10 `setup` calls to satisfy one test, the interface is too broad.
- **SP-38:** An agent generating an interface MUST enumerate which methods each known consumer will use. Any method no consumer uses is removed.
- **SP-39:** Query interfaces and Command interfaces MUST be separate (connects to CQRS). A single interface with both read and write operations violates ISP and CQRS simultaneously.
- **SP-40:** Role interfaces (defining one behavioral role) are the gold standard. Prefer many role interfaces over one capability interface.

### 4.1 Violation and Correction — Go (idiomatic small interfaces)

```go
// VIOLATION: one large interface forces implementors to provide everything
type Storage interface {
    Save(ctx context.Context, user User) error
    GetByID(ctx context.Context, id string) (User, error)
    Delete(ctx context.Context, id string) error
    List(ctx context.Context, filter Filter) ([]User, error)
    Count(ctx context.Context, filter Filter) (int, error)
    Exists(ctx context.Context, id string) (bool, error)
}

// CORRECTION: Go-idiomatic small, focused interfaces
type UserSaver   interface { Save(ctx context.Context, u User) error }
type UserFinder  interface { GetByID(ctx context.Context, id string) (User, error) }
type UserLister  interface { List(ctx context.Context, f Filter) ([]User, error) }

// Use cases declare only what they need:
type RegisterUserUseCase struct { saver UserSaver }
type GetUserUseCase      struct { finder UserFinder }
```

### 4.2 Violation and Correction — Java

```java
// VIOLATION: ReportExporter is forced to implement methods it cannot use
public interface DocumentService {
    void save(Document doc);
    Document load(String id);
    void delete(String id);
    byte[] export(Document doc, String format); // only exporters care
    void index(Document doc);                   // only search cares
}

// CORRECTION: segregated by role
public interface DocumentPersistence { void save(Document d); Document load(String id); void delete(String id); }
public interface DocumentExporter    { byte[] export(Document d, String format); }
public interface DocumentIndexer     { void index(Document d); }

// ReportExporter implements only DocumentExporter — no stubs needed
public class PdfExporter implements DocumentExporter {
    public byte[] export(Document d, String format) { ... }
}
```

---

## 5. Dependency Inversion Principle

> High-level modules MUST NOT depend on low-level modules. Both MUST depend on abstractions.
> Abstractions MUST NOT depend on details. Details MUST depend on abstractions.

- **SP-41:** The Domain layer MUST have zero imports from Infrastructure, framework namespaces, or persistence libraries. Any such import is an immediate violation.
- **SP-42:** The Application layer MUST depend only on Domain types and Port interfaces. It MUST NOT reference concrete adapter classes.
- **SP-43:** Dependency Injection via **constructor** is the only permitted injection mechanism. Property injection and service-locator patterns are prohibited.
- **SP-44:** `new ConcreteInfrastructureClass()` inside Domain or Application code is a critical violation. The only `new` permitted in Domain is for Value Objects and Domain Events constructed from validated data.
- **SP-45:** DI container registration MUST occur exclusively in the Composition Root (startup / main module). Domain and Application layers MUST NOT reference the DI container.
- **SP-46:** Every external dependency (database, HTTP client, message broker, clock, random generator) MUST be hidden behind an interface defined in Application or Domain.
- **SP-47:** `DateTime.Now` / `time.Now()` called directly inside business logic is a DIP violation. Inject an `IClock` / `Clock` interface.
- **SP-48:** An agent wiring up a use case MUST verify: (a) all constructor parameters are interfaces, (b) no concrete infrastructure type appears in the constructor signature.
- **SP-49:** Circular dependencies between modules are a structural DIP violation. The dependency graph MUST be a DAG (directed acyclic graph).
- **SP-50:** Third-party SDK types (e.g., AWS SDK, Stripe SDK) MUST be wrapped in an adapter implementing a domain-defined interface. Application code MUST NOT reference SDK types directly.

### 5.1 Violation and Correction — C# with DI

```csharp
// VIOLATION: Application layer depends on concrete EF Core and SMTP
public class RegisterUserUseCase {
    private readonly AppDbContext _db;           // Infrastructure detail
    private readonly SmtpClient _smtp;           // Infrastructure detail

    public RegisterUserUseCase() {
        _db   = new AppDbContext();              // SP-44 violation
        _smtp = new SmtpClient("smtp.host.com"); // SP-44 violation
    }
}

// CORRECTION: depends only on abstractions; DI provides the implementation
public class RegisterUserUseCase {
    private readonly IUserRepository _repository; // Port interface (Application layer)
    private readonly IEmailPort      _emailPort;  // Port interface (Application layer)

    public RegisterUserUseCase(IUserRepository repository, IEmailPort emailPort) {
        _repository = repository;
        _emailPort  = emailPort;
    }
}

// Composition Root (Program.cs / Startup.cs) — the only place Infrastructure is named
services.AddScoped<IUserRepository, EfCoreUserRepository>();
services.AddScoped<IEmailPort,      SmtpEmailAdapter>();
services.AddScoped<RegisterUserUseCase>();
```

### 5.2 Violation and Correction — Go with interfaces

```go
// VIOLATION: use case imports and instantiates a concrete DB package
import "github.com/org/service/infrastructure/postgres"

type RegisterUserUseCase struct {
    repo *postgres.UserRepository // concrete type — DIP violation
}

// CORRECTION: use case owns the interface; infrastructure satisfies it
// In package application:
type UserRepository interface {
    Save(ctx context.Context, user domain.User) error
}

type RegisterUserUseCase struct {
    repo UserRepository // abstraction — no import of infrastructure
}

// In main.go (Composition Root):
pgRepo := postgres.NewUserRepository(db)
uc     := application.NewRegisterUserUseCase(pgRepo)
```

---

## 6. DRY — Don't Repeat Yourself

> Every piece of **knowledge** must have a single, unambiguous, authoritative representation in the system.

- **SP-51:** DRY applies to **knowledge** (business rules, domain logic, configuration schemas), not to syntactic similarity. Two code snippets that look alike but represent different concepts MUST NOT be forcibly unified.
- **SP-52:** A business rule implemented in two places is a DRY violation. One implementation MUST be the authoritative source; all others delegate to it.
- **SP-53:** Configuration values (connection strings, timeouts, feature flags) MUST have a single source of truth. Duplicating them across environment files is a violation.
- **SP-54:** Extract shared logic to a library or module only when: (a) it is used in **3 or more** independent places AND (b) the abstraction is stable (unlikely to diverge). Extracting at the second occurrence is premature.
- **SP-55:** The **Rule of Three** governs extraction: tolerate one duplication, examine the second, extract on the third.
- **SP-56:** Test code is exempt from strict DRY. Duplicated setup in tests is acceptable when it improves readability and test independence. A shared test helper is appropriate only when duplication becomes maintenance risk.
- **SP-57:** Schema definitions (API contracts, database schemas, event schemas) MUST be generated from a single canonical source (e.g., OpenAPI spec, Protobuf). Manual copies of a schema in multiple places are a DRY violation.
- **SP-58:** An agent MUST NOT inline a business rule it has already implemented elsewhere in the same codebase. It MUST locate and reference the existing authoritative implementation.

### 6.1 Violation and Correction — TypeScript

```typescript
// VIOLATION: VAT calculation rule duplicated in two modules
// In checkout.ts:
const total = subtotal * 1.23;
// In invoice.ts:
const invoiceTotal = amount * 1.23; // same rule, different place

// CORRECTION: single authoritative source
// In domain/tax/VatCalculator.ts:
export const VAT_RATE = 1.23;
export const applyVat = (amount: number): number => amount * VAT_RATE;

// Both checkout.ts and invoice.ts import from VatCalculator — one truth.
```

---

## 7. KISS — Keep It Simple, Stupid

> The simplest solution that correctly solves the problem is the correct solution.

- **SP-59:** Cyclomatic complexity MUST NOT exceed **10** per method or function. Automated linting MUST enforce this limit.
- **SP-60:** If a function requires a diagram to explain its logic and is under 20 lines, it is too complex. Decompose it.
- **SP-61:** Generic type parameters exceeding **2** on a single class or function are a strong signal of over-engineering. Document the justification.
- **SP-62:** Factory factories, abstract factories of abstract factories, and visitor patterns applied where a `switch` or dictionary dispatch would suffice are prohibited without explicit architectural justification documented in an ADR.
- **SP-63:** Abstraction layers MUST have at least one concrete consumer. An abstraction created "for future use" with no current consumer violates KISS and YAGNI simultaneously.
- **SP-64:** An agent choosing between two implementations MUST prefer the one a junior developer can understand within 5 minutes of reading, provided both implementations are functionally correct.
- **SP-65:** Premature optimization (optimizing before profiling demonstrates a bottleneck) violates KISS. The readable, correct solution ships first.

### 7.1 Indicator Table

| Signal | Action |
|---|---|
| Cyclomatic complexity > 10 | Decompose into smaller functions |
| Generics with 3+ type parameters | Evaluate if abstraction is necessary |
| Factory that creates other factories | Replace with direct construction or DI |
| Method impossible to unit-test without mocking 5+ dependencies | Redesign |
| Function that cannot be named without "and" | Split |

### 7.2 Example — Go

```go
// VIOLATION: over-engineered pipeline for a simple transformation
type Transformer[T any, R any] interface { Transform(T) R }
type Pipeline[T any, R any]   struct { steps []Transformer[T, R] }
func (p *Pipeline[T, R]) Execute(input T) R { ... }

// For a task that simply uppercases and trims a string.
// CORRECTION:
func NormalizeInput(s string) string {
    return strings.TrimSpace(strings.ToUpper(s))
}
```

---

## 8. YAGNI — You Aren't Gonna Need It

> Do not implement features based on speculative future need.

- **SP-66:** Code, parameters, tables, and interfaces MUST serve a current, demonstrable requirement. Speculative code is a liability.
- **SP-67:** Unused parameters MUST be removed. A parameter added "because it might be useful" is a YAGNI violation.
- **SP-68:** Commented-out code MUST be deleted. Version control preserves history. Commented code signals unfinished decisions.
- **SP-69:** Feature flags that have not been toggled in **90 days** MUST be evaluated for removal. Permanently disabled flags are dead code.
- **SP-70:** Database tables and columns with no current read or write path MUST be removed in the next migration window.
- **SP-71:** An agent MUST NOT add optional parameters, overloads, or configuration hooks unless explicitly requested. It MUST NOT justify them with "this could be useful later."
- **SP-72:** Exception: when the cost of adding a capability later is **demonstrably** high (e.g., breaking schema evolution, public API versioning), deferral to the future is explicitly justified in an ADR. This is the only valid exception.

### 8.1 Violation and Correction — C#

```csharp
// VIOLATION: optional parameters added speculatively
public Order CreateOrder(
    Cart cart,
    string? promoCode       = null,  // no promo system exists yet
    bool?   isPriority      = null,  // no priority queue exists yet
    string? partnerChannel  = null)  // no partner integration exists yet
{ ... }

// CORRECTION: only what is needed today
public Order CreateOrder(Cart cart) { ... }
// When promo codes are built, the method evolves with a real requirement behind it.
```

---

## 9. Law of Demeter

> A method MUST call only: its own methods, methods of its direct fields, methods of objects passed as parameters, and methods of objects it creates locally. Talk to your friends, not to strangers.

- **SP-73:** More than **2 levels of method chaining** on non-fluent objects in production code is a Law of Demeter violation.
- **SP-74:** `a.GetB().GetC().DoSomething()` — the caller knows the internal structure of `A` and `B`. This is coupling to implementation, not to interface. It is prohibited.
- **SP-75:** Fluent interfaces (LINQ, query builders, test assertion libraries) and builder patterns are **explicitly exempt** from the 2-level chaining rule.
- **SP-76:** Aggregates MUST expose **behavior**, not internal state. A caller should invoke `order.AddItem(item)` — never traverse `order.Items.Find(i => i.Id == id).Quantity++`.
- **SP-77:** When a chain is necessary to obtain data, the intermediate object SHOULD expose a query method that encapsulates the traversal.
- **SP-78:** The Law of Demeter is a coupling indicator. Violations increase the blast radius of changes: modifying `C` should not require changing callers of `A`.

### 9.1 Violation and Correction — C#

```csharp
// VIOLATION: caller traverses three object boundaries
decimal tax = order.GetCustomer().GetAddress().GetRegion().GetTaxRate();

// CORRECTION: Order exposes what callers need
public class Order {
    public TaxRate GetApplicableTaxRate() =>
        _customer.GetRegionalTaxRate(); // internal traversal is encapsulated
}

// Caller:
decimal tax = order.GetApplicableTaxRate(); // one level, no strangers
```

### 9.2 Violation and Correction — Go

```go
// VIOLATION: handler knows too much about internal structure
city := req.User.Address.City.Name // three hops into request internals

// CORRECTION: expose a query on the type that owns the data
func (u User) CityName() string { return u.Address.City.Name }

// Handler:
city := req.User.CityName() // single level call
```

---

## 10. Composition Over Inheritance

> Prefer composing objects to inheriting behavior. Inherit only when a true is-a relationship exists and LSP is guaranteed.

- **SP-79:** Inheritance MUST represent a true **is-a** relationship. Inheriting solely to reuse methods is prohibited; use composition with delegation instead.
- **SP-80:** Inheritance hierarchies MUST NOT exceed **2 levels** of concrete classes. Abstract base + one concrete level is the standard maximum.
- **SP-81:** When a subclass needs only one method from a base class, that method MUST be extracted to a collaborator. The subclass holds a reference to the collaborator, not the base.
- **SP-82:** The preferred patterns for behavioral reuse are: **Strategy** (interchangeable algorithms), **Decorator** (additive behavior), **Composite** (tree structures). Deep inheritance is never preferred.
- **SP-83:** Value Objects MUST NOT inherit from Entity. Domain Events MUST NOT inherit from Commands. These are distinct concepts; sharing code between them requires composition.
- **SP-84:** An agent generating a class hierarchy MUST confirm at each level: (a) the is-a relationship is real, (b) LSP is satisfied, (c) the hierarchy depth is within the 2-level limit.

### 10.1 Violation and Correction — Java

```java
// VIOLATION: inherit to reuse a single logging method
public class BaseHandler {
    protected void log(String msg) { System.out.println(msg); }
}
public class OrderHandler extends BaseHandler {
    // uses only log() — inheritance for code reuse, not is-a
}

// CORRECTION: compose with a logger collaborator
public class OrderHandler {
    private final Logger logger;
    public OrderHandler(Logger logger) { this.logger = logger; }
    // logger.log(...) — no inheritance needed
}
```

### 10.2 Violation and Correction — TypeScript

```typescript
// VIOLATION: three levels of inheritance to share utilities
class BaseEntity  { getId(): string { return this.id; } }
class BaseAudit   extends BaseEntity  { getCreatedAt(): Date { ... } }
class BasePayment extends BaseAudit   { getAmount(): number { ... } }
class CreditCard  extends BasePayment { /* actual business logic */ }
// Any change in BaseEntity cascades to all three levels.

// CORRECTION: flat, composed structure
class CreditCardPayment {
    constructor(
        private readonly id: EntityId,
        private readonly audit: AuditInfo,
        private readonly amount: Money) {}
    // Each collaborator is independently testable and replaceable.
}
```

---

## 11. Anti-Patterns of Craftsmanship

The following anti-patterns are **explicitly prohibited**. Detection of any of these patterns MUST trigger a mandatory refactoring before the code is merged.

### 11.1 Anti-Pattern Reference Table

| Code | Name | Description | Primary Indicator | Required Correction |
|---|---|---|---|---|
| SP-85 | God Class | A single class that knows and does too much | > 200 lines, > 10 methods, touches 5+ external concerns | Decompose along responsibility boundaries (SP-01 through SP-10) |
| SP-86 | Shotgun Surgery | A single change requires edits in many unrelated files | One business rule change touches 10+ files | Consolidate the divergent logic into a single authoritative location (SP-52) |
| SP-87 | Feature Envy | A method uses data and methods of another class more than its own | Method references `other.X`, `other.Y`, `other.Z` extensively | Move the method to the class it envies |
| SP-88 | Data Clumps | A group of fields always appears together but is not modeled as a type | 3+ parameters always passed together across multiple methods | Extract into a Value Object or parameter object |
| SP-89 | Primitive Obsession | Using primitives (string, int) to represent domain concepts | `string email`, `string iban`, `int age` with no validation | Introduce Value Objects with encapsulated validation |
| SP-90 | Magic Numbers / Strings | Unexplained literals in business logic | `if (status == 3)`, `timeout = 86400` | Extract to named constants or enumerations |

### 11.2 SP-85 — God Class

```csharp
// VIOLATION
public class OrderManager { // 600 lines
    public void CreateOrder(...) { }
    public void SendConfirmationEmail(...) { }
    public void ChargePayment(...) { }
    public void UpdateInventory(...) { }
    public decimal CalculateTax(...) { }
    public void GenerateInvoicePdf(...) { }
}

// CORRECTION: each concern is a focused class behind a use case
public class CreateOrderUseCase   { ... } // orchestrates
public class PaymentPort          { ... } // interface → adapter
public class InventoryPort        { ... } // interface → adapter
public class TaxCalculator        { ... } // domain service
public class InvoiceGenerator     { ... } // infrastructure adapter
```

### 11.3 SP-87 — Feature Envy

```go
// VIOLATION: Discount logic lives in OrderService but envies Cart
func (s *OrderService) ApplyDiscount(cart Cart) float64 {
    total := cart.Items[0].Price * float64(cart.Items[0].Qty)
    for _, item := range cart.Items[1:] {
        total += item.Price * float64(item.Qty)
    }
    return total * 0.9
}

// CORRECTION: move the logic to Cart where the data lives
func (c Cart) TotalWithDiscount(rate float64) float64 {
    return c.Total() * (1 - rate)
}
```

### 11.4 SP-88 — Data Clumps

```java
// VIOLATION: three fields always travel together but are never a type
public void createShipment(String street, String city, String postalCode) { ... }
public void validateAddress(String street, String city, String postalCode) { ... }

// CORRECTION: name the concept
public record Address(String street, String city, String postalCode) {
    public Address { Objects.requireNonNull(street); /* validation */ }
}
public void createShipment(Address destination) { ... }
public void validateAddress(Address address)    { ... }
```

### 11.5 SP-89 — Primitive Obsession

```typescript
// VIOLATION: email is just a string everywhere — invalid values propagate freely
function sendInvoice(email: string, amount: number): void { ... }
sendInvoice("not-an-email", -50); // no compile-time or runtime guard

// CORRECTION: Value Objects encapsulate validation at the boundary
class Email {
  private constructor(private readonly value: string) {}
  static parse(raw: string): Email {
    if (!raw.includes("@")) throw new Error("Invalid email");
    return new Email(raw);
  }
  toString(): string { return this.value; }
}

class Money {
  private constructor(private readonly cents: number) {}
  static of(cents: number): Money {
    if (cents < 0) throw new Error("Money cannot be negative");
    return new Money(cents);
  }
}

function sendInvoice(email: Email, amount: Money): void { ... }
```

### 11.6 SP-90 — Magic Numbers / Strings

```go
// VIOLATION: what does 86400 mean? what does "PEND" mean?
if time.Since(order.CreatedAt).Seconds() > 86400 {
    order.Status = "PEND"
}

// CORRECTION: named constants eliminate ambiguity
const OrderExpirationSeconds = 24 * 60 * 60 // 86400 — one day

type OrderStatus string
const StatusPending OrderStatus = "PENDING"

if time.Since(order.CreatedAt).Seconds() > OrderExpirationSeconds {
    order.Status = StatusPending
}
```

---

## 12. Enforcement and Compliance

- **SP-01 through SP-90** are normative rules. Violations discovered during code review MUST be documented and MUST be resolved before merge.
- Automated static analysis MUST enforce: cyclomatic complexity (SP-59), file and method length limits (SP-02, SP-03), and naming patterns (SP-04).
- An AI agent producing code MUST self-validate against this standard before emitting output. Any rule it cannot satisfy MUST be flagged to the human reviewer with an explicit justification.
- Waivers require an ADR (Architecture Decision Record) signed by a staff engineer or principal architect. No waiver is valid for SP-41, SP-42, SP-44, or SP-68.
- This standard is reviewed annually. The version number increments on any normative change.

---

*SOLID Principles & Software Craftsmanship Standard v1.0 — Enterprise Core*
