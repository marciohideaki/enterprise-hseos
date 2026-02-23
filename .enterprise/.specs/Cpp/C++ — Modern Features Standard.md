# C++ — Modern Features Standard
**Version:** 1.0
**Status:** Canonical / Normative
**Scope:** C++20/23 modern features — adoption guidance and mandatory patterns

> Defines mandatory adoption rules, usage patterns, and anti-patterns for C++20 and C++23 modern language features.
> Supplements the C++ Architecture Standard and C++ Idiomatic Guide.

---

## 1. Modules (C++20)

### Rules

- MF-CPP-01: C++ Modules are the mechanism that replaces `#include` for compilation units that opt in. A **module interface unit** declares what it exports; consumers use `import mylib;` instead of `#include "mylib.h"`.
- MF-CPP-02: **Benefits over headers:** no macro leakage across translation boundaries, no include-order sensitivity, dramatically shorter incremental build times (compiler stores a Binary Module Interface — BMI).
- MF-CPP-03: A module interface unit begins with `export module <name>;`. Implementation may be split into a **module implementation unit** that begins with `module <name>;` (no `export`).
- MF-CPP-04: Legacy headers that cannot be immediately ported MUST be placed in the **global module fragment** — the section before the `module` declaration delimited by `module;`. This confines macro effects to that fragment.
- MF-CPP-05: Minimum compiler versions required to consume or produce named modules: GCC 11+ (`-fmodules-ts`, stable in GCC 14), Clang 14+ (`-fmodules`), MSVC 19.28+ (`/experimental:module`, production-ready in VS 2022 17.5+). Confirm support in the project ADR before enabling.
- MF-CPP-06: CMake 3.28+ is required for first-class module support. Register module sources with `FILE_SET CXX_MODULES` — do not use `target_sources` with plain `.cpp` for module interface units.
- MF-CPP-07: **Rule — new code:** All new library and application modules MUST be written as named C++ Modules, not as header-only or header+source pairs.
- MF-CPP-08: **Rule — legacy code:** Existing headers and translation units MUST NOT be forcibly migrated to modules en masse. Migrate incrementally when a subsystem is refactored. Migration must be tracked in an ADR.
- MF-CPP-09: A module MUST NOT re-export names from the global module fragment. Only explicitly `export`-ed declarations are visible to importers.
- MF-CPP-10: `export import <other_module>;` is permitted to re-export an entire dependency — use sparingly; it creates transitive coupling that defeats the isolation benefit of modules.

### Example — Module Interface and Consumer

```cpp
// === file: geometry.cppm (module interface unit) ===
export module geometry;

export struct Point { double x, y; };

export double distance(Point a, Point b) {
    return std::sqrt((b.x - a.x) * (b.x - a.x) +
                     (b.y - a.y) * (b.y - a.y));
}
```

```cpp
// === file: main.cpp ===
import geometry;
import <iostream>;   // header unit import (C++20)

int main() {
    Point p1{0.0, 0.0}, p2{3.0, 4.0};
    std::cout << distance(p1, p2) << '\n';  // prints 5
}
```

```cmake
# === CMakeLists.txt (CMake 3.28+) ===
target_sources(geometry
    PUBLIC FILE_SET CXX_MODULES FILES geometry.cppm
)
```

### Example — Global Module Fragment for Legacy Compatibility

```cpp
// === file: legacy_wrapper.cppm ===
module;                   // global module fragment begins
#include <cstring>        // legacy header: macros stay here
#include "old_c_api.h"    // C API with macros, safe here

export module legacy_wrapper;

export void safe_copy(char* dst, const char* src, std::size_t n) {
    std::strncpy(dst, src, n);
    dst[n - 1] = '\0';
}
```

---

## 2. Coroutines (C++20)

### Rules

- MF-CPP-11: A **coroutine** is a function that can be suspended (`co_await`, `co_yield`) and resumed later. The compiler transforms coroutine bodies into a state machine allocated on the heap (the **coroutine frame**).
- MF-CPP-12: The three coroutine keywords are:
  - `co_await expr` — suspend until `expr` completes.
  - `co_yield value` — produce a value and suspend (generators).
  - `co_return value` — return a final value and destroy the frame.
