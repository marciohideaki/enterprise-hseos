# Go — Service / Module Template
## DDD-Ready — Gold Standard / State-of-the-Art

**Version:** 1.0
**Scope:** Generic / Project-agnostic
**Runtime:** Go 1.22+

> Reference structure and minimal scaffolding for a Go service.
> Complies with Go Architecture Standard, FR, and NFR.

---

## 1. Project Layout

```text
{service-name}/
  cmd/
    server/
      main.go
  internal/
    api/
      handler/
        {feature}_handler.go
      dto/
        {usecase}_request.go
        {usecase}_response.go
      middleware/
        correlation_id.go
        auth.go
      router.go
    application/
      port/
        in/
          {usecase}_usecase.go          ← interface
        out/
          {feature}_repository.go       ← interface
          {feature}_event_publisher.go  ← interface
      usecase/
        {feature}/
          {usecase}_command.go
          {usecase}_handler.go
          {usecase}_result.go
      shared/
        result/
          result.go
    domain/
      model/
        {feature}.go                    ← Aggregate root
        {feature}_id.go                 ← Value Object
      event/
        {fact_name}.go                  ← Domain Event
      service/
        {feature}_domain_service.go
    infrastructure/
      persistence/
        postgres/
          {feature}_row.go             ← SQL struct
          {feature}_repository.go      ← implements Port Out
          {feature}_mapper.go
      messaging/
        outbox/
          outbox_message.go
          outbox_dispatcher.go
        consumer/
          {event_name}_consumer.go
        producer/
          {feature}_event_publisher.go
      cache/
        {feature}_cache.go
      integration/
        client/
          {external_service}_client.go
        adapter/
          {external_service}_adapter.go
      config/
        config.go
  pkg/
    networking/                         ← Core Networking Package
  migrations/                           ← SQL migration files (goose)
  docs/
    ADR/
  go.mod
  go.sum
  .golangci.yml
  Makefile
```

---

## 2. Key Abstractions

### 2.1 Value Object

```go
// internal/domain/model/{feature}_id.go
type {Feature}ID struct {
    value string
}

func New{Feature}ID() {Feature}ID {
    return {Feature}ID{value: uuid.New().String()}
}

func {Feature}IDFrom(s string) ({Feature}ID, error) {
    if s == "" {
        return {Feature}ID{}, errors.New("{Feature}ID cannot be empty")
    }
    return {Feature}ID{value: s}, nil
}

func (id {Feature}ID) String() string { return id.value }
func (id {Feature}ID) Equals(other {Feature}ID) bool { return id.value == other.value }
```

### 2.2 Domain Event

```go
// internal/domain/event/{fact_name}.go
type {FactName} struct {
    EventID     string
    OccurredAt  time.Time
    AggregateID string
    SchemaVersion int
    // domain-specific fields
}

func (e {FactName}) EventType() string { return "{FactName}" }
```

### 2.3 Aggregate Root

```go
// internal/domain/model/{feature}.go
type {Feature} struct {
    id           {Feature}ID
    status       {Feature}Status
    domainEvents []any
    // ... other state
}

func New{Feature}(id {Feature}ID, /* params */) (*{Feature}, error) {
    // validate invariants
    f := &{Feature}{id: id, status: Status{Feature}Active}
    f.domainEvents = append(f.domainEvents, {FactName}{
        EventID:     uuid.New().String(),
        OccurredAt:  time.Now().UTC(),
        AggregateID: id.String(),
        SchemaVersion: 1,
    })
    return f, nil
}

func (f *{Feature}) PullDomainEvents() []any {
    events := make([]any, len(f.domainEvents))
    copy(events, f.domainEvents)
    f.domainEvents = nil
    return events
}

// Behavior methods only — no exported setters
```

### 2.4 Port In / Use Case Interface

```go
// internal/application/port/in/{usecase}_usecase.go
type {UseCase}UseCase interface {
    Execute(ctx context.Context, cmd {UseCase}Command) Result[{UseCase}Result]
}
```

### 2.5 Use Case Handler

```go
// internal/application/usecase/{feature}/{usecase}_handler.go
type {UseCase}Handler struct {
    repo      port.{Feature}Repository
    publisher port.{Feature}EventPublisher
}

func New{UseCase}Handler(repo port.{Feature}Repository, pub port.{Feature}EventPublisher) *{UseCase}Handler {
    return &{UseCase}Handler{repo: repo, publisher: pub}
}

func (h *{UseCase}Handler) Execute(ctx context.Context, cmd {UseCase}Command) Result[{UseCase}Result] {
    // 1. Validate
    // 2. Load/create aggregate
    // 3. Enforce invariants
    // 4. Persist via port
    // 5. Publish events via port
    // 6. Return result
    return OK({UseCase}Result{/* ... */})
}
```

### 2.6 Result Type

```go
// internal/application/shared/result/result.go
type Result[T any] struct {
    Value T
    Err   *AppError
}

type AppError struct {
    Code    string
    Message string
}

func OK[T any](v T) Result[T]          { return Result[T]{Value: v} }
func Fail[T any](e AppError) Result[T] { return Result[T]{Err: &e} }
func (r Result[T]) IsSuccess() bool    { return r.Err == nil }
```

---

## 3. API Conventions

```go
// internal/api/handler/{feature}_handler.go
type {Feature}Handler struct {
    useCase port.{UseCase}UseCase
}

func (h *{Feature}Handler) Create(w http.ResponseWriter, r *http.Request) {
    var req dto.{UseCase}Request
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeError(w, http.StatusBadRequest, "INVALID_BODY", err.Error())
        return
    }

    result := h.useCase.Execute(r.Context(), application.{UseCase}Command{
        // map from req
    })

    if !result.IsSuccess() {
        writeError(w, http.StatusUnprocessableEntity, result.Err.Code, result.Err.Message)
        return
    }

    w.WriteHeader(http.StatusCreated)
    json.NewEncoder(w).Encode(dto.{UseCase}Response{/* ... */})
}
```

---

## 4. Testing Template

### Domain Tests (pure unit)
```go
func TestNew{Feature}_RejectsInvalidInput(t *testing.T) {
    _, err := New{Feature}({Feature}ID{}, /* invalid */)
    require.Error(t, err)
}
```

### Application Tests (mocked ports)
```go
func Test{UseCase}Handler_ReturnsSuccess(t *testing.T) {
    repo := mocks.New{Feature}Repository(t)
    repo.On("Save", mock.Anything, mock.Anything).Return(result.OK(id))
    handler := New{UseCase}Handler(repo, mockPub)
    res := handler.Execute(ctx, validCmd)
    assert.True(t, res.IsSuccess())
}
```

### Infrastructure Tests (testcontainers-go)
```go
func Test{Feature}Repository_PersistsAndRetrieves(t *testing.T) {
    ctx := context.Background()
    pg, _ := testcontainers.RunContainer(ctx, "postgres:16")
    // ... setup, migrate, test
}
```

---

## 5. Mandatory CI Gates

- Build passes (`go build ./...`)
- Unit tests pass (`go test ./...`)
- Integration tests pass (with Testcontainers)
- `golangci-lint` passes
- `govulncheck` passes
- Architecture checks pass
