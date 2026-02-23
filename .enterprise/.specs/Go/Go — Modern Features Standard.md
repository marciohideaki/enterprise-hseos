# Go — Modern Features Standard

**Version:** 1.0
**Status:** Canonical / Normative
**Scope:** Go 1.21+ modern features — adoption guidance and mandatory patterns

> Defines when and how to adopt modern Go language features introduced in Go 1.18–1.24.
> Supplements the Go Architecture Standard and Go Idiomatic Guide.

---

## 1. Generics (Go 1.18+)

- MF-GO-01: Generics are appropriate for **type-safe collections**, **algorithms operating on multiple concrete types**, and **generic repository/store abstractions**. They are not a general replacement for interfaces.
- MF-GO-02: Use generics for `Result[T]` / `Option[T]` types that carry typed values through error-prone pipelines without panicking.
- MF-GO-03: Use `comparable` constraint when the type parameter must support `==` or `!=` (e.g., map keys, ID types). Use `any` only when no constraint applies.
- MF-GO-04: Prefer constraints from `golang.org/x/exp/constraints` (`Integer`, `Float`, `Ordered`) for numeric algorithms. Define local constraints only when stdlib and `x/exp` are insufficient.
- MF-GO-05: **Type inference is mandatory** — do not specify type parameters explicitly when the compiler can infer them from arguments. `Map(items, fn)` not `Map[Item, Result](items, fn)`.
- MF-GO-06: Generics must **not** replace interfaces for behavioral polymorphism. Rule: if the abstraction is about **what a type can do**, use an interface. If it is about **operating on any concrete type uniformly**, use a generic.
- MF-GO-07: Generic functions with more than two type parameters are a design smell — refactor or split.
- MF-GO-08: The `Result[T any]` pattern is mandatory for domain and application layer functions that return both a value and an error with rich context.
- MF-GO-09: Generic repository pattern `Repository[T Entity, ID comparable]` is the canonical abstraction for infrastructure adapters.
- MF-GO-10: Do not use generics purely for syntactic sugar over trivial type assertions. If `interface{}` plus a type switch is clearer and the performance difference is irrelevant, prefer it.

```go
// Result[T] — typed error wrapper (MF-GO-08)
type Result[T any] struct {
    value T
    err   error
}

func Ok[T any](v T) Result[T]    { return Result[T]{value: v} }
func Err[T any](e error) Result[T] { return Result[T]{err: e} }

func (r Result[T]) Unwrap() (T, error) { return r.value, r.err }
func (r Result[T]) IsOk() bool         { return r.err == nil }
```

```go
// Generic Repository interface (MF-GO-09)
type Repository[T any, ID comparable] interface {
    FindByID(ctx context.Context, id ID) (T, error)
    Save(ctx context.Context, entity T) error
    Delete(ctx context.Context, id ID) error
}

// Type inference — no explicit type params needed (MF-GO-05)
func Map[In, Out any](items []In, fn func(In) Out) []Out {
    out := make([]Out, len(items))
    for i, v := range items { out[i] = fn(v) }
    return out
}
```

```go
// Correct: generics for uniform algorithm (MF-GO-06)
func Contains[T comparable](slice []T, item T) bool {
    for _, v := range slice {
        if v == item { return true }
    }
    return false
}

// Correct: interface for behavioral polymorphism (MF-GO-06)
type Validator interface {
    Validate() error
}
func ValidateAll(items []Validator) error {
    for _, v := range items {
        if err := v.Validate(); err != nil { return err }
    }
    return nil
}
```

---

## 2. embed Directive (MF-GO-11 a MF-GO-16)

- MF-GO-11: Use `//go:embed` to include static assets in the compiled binary. Never rely on filesystem paths for templates, migrations, or default configs in production.
- MF-GO-12: Use `embed.FS` for directories or multiple files. Use `string` or `[]byte` typed variables only for single, well-known files.
- MF-GO-13: SQL migration files **must** be embedded via `embed.FS`. Depending on the presence of a migrations directory at runtime is forbidden.
- MF-GO-14: Email and notification templates **must** be embedded. Template loading at startup via `embed.FS` is the only acceptable pattern.
- MF-GO-15: Static TLS certificates and default configuration files bundled with a service must be embedded — never read from a filesystem path without an explicit override flag.
- MF-GO-16: Tests covering `embed.FS` usage must use the real embedded filesystem — do not mock `embed.FS`. Use `fs.ReadFile(myFS, path)` to read entries in tests.