- MF-CPP-13: **Coroutine types:** (a) *Async task* — represents an in-flight async operation; (b) *Generator* — lazy sequence that yields values on demand; (c) *Async generator* — combines both.
- MF-CPP-14: **Rule — do not implement coroutine machinery from scratch.** The promise type, awaitable, and coroutine handle plumbing is subtle and error-prone. Approved frameworks: **Asio coroutines** (`asio::awaitable<T>`), **cppcoro** (for generators and when not using Asio), **libunifex** (for structured concurrency). Document framework choice in ADR.
- MF-CPP-15: Use coroutines for: (a) non-blocking I/O (network, disk), (b) lazy/infinite sequences, (c) streaming pipelines over large data, (d) composing multiple async operations without callback nesting.
- MF-CPP-16: Do NOT use coroutines for: (a) simple synchronous code — the abstraction overhead is not justified; (b) hot-path tight loops — coroutine frame allocation adds latency; (c) code that must be compiled with compilers that lack stable coroutine support (see MF-CPP-05).
- MF-CPP-17: `std::generator<T>` (C++23, `<generator>`) is the standard lazy generator type. Use it for pure pull-based sequences without async. Prefer over hand-rolled generators.
- MF-CPP-18: Every coroutine that owns resources MUST ensure destruction via RAII inside the coroutine body. Do NOT rely on callers to cancel/destroy the coroutine to release resources.
- MF-CPP-19: Structured concurrency: coroutines MUST be tied to a scope or executor that guarantees completion before the owning scope exits. Detached fire-and-forget coroutines are PROHIBITED unless explicitly approved in ADR.
- MF-CPP-20: Coroutine return types MUST be declared in function signatures. Implicit deduction from `co_await` inside a function body is NOT a substitute for a clear `asio::awaitable<T>` or `std::generator<T>` return type.

### Example — Async HTTP Request with Asio Coroutines

```cpp
#include <asio.hpp>
#include <asio/awaitable.hpp>
#include <asio/use_awaitable.hpp>
#include <string>

asio::awaitable<std::string> fetch_url(asio::ip::tcp::socket socket,
                                       std::string_view host) {
    asio::streambuf response;
    std::string request = "GET / HTTP/1.0\r\nHost: " + std::string(host) +
                          "\r\nConnection: close\r\n\r\n";

    co_await asio::async_write(socket, asio::buffer(request),
                               asio::use_awaitable);
    co_await asio::async_read_until(socket, response, "\r\n\r\n",
                                    asio::use_awaitable);

    std::istream stream(&response);
    std::string body(std::istreambuf_iterator<char>(stream), {});
    co_return body;
}
```

### Example — Lazy Sequence Generator (C++23)

```cpp
#include <generator>
#include <cstdint>

std::generator<std::uint64_t> fibonacci() {
    std::uint64_t a = 0, b = 1;
    while (true) {
        co_yield a;
        auto next = a + b;
        a = b;
        b = next;
    }
}

// Usage
void print_first_ten() {
    for (auto v : fibonacci() | std::views::take(10)) {
        std::cout << v << ' ';
    }
}
```

---

## 3. Ranges (C++20)

### Rules

- MF-CPP-21: The `std::ranges` namespace provides algorithm overloads that accept range objects directly — no need to pass `begin(c)` / `end(c)` iterator pairs explicitly. Use these overloads in all new code.
- MF-CPP-22: **Views** (`std::views::*`) are lazy adaptors that represent a transformation without materializing a new container. Composing views with `|` is the preferred way to express data pipelines.
- MF-CPP-23: Mandatory lazy views and their usage:
  - `std::views::filter(pred)` — retain elements satisfying a predicate.
  - `std::views::transform(func)` — apply a function element-wise.
  - `std::views::take(n)` / `std::views::drop(n)` — limit or skip elements.
  - `std::views::keys` / `std::views::values` — decompose map-like ranges.
  - `std::views::zip` (C++23) — pair elements from two ranges.
