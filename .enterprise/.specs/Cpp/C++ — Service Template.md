# C++ — Service / Module Template
## DDD-Ready — Gold Standard / State-of-the-Art

**Version:** 1.0
**Scope:** Generic / Project-agnostic
**Runtime:** C++20 / C++23 | CMake 3.28+

> Reference structure and minimal scaffolding for a C++ backend service.
> Complies with C++ Architecture Standard, FR, and NFR.

---

## 1. Project Layout

```text
{service-name}/
  src/
    api/
      handler/
        {Feature}Handler.h
        {Feature}Handler.cpp
      dto/
        {UseCase}Request.h
        {UseCase}Response.h
      middleware/
        CorrelationIdMiddleware.h
        CorrelationIdMiddleware.cpp
        AuthMiddleware.h
        AuthMiddleware.cpp
      Router.h
      Router.cpp
    application/
      port/
        in/
          I{UseCase}UseCase.h          ← pure virtual interface
        out/
          I{Feature}Repository.h       ← pure virtual interface
          I{Feature}EventPublisher.h   ← pure virtual interface
      usecase/
        {feature}/
          {UseCase}Command.h
          {UseCase}Handler.h
          {UseCase}Handler.cpp
          {UseCase}Result.h
      shared/
        Result.h
        AppError.h
    domain/
      model/
        {Feature}.h
        {Feature}.cpp                  ← Aggregate root
        {Feature}Id.h                  ← Value Object (immutable)
      event/
        {FactName}.h                   ← Domain Event (POD-like struct)
      service/
        {Feature}DomainService.h
        {Feature}DomainService.cpp
      exception/
        {Feature}Exception.h
    infrastructure/
      persistence/
        {Feature}Row.h                 ← DB row struct
        {Feature}RepositoryImpl.h
        {Feature}RepositoryImpl.cpp    ← implements I{Feature}Repository
        {Feature}Mapper.h
        {Feature}Mapper.cpp
      messaging/
        outbox/
          OutboxMessage.h
          OutboxDispatcher.h
          OutboxDispatcher.cpp
        consumer/
          {EventName}Consumer.h
          {EventName}Consumer.cpp
        producer/
          {Feature}EventPublisherImpl.h
          {Feature}EventPublisherImpl.cpp
      cache/
        {Feature}Cache.h
        {Feature}Cache.cpp
      integration/
        client/
          {ExternalService}Client.h
          {ExternalService}Client.cpp
        adapter/
          {ExternalService}Adapter.h
          {ExternalService}Adapter.cpp
      config/
        AppConfig.h
        AppConfig.cpp
  tests/
    domain/
      {Feature}Test.cpp
      {Feature}DomainServiceTest.cpp
    application/
      {UseCase}HandlerTest.cpp
    infrastructure/
      {Feature}RepositoryImplIT.cpp   ← integration tests
    api/
      {Feature}HandlerTest.cpp
  pkg/
    networking/                        ← Core Networking Package
      INetworkClient.h
      NetworkClient.h / .cpp
      NetworkRequest.h
      Result.h
      NetworkError.h
  migrations/                          ← SQL migration files
  docs/
    ADR/
  CMakeLists.txt
  conanfile.py  (or vcpkg.json)
  .clang-tidy
  .clang-format
  .golangci.yml
```

---

## 2. Key Abstractions

### 2.1 Value Object

```cpp
// src/domain/model/{Feature}Id.h
class {Feature}Id {
public:
    [[nodiscard]] static {Feature}Id Generate() {
        return {Feature}Id{GenerateUuid()};
    }

    [[nodiscard]] static std::expected<{Feature}Id, std::string>
    From(std::string value) {
        if (value.empty()) {
            return std::unexpected("{Feature}Id cannot be empty");
        }
        return {Feature}Id{std::move(value)};
    }

    [[nodiscard]] const std::string& Value() const noexcept { return value_; }
    [[nodiscard]] bool operator==(const {Feature}Id&) const = default;
    [[nodiscard]] std::string ToString() const { return value_; }

private:
    explicit {Feature}Id(std::string value) : value_(std::move(value)) {}
    const std::string value_;
};
```

### 2.2 Domain Event

```cpp
// src/domain/event/{FactName}.h
struct {FactName} {
    std::string eventId;
    std::chrono::system_clock::time_point occurredAt;
    std::string aggregateId;
    int schemaVersion{1};
    // domain-specific fields (all const after construction)

    [[nodiscard]] std::string EventType() const { return "{FactName}"; }
};
```

### 2.3 Aggregate Root

```cpp
// src/domain/model/{Feature}.h
class {Feature} {
public:
    [[nodiscard]] static std::expected<{Feature}, {Feature}Exception>
    Create({Feature}Id id, /* params */) {
        // validate invariants
        {Feature} instance{std::move(id)};
        instance.domainEvents_.push_back({FactName}{
            .eventId    = GenerateUuid(),
            .occurredAt = std::chrono::system_clock::now(),
            .aggregateId = instance.id_.ToString(),
        });
        return instance;
    }

    [[nodiscard]] std::vector<std::variant<{FactName}>> PullDomainEvents() {
        auto events = std::move(domainEvents_);
        domainEvents_.clear();
        return events;
    }

    [[nodiscard]] const {Feature}Id& Id() const noexcept { return id_; }
    // Behavior methods only — no public setters

private:
    explicit {Feature}({Feature}Id id) : id_(std::move(id)) {}
    {Feature}Id id_;
    {Feature}Status status_{};
    std::vector<std::variant<{FactName}>> domainEvents_;
};
```

