---
inclusion: fileMatch
fileMatchPattern: "**/*.go"
description: Go idioms and standards — auto-loaded when editing Go files
---

# Go Patterns — Auto-Loaded for *.go Files

> Loaded automatically when editing Go source files.
> For full Go standard: `.enterprise/.specs/Go/_INDEX.md`

## Naming Conventions (Go)
- Exported identifiers: `PascalCase`
- Unexported identifiers: `camelCase`
- Interfaces with one method: add `-er` suffix (`Reader`, `Writer`, `Stringer`)
- Error variables: `var ErrXxx = errors.New(...)`
- Test files: `_test.go` suffix

## Error Handling
```go
// CORRECT: always check and wrap
result, err := doSomething()
if err != nil {
    return fmt.Errorf("context: %w", err)
}

// WRONG: ignoring errors
result, _ := doSomething()
```

## Immutability Preference
```go
// Prefer returning new values
func withStatus(u User, status string) User {
    return User{ID: u.ID, Name: u.Name, Status: status}
}

// Avoid mutating parameters
func setStatus(u *User, status string) { // only if truly necessary
    u.Status = status
}
```

## Context Propagation
- Always accept `ctx context.Context` as first parameter in I/O functions
- Never store context in structs
- Cancel contexts when done

## Testing
- Table-driven tests for multiple cases
- Use `testify/assert` or stdlib `t.Fatal`/`t.Error`
- Test file naming: `foo_test.go` for package `foo`
- Benchmark with `Benchmark*` prefix

## Load Full Go Standard When
- Designing a new service package structure
- Implementing complex concurrency patterns
- Setting up build toolchain or linting