- MF-CPP-24: **Rule:** Prefer `std::ranges::*` algorithm variants over `std::*` classical iterator algorithms in all new code.
- MF-CPP-25: **Sentinel types:** Open-ended ranges (e.g., null-terminated strings, network streams) use sentinel types distinct from iterator types. Implement `operator==` between iterator and sentinel to mark end-of-range without computing the full size.
- MF-CPP-26: `std::ranges::to<Container>(range)` (C++23) is the idiomatic way to materialize a view into a `std::vector`, `std::set`, etc. — replaces `std::vector(view.begin(), view.end())`.
- MF-CPP-27: **Performance rule:** Views are lazy — avoid re-traversing the same view multiple times. If a view's result is needed more than once, materialize it once with `std::ranges::to` or assign to a named container.
- MF-CPP-28: **Anti-pattern:** Do NOT use `std::views::transform` in a hot path if the transform function allocates heap memory (e.g., constructs `std::string`). In performance-critical loops, use a classical indexed loop or pre-allocated buffer with a range algorithm.

### Example — Ranges Pipeline

```cpp
#include <ranges>
#include <vector>
#include <string>

struct Product { std::string name; double price; bool active; };

std::vector<std::string> active_names_under_100(
    const std::vector<Product>& products)
{
    return products
        | std::views::filter([](const Product& p) {
            return p.active && p.price < 100.0; })
        | std::views::transform([](const Product& p) { return p.name; })
        | std::ranges::to<std::vector<std::string>>();
}
```

### Example — std::ranges Algorithms

```cpp
#include <ranges>
#include <algorithm>
#include <vector>

void ranges_examples(std::vector<int>& data) {
    std::ranges::sort(data);                         // no begin/end needed

    auto it = std::ranges::find_if(data, [](int x) { return x > 42; });
    if (it != data.end()) { /* found */ }

    std::vector<int> evens;
    std::ranges::copy_if(data, std::back_inserter(evens),
                         [](int x) { return x % 2 == 0; });
}
```

---

## 4. Concepts (C++20)

### Rules

- MF-CPP-29: **Concepts** are named boolean predicates on template parameters evaluated at compile time. They replace ad hoc SFINAE (`std::enable_if`, `void_t` tricks) with readable, composable constraints.
- MF-CPP-30: Use standard library concepts from `<concepts>` and `<iterator>` before defining custom ones:
  - `std::integral`, `std::floating_point`, `std::signed_integral`, `std::unsigned_integral`
  - `std::same_as<T, U>`, `std::convertible_to<From, To>`, `std::derived_from<D, B>`
  - `std::invocable<F, Args...>`, `std::predicate<F, Args...>`
  - `std::ranges::range<R>`, `std::ranges::sized_range<R>`, `std::ranges::contiguous_range<R>`
- MF-CPP-31: Define a custom concept with a `requires` expression when standard concepts do not capture the semantic requirement. Name concepts in `PascalCase` by convention matching the standard library.

```cpp
template<typename T>
concept Serializable = requires(const T& t) {
    { t.serialize() } -> std::same_as<std::string>;
    { T::deserialize(std::string{}) } -> std::same_as<T>;
};
```

- MF-CPP-32: **`requires` clause vs. `requires` expression:** A `requires` clause introduces a constraint on a template (`template<typename T> requires Foo<T>`). A `requires` expression checks structural validity inline and evaluates to `bool`. They may be nested.
- MF-CPP-33: Abbreviated function templates with concepts provide the most concise syntax for constrained generics:

```cpp
// Abbreviated: clearest for simple constraints
auto sum(std::integral auto a, std::integral auto b) { return a + b; }

// Explicit: clearer when multiple parameters must be the same type
template<std::integral T>
T sum(T a, T b) { return a + b; }
```

- MF-CPP-34: **Rule:** Every template with a semantic constraint MUST express that constraint as a Concept. SFINAE via `std::enable_if` or `void_t` is PROHIBITED in new code.
- MF-CPP-35: **Concept subsumption:** When two overloads differ only in that one concept subsumes (implies) the other, the more specific (subsumptive) overload wins in overload resolution. Design concept hierarchies to leverage this — it replaces tag dispatch patterns.
- MF-CPP-36: Concepts MUST document their semantic intent in a comment when the structural check alone does not make the intent obvious (e.g., `// T must represent a unit-of-work that can be submitted to a thread pool`).