### 2.4 Port In / Use Case Interface

```cpp
// src/application/port/in/I{UseCase}UseCase.h
class I{UseCase}UseCase {
public:
    virtual ~I{UseCase}UseCase() = default;

    [[nodiscard]] virtual Result<{UseCase}Result>
    Execute(const {UseCase}Command& command) = 0;
};
```

### 2.5 Use Case Handler

```cpp
// src/application/usecase/{feature}/{UseCase}Handler.h
class {UseCase}Handler final : public I{UseCase}UseCase {
public:
    explicit {UseCase}Handler(
        std::shared_ptr<I{Feature}Repository> repository,
        std::shared_ptr<I{Feature}EventPublisher> publisher)
        : repository_(std::move(repository))
        , publisher_(std::move(publisher)) {}

    [[nodiscard]] Result<{UseCase}Result>
    Execute(const {UseCase}Command& command) override;

private:
    std::shared_ptr<I{Feature}Repository> repository_;
    std::shared_ptr<I{Feature}EventPublisher> publisher_;
};
```

### 2.6 Result Type

```cpp
// src/application/shared/Result.h
template<typename T>
class Result {
public:
    [[nodiscard]] static Result<T> Ok(T value) {
        return Result<T>{std::move(value), std::nullopt};
    }
    [[nodiscard]] static Result<T> Fail(AppError error) {
        return Result<T>{std::nullopt, std::move(error)};
    }

    [[nodiscard]] bool IsSuccess() const noexcept { return value_.has_value(); }
    [[nodiscard]] const T& Value() const { return value_.value(); }
    [[nodiscard]] const AppError& Error() const { return error_.value(); }

private:
    Result(std::optional<T> v, std::optional<AppError> e)
        : value_(std::move(v)), error_(std::move(e)) {}
    std::optional<T> value_;
    std::optional<AppError> error_;
};

struct AppError {
    std::string code;
    std::string message;
};
```

---

## 3. API Conventions (Crow example)

```cpp
// src/api/handler/{Feature}Handler.cpp
void {Feature}Handler::RegisterRoutes(crow::SimpleApp& app) {
    CROW_ROUTE(app, "/v1/{features}")
        .methods(crow::HTTPMethod::POST)
        ([this](const crow::request& req) {
            auto body = nlohmann::json::parse(req.body, nullptr, false);
            if (body.is_discarded()) {
                return crow::response(400, R"({"type":"invalid_body"})");
            }

            auto command = MapToCommand(body);
            auto result  = useCase_->Execute(command);

            if (!result.IsSuccess()) {
                return crow::response(422, nlohmann::json{
                    {"type",   "https://example.com/errors/" + result.Error().code},
                    {"title",  result.Error().message},
                    {"status", 422}
                }.dump());
            }

            return crow::response(201, MapToResponse(result.Value()).dump());
        });
}
```

---

## 4. Testing Template

### Domain Tests (Google Test — pure unit)
```cpp
TEST({Feature}Test, ThrowsWhenInvariantViolated) {
    auto result = {Feature}::Create({Feature}Id::Generate(), /* invalid */);
    EXPECT_FALSE(result.has_value());
}
```

### Application Tests (Google Mock — mocked ports)
```cpp
TEST({UseCase}HandlerTest, ReturnSuccessOnValidCommand) {
    auto mockRepo = std::make_shared<Mock{Feature}Repository>();
    EXPECT_CALL(*mockRepo, Save(testing::_))
        .WillOnce(testing::Return(Result<{Feature}Id>::Ok(id)));

    {UseCase}Handler handler{mockRepo, mockPublisher};
    auto result = handler.Execute(validCommand);
    EXPECT_TRUE(result.IsSuccess());
}
```

### Infrastructure Tests (Testcontainers or embedded DB)
```cpp
TEST_F({Feature}RepositoryImplIT, PersistsAndRetrieves) {
    // Setup: Postgres via Testcontainers or SQLite in-memory
    auto repo = std::make_unique<{Feature}RepositoryImpl>(connection_);
    repo->Save(aggregate_);
    auto found = repo->FindById(aggregate_.Id());
    EXPECT_TRUE(found.has_value());
}
```

---

## 5. CMakeLists.txt Structure

```cmake
cmake_minimum_required(VERSION 3.28)
project({service_name} LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Domain — zero external deps
add_library(domain STATIC ...)
target_include_directories(domain PUBLIC src/domain)

# Application — depends on domain only
add_library(application STATIC ...)
target_link_libraries(application PUBLIC domain)

# Infrastructure — depends on application + external libs
add_library(infrastructure STATIC ...)
target_link_libraries(infrastructure PUBLIC application nlohmann_json::nlohmann_json ...)

# API — depends on application
add_library(api STATIC ...)
target_link_libraries(api PUBLIC application Crow::Crow ...)

# Executable
add_executable(server src/main.cpp)
target_link_libraries(server PRIVATE api infrastructure)
```

---

## 6. Mandatory CI Gates

- Build passes (`cmake --build . -- -j$(nproc)`)
- Unit tests pass (Google Test)
- Integration tests pass
- `clang-tidy` passes with zero warnings
- `clang-format` check passes
- ASan + UBSan builds pass
- TSan build passes for concurrent code
- Dependency vulnerability scan passes