```go
// Embedding SQL migrations (MF-GO-13)
import "embed"

//go:embed migrations/*.sql
var migrationsFS embed.FS

func RunMigrations(db *sql.DB) error {
    driver, err := postgres.WithInstance(db, &postgres.Config{})
    if err != nil { return fmt.Errorf("migrations driver: %w", err) }
    src, err := iofs.New(migrationsFS, "migrations")
    if err != nil { return fmt.Errorf("migrations source: %w", err) }
    m, err := migrate.NewWithInstance("iofs", src, "postgres", driver)
    if err != nil { return fmt.Errorf("migrate instance: %w", err) }
    if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
        return fmt.Errorf("migrate up: %w", err)
    }
    return nil
}
```

```go
// Email template embedding and rendering (MF-GO-14)
//go:embed templates/email/*.html
var emailTemplatesFS embed.FS

func LoadTemplates() (*template.Template, error) {
    return template.ParseFS(emailTemplatesFS, "templates/email/*.html")
}
```

```go
// Single-file embed for default config (MF-GO-12)
//go:embed config/defaults.yaml
var defaultConfig []byte

func LoadConfig(override string) (*Config, error) {
    base := defaultConfig
    if override != "" {
        var err error
        base, err = os.ReadFile(override)
        if err != nil { return nil, fmt.Errorf("loadConfig: %w", err) }
    }
    var cfg Config
    return &cfg, yaml.Unmarshal(base, &cfg)
}
```

---

## 3. Workspace Mode (go.work) (MF-GO-17 a MF-GO-22)

- MF-GO-17: `go.work` is the tool for **local multi-module development** inside a monorepo. It enables simultaneous editing of a library module and a consuming service without publishing the library.
- MF-GO-18: `go.work` **must not** be committed in single-service repositories. It is a developer convenience artifact, not a build definition.
- MF-GO-19: In monorepos where multiple Go modules are co-developed, `go.work` **must** be committed. `go.work.sum` must also be committed alongside it.
- MF-GO-20: CI pipelines must set `GOWORK=off` to guarantee that builds use the published module versions from `go.sum`, not local workspace overrides.
- MF-GO-21: `replace` directives in `go.mod` are for **permanent, committed overrides** (e.g., forked dependencies). `go.work` is for **ephemeral, local development** overrides. Do not use `replace` to solve problems that belong in a workspace.
- MF-GO-22: Running `go work init && go work use ./service-a ./lib-b` bootstraps a workspace. Document this in the monorepo `DEVELOPMENT.md`.

```bash
# Initialize workspace for local multi-module development (MF-GO-17)
go work init
go work use ./api-gateway
go work use ./pkg/auth
go work use ./pkg/events
```

```text
# go.work — committed only in monorepos (MF-GO-19)
go 1.22

use (
    ./api-gateway
    ./pkg/auth
    ./pkg/events
)
```

```yaml
# CI: disable workspace for reproducible builds (MF-GO-20)
# .github/workflows/ci.yml
env:
  GOWORK: "off"
steps:
  - name: Test
    run: go test ./...
  - name: Build
    run: go build -ldflags="-s -w" ./cmd/server
```

---

## 4. Iterators (Go 1.23+)

- MF-GO-23: Use `iter.Seq[V]` for single-value sequences and `iter.Seq2[K, V]` for key-value sequences. These are the canonical iterator types — do not define custom iterator function signatures.
- MF-GO-24: Iterators using `range` over functions are the preferred pattern for **lazy sequences**: database cursors, file line readers, paginated API responses, and streaming results.
- MF-GO-25: Channel-based iteration (`for v := range ch`) is permitted for producer-consumer concurrency. For pure iteration without concurrency, `iter.Seq` is mandatory — it avoids goroutine leaks and scheduling overhead.
- MF-GO-26: Use `slices.Collect`, `maps.Keys`, `maps.Values`, and `slices.Sorted` from the standard library to compose iterators with stdlib functions.
- MF-GO-27: Iterator functions must be **pure in yield semantics**: each call to the iterator must independently produce the full sequence. Stateful iterators that cannot be restarted must be documented explicitly.
- MF-GO-28: A database cursor exposed as `iter.Seq2[Row, error]` is the canonical pattern for streaming query results without loading all rows into memory.