### Example — Domain Concept with Serialization Constraint

```cpp
#include <concepts>
#include <string>

template<typename T>
concept DomainEntity = requires(const T& t, std::string_view data) {
    { t.id() }           -> std::convertible_to<std::string>;
    { t.serialize() }    -> std::same_as<std::string>;
    { T::deserialize(data) } -> std::same_as<T>;
    requires std::copyable<T>;
};

// Use in a repository interface
template<DomainEntity E>
class Repository {
public:
    virtual void save(const E& entity) = 0;
    virtual E    find_by_id(std::string_view id) = 0;
    virtual ~Repository() = default;
};
```

---

## 5. std::expected (C++23)

### Rules

- MF-CPP-37: `std::expected<T, E>` (`<expected>`) represents a function result that is either a value of type `T` or an error of type `E`. It models recoverable, expected failure — not exceptional, unrecoverable failure.
- MF-CPP-38: Primary accessors:
  - `.has_value()` — check success.
  - `.value()` — return value; throws `std::bad_expected_access<E>` if error (avoid in no-exception contexts, use `.value_or()` or check first).
  - `.error()` — return error; undefined behaviour if called on a success.
  - `.value_or(default)` — return value or a fallback without throwing.
- MF-CPP-39: **Monadic chaining** enables pipeline-style error propagation without explicit `if` checks:
  - `.and_then(func)` — apply `func` to the value if present, returning a new `expected`; propagate error otherwise.
  - `.or_else(func)` — apply `func` to the error if present; useful for recovery.
  - `.transform(func)` — apply `func` to the value and re-wrap; equivalent to `map` on the success channel.
- MF-CPP-40: **Rule:** Functions that can fail for **predictable, domain-level reasons** (invalid input, resource not found, parse error, quota exceeded) MUST return `std::expected<T, ErrorType>` — not throw an exception. This applies to all code paths that may run in hot paths or on embedded/no-exception targets.
- MF-CPP-41: **Rule:** C++ exceptions are reserved for **unrecoverable errors** (out of memory, programmer errors that indicate invariant violation, third-party library exceptions that cannot be suppressed). Exceptions MUST NOT be used for ordinary control flow.
- MF-CPP-42: Error types `E` SHOULD be strongly-typed enumerations or small structs — not raw `int` or `std::string`. Define one `ErrorCode` enum per domain module.

### Example — Domain Parser with Monadic Chaining

```cpp
#include <expected>
#include <string_view>
#include <charconv>

enum class ParseError { empty_input, invalid_number, out_of_range };

std::expected<int, ParseError> parse_port(std::string_view input) {
    if (input.empty()) return std::unexpected(ParseError::empty_input);
    int value{};
    auto [ptr, ec] = std::from_chars(input.begin(), input.end(), value);
    if (ec == std::errc::invalid_argument)
        return std::unexpected(ParseError::invalid_number);
    if (ec == std::errc::result_out_of_range || value < 1 || value > 65535)
        return std::unexpected(ParseError::out_of_range);
    return value;
}

// Monadic pipeline: parse port, then map to a formatted string
std::expected<std::string, ParseError> port_label(std::string_view input) {
    return parse_port(input)
        .transform([](int p) { return std::format("port:{}", p); });
}
```

---

## 6. std::format and Print (C++20/23)

### Rules

- MF-CPP-43: `std::format` (`<format>`, C++20) is the mandatory string formatting facility. It replaces `sprintf`, `snprintf`, `ostringstream`, and manual string concatenation for all new code. The format string is checked at compile time when a string literal is passed directly.
- MF-CPP-44: `std::print` and `std::println` (`<print>`, C++23) write formatted output directly to a `FILE*` or `std::ostream` without constructing an intermediate `std::string`. Use them for logging and debug output.
- MF-CPP-45: Format specifiers follow the Python format mini-language:
  - `{:>10}` — right-align in a field of width 10.
  - `{:<10}` — left-align.
  - `{:.2f}` — floating point with 2 decimal places.
  - `{:08x}` — hex, zero-padded to 8 digits.
  - `{:#010x}` — hex with `0x` prefix, total width 10.
  - `{:+}` — always show sign.
