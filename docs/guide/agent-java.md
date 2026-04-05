# Java / Spring Boot Agent

`io.github.jeffev:agent-java` is a Java tracing agent with the same decorator API as the JS and Python agents. It supports plain Java via a functional API and Spring Boot via the `@Trace` annotation backed by Spring AOP.

## Installation

Add the dependency to your build file:

::: code-group

```groovy [Gradle (Groovy)]
dependencies {
    implementation 'io.github.jeffev:agent-java:0.1.0'
}
```

```kotlin [Gradle (Kotlin)]
dependencies {
    implementation("io.github.jeffev:agent-java:0.1.0")
}
```

```xml [Maven]
<dependency>
    <groupId>io.github.jeffev</groupId>
    <artifactId>agent-java</artifactId>
    <version>0.1.0</version>
</dependency>
```

:::

## Plain Java — functional API

No Spring required. Wrap any callable with `tracer.trace()`.

```java
import io.ghostdoc.agent.core.Tracer;
import io.ghostdoc.agent.core.TracerConfig;

Tracer tracer = new Tracer(
    TracerConfig.builder("my-service")
        .hubUrl("ws://localhost:3001/agent") // default
        .sampleRate(1.0)                    // 0.0–1.0
        .enabled(true)
        .build()
);

// Sync
User user = tracer.trace("findUser", List.of(id), () -> repo.findById(id));

// Async (CompletableFuture)
CompletableFuture<User> future = tracer.traceAsync(
    "findUserAsync", List.of(id),
    () -> repo.findByIdAsync(id)
);

// Disconnect when the application shuts down
tracer.disconnect();
```

## Spring Boot — `@Trace` annotation

### 1. Enable Ghost Doc

Add `@EnableGhostDoc` to any `@Configuration` class and ensure Spring AOP is active:

```java
import io.ghostdoc.agent.spring.EnableGhostDoc;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.EnableAspectJAutoProxy;

@Configuration
@EnableAspectJAutoProxy
@EnableGhostDoc(agentId = "my-service")
public class AppConfig { }
```

`@EnableGhostDoc` attributes:

| Attribute      | Default                     | Description                         |
| :------------- | :-------------------------- | :---------------------------------- |
| `agentId`      | _(required)_                | Badge shown in the dashboard        |
| `hubUrl`       | `ws://localhost:3001/agent` | WebSocket URL of the Hub            |
| `enabled`      | `true`                      | `false` = aspects become no-ops     |
| `sampleRate`   | `1.0`                       | Fraction of calls to emit (0.0–1.0) |
| `sanitizeKeys` | `{}` (uses default list)    | Extra keys to redact before sending |

### 2. Annotate methods

```java
import io.ghostdoc.agent.annotation.Trace;
import org.springframework.stereotype.Service;

@Service
public class OrderService {

    // No options — method name used as node label
    @Trace
    public Order placeOrder(String userId, List<Item> items) { ... }

    // Custom label (shown in dashboard)
    @Trace("order.place")
    public Order placeOrder(String userId, List<Item> items) { ... }

    // Label + description (shown in inspector tooltip)
    @Trace(value = "order.place", description = "Reserves stock and charges the card")
    public Order placeOrder(String userId, List<Item> items) { ... }
}
```

`@Trace` works on any Spring-managed bean method — including `async` methods that return `CompletableFuture`.

## Async tracing

```java
@Trace("order.placeAsync")
public CompletableFuture<Order> placeOrderAsync(String userId, List<Item> items) {
    return CompletableFuture.supplyAsync(() -> processOrder(userId, items));
}
```

Or using the functional API directly:

```java
CompletableFuture<Order> result = tracer.traceAsync(
    "order.placeAsync",
    List.of(userId, items),
    () -> CompletableFuture.supplyAsync(() -> processOrder(userId, items))
);
```

The span is emitted when the future completes (or fails) — not when it starts.

## What is captured

Every traced call emits a `TraceEvent` span containing:

| Field                  | Description                                    |
| :--------------------- | :--------------------------------------------- |
| `trace_id`             | UUID shared across a full call chain           |
| `span_id`              | UUID unique to this function call              |
| `parent_span_id`       | Links to the caller's span                     |
| `source.file`          | Resolved class path (`com/example/Foo.java`)   |
| `source.line`          | Line number of the call site                   |
| `source.function_name` | Method name (or `@Trace` value override)       |
| `source.description`   | Optional description from `@Trace`             |
| `timing.started_at`    | Unix millisecond timestamp                     |
| `timing.duration_ms`   | Wall-clock duration                            |
| `input`                | Sanitized method arguments                     |
| `output`               | Sanitized return value                         |
| `error`                | Exception type, message, and stack (if thrown) |

Nested calls on the same thread share a `trace_id` and are linked via `parent_span_id`, so Ghost Doc can reconstruct the full call tree.

## Sanitization

Sensitive values are redacted **before leaving your JVM**. The default blocklist covers 35 common credential fields, including:

```
password, token, secret, authorization, api_key, bearer, jwt,
access_token, refresh_token, session, cookie, client_secret,
cvv, pin, private_key, passphrase, auth, credentials, ...
```

In addition, the sanitizer detects **sensitive values by pattern**: JWT strings (three Base64 segments separated by `.`) and credit card-length digit sequences are redacted regardless of the key name.

Custom keys via `@EnableGhostDoc`:

```java
@EnableGhostDoc(agentId = "my-service", sanitizeKeys = {"ssn", "tax_id", "iban"})
```

Or via the functional config:

```java
TracerConfig.builder("my-service")
    .sanitizeKeys("ssn", "tax_id", "iban")
    .build();
```

## Offline buffering

If the Hub is unreachable, spans are stored in a thread-safe ring buffer (500 spans by default) and flushed automatically as a single batch on reconnect. Reconnects use exponential backoff starting at 1 second, capped at 30 seconds.

## Head-based sampling

```java
TracerConfig.builder("high-traffic-api")
    .sampleRate(0.1) // emit ~10% of calls
    .build();
```

Or via annotation:

```java
@EnableGhostDoc(agentId = "my-service", sampleRate = 0.1)
```

`sampleRate` is clamped to `[0.0, 1.0]`. Defaults to `1.0` (emit every call). Sampling is evaluated per call using `ThreadLocalRandom`.

## Span batching

The transport buffers spans for up to **50 ms** and sends them as a JSON array in a single WebSocket frame. This reduces overhead significantly on high-throughput services without increasing observable latency.

## Disabling tracing

```java
@EnableGhostDoc(agentId = "my-service", enabled = false) // no-ops in this environment
```

Or dynamically:

```java
TracerConfig.builder("my-service")
    .enabled(!"test".equals(System.getenv("APP_ENV")))
    .build();
```

## Requirements

- Java 17+
- Spring 6 / Spring Boot 3 (optional — only required for `@Trace` AOP support)
- AspectJ runtime (included transitively via Spring AOP)