```go
// Database cursor as lazy iterator (MF-GO-28)
func QueryRows(ctx context.Context, db *sql.DB, q string) iter.Seq2[*sql.Row, error] {
    return func(yield func(*sql.Row, error) bool) {
        rows, err := db.QueryContext(ctx, q)
        if err != nil { yield(nil, err); return }
        defer rows.Close()
        for rows.Next() {
            if !yield(rows.Scan, nil) { return }
        }
        if err := rows.Err(); err != nil { yield(nil, err) }
    }
}
```

```go
// Paginated API results as lazy sequence (MF-GO-24)
func FetchAllPages(client *APIClient, resource string) iter.Seq2[Item, error] {
    return func(yield func(Item, error) bool) {
        cursor := ""
        for {
            page, next, err := client.List(resource, cursor)
            if err != nil { yield(Item{}, err); return }
            for _, item := range page {
                if !yield(item, nil) { return }
            }
            if next == "" { return }
            cursor = next
        }
    }
}
```

```go
// File line reader using iter.Seq (MF-GO-23, MF-GO-25)
func Lines(r io.Reader) iter.Seq[string] {
    return func(yield func(string) bool) {
        sc := bufio.NewScanner(r)
        for sc.Scan() {
            if !yield(sc.Text()) { return }
        }
    }
}

// Consumer: range over function iterator
for line := range Lines(file) {
    process(line)
}
```

---

## 5. slog — Structured Logging (Go 1.21+)

- MF-GO-29: `log/slog` is the **mandatory** structured logging package for all new services. Migration from `log`, `logrus`, or `zap` is required for any service undergoing a major refactor.
- MF-GO-30: The default logger (`slog.Default()`) must be configured at service bootstrap with a JSON handler for production and a text handler for local development. Raw `log.Printf` calls are forbidden in application code.
- MF-GO-31: Log levels are restricted to `Debug`, `Info`, `Warn`, and `Error`. Custom level integers are forbidden. Use `slog.LevelDebug` through `slog.LevelError` only.
- MF-GO-32: Structured attributes must use typed constructors: `slog.String`, `slog.Int`, `slog.Bool`, `slog.Duration`, `slog.Any`. Bare `interface{}` key-value pairs (`"key", value`) are permitted only in temporary debugging code.
- MF-GO-33: Context-aware logging via `slog.InfoContext(ctx, ...)` is mandatory in request-scoped code. A custom handler must extract `traceId` and `spanId` from the context and inject them as top-level log attributes.
- MF-GO-34: A PII-masking `slog.Handler` wrapper must be applied to any handler receiving logs from user-facing services. Attributes tagged with a sentinel key prefix (e.g., `pii:email`) must be redacted before emission.

```go
// Bootstrap: JSON handler for production (MF-GO-30)
func SetupLogger(env string) {
    var h slog.Handler
    opts := &slog.HandlerOptions{Level: slog.LevelInfo}
    if env == "production" {
        h = slog.NewJSONHandler(os.Stdout, opts)
    } else {
        h = slog.NewTextHandler(os.Stdout, opts)
    }
    slog.SetDefault(slog.New(h))
}
```

```go
// Context-aware traceId extraction handler (MF-GO-33)
type TraceHandler struct{ slog.Handler }

func (h TraceHandler) Handle(ctx context.Context, r slog.Record) error {
    if tid, ok := ctx.Value(traceIDKey{}).(string); ok {
        r.AddAttrs(slog.String("traceId", tid))
    }
    return h.Handler.Handle(ctx, r)
}

// Usage in request handler
slog.InfoContext(ctx, "order placed",
    slog.String("orderId", order.ID),
    slog.Int("itemCount", len(order.Items)),
)
```

```go
// PII-masking handler wrapper (MF-GO-34)
type PIIHandler struct{ slog.Handler }

const piiPrefix = "pii:"

func (h PIIHandler) Handle(ctx context.Context, r slog.Record) error {
    masked := slog.NewRecord(r.Time, r.Level, r.Message, r.PC)
    r.Attrs(func(a slog.Attr) bool {
        if strings.HasPrefix(a.Key, piiPrefix) {
            masked.AddAttrs(slog.String(a.Key, "[REDACTED]"))
        } else {
            masked.AddAttrs(a)
        }
        return true
    })
    return h.Handler.Handle(ctx, masked)
}
```