- MF-CPP-46: **Rule:** `sprintf` and `ostringstream` used for string formatting are PROHIBITED in new code. Existing usages MUST be migrated when the surrounding code is refactored. Provide a custom `std::formatter` specialization for domain types that appear in log output.

### Example — std::format and Custom Formatter

```cpp
#include <format>
#include <print>
#include <string>

struct OrderId { std::uint64_t value; };

// Custom formatter for domain type
template<>
struct std::formatter<OrderId> {
    constexpr auto parse(std::format_parse_context& ctx) { return ctx.begin(); }
    auto format(const OrderId& id, std::format_context& ctx) const {
        return std::format_to(ctx.out(), "ORDER-{:010}", id.value);
    }
};

void log_order(OrderId id, double total, std::string_view currency) {
    std::println("Processed {}: {:>12.2f} {}", id, total, currency);
    // Printed: Processed ORDER-0000000042:        99.90 USD
}
```

---

## 7. Deducing this / Explicit Object Parameter (C++23)

### Rules

- MF-CPP-47: C++23 introduces the **explicit object parameter** (informally "deducing `this`"): a member function's implicit `*this` can be declared as an explicit first parameter, allowing the function to deduce the derived type and the cv/ref qualifiers of the object.

```cpp
struct Widget {
    void process(this Widget& self);         // replaces: void process() &;
    void process(this const Widget& self);   // replaces: void process() const &;
};
```

- MF-CPP-48: **Eliminates const/non-const overload duplication.** A single function template with a deduced `this` parameter replaces two identical overloads that differ only in constness:

```cpp
struct Config {
    std::string data;

    // One definition covers both const and non-const callers
    auto& get(this auto& self) { return self.data; }
};
```

- MF-CPP-49: **CRTP without templates at the class level.** The deducing-`this` parameter carries the derived type, enabling mixin patterns with zero boilerplate:

```cpp
struct Printable {
    void print(this const auto& self) {
        std::println("{}", self.to_string());   // calls derived to_string()
    }
};

struct Report : Printable {
    std::string to_string() const { return "Report[...]"; }
};
```

- MF-CPP-50: **Recursive lambdas.** Lambdas can refer to themselves without `std::function` overhead by taking `this auto self` as an explicit parameter:

```cpp
auto fib = [](this auto self, int n) -> int {
    return (n <= 1) ? n : self(n - 1) + self(n - 2);
};
static_assert(fib(10) == 55);   // works at compile time with constexpr lambda
```

### Example — Eliminating const/non-const Overloads

```cpp
#include <string>
#include <format>

// Before C++23: two overloads required
struct Cache_Before {
    std::string buffer;
    std::string&       data()       { return buffer; }
    const std::string& data() const { return buffer; }
};

// C++23: single deducing-this overload
struct Cache {
    std::string buffer;
    auto& data(this auto& self) { return self.buffer; }
};

void demo() {
    Cache c;
    c.data() = "hello";               // calls non-const overload
    const Cache& cc = c;
    std::println("{}", cc.data());    // calls const overload — same function
}
```

---

## Cross-Reference

| Rule Range     | Topic                         | Related Spec                         |
|----------------|-------------------------------|--------------------------------------|
| MF-CPP-01–10   | Modules                       | C++ Build & Toolchain Standard BT-05 |
| MF-CPP-11–20   | Coroutines                    | C++ Architecture Standard            |
| MF-CPP-21–28   | Ranges                        | C++ Idiomatic Guide IG-10            |
| MF-CPP-29–36   | Concepts                      | C++ Idiomatic Guide IG-03            |
| MF-CPP-37–42   | std::expected                 | C++ Idiomatic Guide IG-07            |
| MF-CPP-43–46   | std::format / Print           | C++ Idiomatic Guide                  |
| MF-CPP-47–50   | Deducing this                 | C++ Architecture Standard            |