---

## 6. Testing Avancado (Go 1.21+)

- MF-GO-35: `testing/slogtest` must be used to validate any custom `slog.Handler` implementation. The `slogtest.TestHandler` function verifies spec compliance automatically.
- MF-GO-36: `go test -shuffle=on` is **mandatory in CI**. Tests that pass only in declaration order are defective. The shuffle seed must be logged (`-v` output) to reproduce failures.
- MF-GO-37: Benchmarks must use `testing.B.Loop()` (Go 1.24) instead of the `for i := 0; i < b.N; i++` pattern. `b.Loop()` handles timer resets and alloc counting correctly without manual `b.ResetTimer()` calls.
- MF-GO-38: `t.Setenv(key, value)` is mandatory for setting environment variables in tests. Direct `os.Setenv` calls in tests are forbidden — they leak state across parallel tests.
- MF-GO-39: `t.TempDir()` is mandatory for tests that require filesystem access. The returned directory is automatically removed after the test. `os.MkdirTemp` in tests is forbidden.
- MF-GO-40: Fuzz tests (`func FuzzXxx(f *testing.F)`) are **mandatory** for all parser, deserializer, and input validation functions. A seed corpus covering at least the happy path and one malformed input must be provided via `f.Add(...)`.

```go
// Custom slog handler validation (MF-GO-35)
func TestPIIHandler(t *testing.T) {
    var buf bytes.Buffer
    base := slog.NewJSONHandler(&buf, nil)
    h := PIIHandler{Handler: base}
    if err := slogtest.TestHandler(h, func() []map[string]any {
        var entries []map[string]any
        for _, line := range bytes.Split(buf.Bytes(), []byte("\n")) {
            if len(line) == 0 { continue }
            var e map[string]any
            if err := json.Unmarshal(line, &e); err == nil {
                entries = append(entries, e)
            }
        }
        return entries
    }); err != nil {
        t.Fatal(err)
    }
}
```

```go
// Benchmark using b.Loop() (MF-GO-37)
func BenchmarkContains_LargeSlice(b *testing.B) {
    data := make([]int, 10_000)
    for i := range data { data[i] = i }
    target := 9_999
    for b.Loop() {
        Contains(data, target)
    }
}
```

```go
// t.Setenv and t.TempDir — safe test helpers (MF-GO-38, MF-GO-39)
func TestLoadConfig_UsesOverride(t *testing.T) {
    dir := t.TempDir()
    cfgPath := filepath.Join(dir, "config.yaml")
    os.WriteFile(cfgPath, []byte("timeout: 30s\n"), 0600)
    t.Setenv("CONFIG_PATH", cfgPath)

    cfg, err := LoadConfig(os.Getenv("CONFIG_PATH"))
    if err != nil { t.Fatalf("unexpected error: %v", err) }
    if cfg.Timeout != 30*time.Second {
        t.Errorf("got %v, want 30s", cfg.Timeout)
    }
}
```

```go
// Fuzz test for a JSON command parser (MF-GO-40)
func FuzzParseCommand(f *testing.F) {
    f.Add(`{"action":"create","name":"order"}`)  // happy path seed
    f.Add(`{invalid`)                             // malformed seed
    f.Fuzz(func(t *testing.T, data string) {
        cmd, err := ParseCommand([]byte(data))
        if err != nil { return } // parse errors are acceptable
        // If parsing succeeded, the result must be valid
        if err := cmd.Validate(); err != nil {
            t.Errorf("ParseCommand returned invalid command: %v", err)
        }
    })
}
```

---

## Cross-References

| Topic | Related Standard |
|---|---|
| Architecture layers | Go — Architecture Standard |
| Interface design | Go — Idiomatic Guide (IG-05 to IG-10) |
| Error handling | Go — Idiomatic Guide (IG-11 to IG-20) |
| Module and build toolchain | Go — Build & Toolchain Standard (BT-05, BT-06) |
| Test conventions and naming | Go — Testing Standard (TS-01 to TS-10) |
