package io.ghostdoc.agent.core;

import java.util.*;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.Supplier;

/**
 * Main entry point for the Ghost Doc Java agent.
 *
 * <h2>Usage without Spring</h2>
 * <pre>{@code
 * Tracer tracer = new Tracer(TracerConfig.builder("my-service").build());
 *
 * // Wrap a callable (sync)
 * User user = tracer.trace("findUser", List.of(id), () -> repo.findById(id));
 *
 * // Wrap an async CompletableFuture
 * CompletableFuture<User> future = tracer.traceAsync(
 *     "findUserAsync", List.of(id), () -> repo.findByIdAsync(id));
 * }</pre>
 *
 * <h2>Usage with Spring Boot</h2>
 * <p>Add {@code @EnableGhostDoc} to a {@code @Configuration} class and annotate
 * methods with {@code @Trace}. The Spring AOP aspect picks them up automatically.
 */
public final class Tracer {

    private final TracerConfig   config;
    private final Sanitizer      sanitizer;
    private final RingBuffer<String> offlineBuffer;
    private final WsTransport    transport;

    /**
     * Propagates the current span context across method boundaries on the same thread.
     * Each entry: [traceId, spanId].
     */
    private final ThreadLocal<Deque<String[]>> contextStack =
        ThreadLocal.withInitial(ArrayDeque::new);

    public Tracer(TracerConfig config) {
        this.config        = config;
        this.sanitizer     = new Sanitizer(config.getSanitizeKeys());
        this.offlineBuffer = new RingBuffer<>(config.getBufferSize());
        this.transport     = new WsTransport(config.getHubUrl(), offlineBuffer);

        if (config.isEnabled()) {
            transport.connect();
        }
    }

    // -------------------------------------------------------------------------
    // Public API — synchronous
    // -------------------------------------------------------------------------

    /**
     * Execute {@code fn} inside a traced span.
     *
     * @param functionName label shown in the dashboard
     * @param args         method arguments (will be sanitized)
     * @param fn           the callable to execute
     */
    public <T> T trace(String functionName, List<Object> args, Callable<T> fn) {
        return traceInternal(functionName, null, args, fn);
    }

    /** Overload without description. */
    public <T> T trace(String functionName, List<Object> args, Callable<T> fn,
                       String description) {
        return traceInternal(functionName, description, args, fn);
    }

    // -------------------------------------------------------------------------
    // Public API — asynchronous (CompletableFuture)
    // -------------------------------------------------------------------------

    /**
     * Execute an async operation inside a traced span.
     * The span is emitted when the future completes (or fails).
     */
    public <T> CompletableFuture<T> traceAsync(String functionName,
                                               List<Object> args,
                                               Supplier<CompletableFuture<T>> fn) {
        return traceAsyncInternal(functionName, null, args, fn);
    }

    public <T> CompletableFuture<T> traceAsync(String functionName,
                                               List<Object> args,
                                               Supplier<CompletableFuture<T>> fn,
                                               String description) {
        return traceAsyncInternal(functionName, description, args, fn);
    }

    // -------------------------------------------------------------------------
    // Internal execution
    // -------------------------------------------------------------------------

    /** Called by the Spring AOP aspect. Exposes config and sanitizer. */
    public <T> T traceInternal(String functionName,
                               String description,
                               List<Object> args,
                               Callable<T> fn) {
        if (!config.isEnabled()) {
            return callUnchecked(fn);
        }
        if (shouldSkip()) {
            return callUnchecked(fn);
        }

        SourceLocation loc = captureLocation(functionName);
        SpanContext ctx = pushSpan();
        long startedAt  = System.currentTimeMillis();
        long startNano  = System.nanoTime();

        List<Object> sanitizedInput = sanitizeArgs(args);

        try {
            T result = fn.call();
            double durationMs = nanoToMs(System.nanoTime() - startNano);
            emit(ctx, loc, functionName, description, startedAt, durationMs,
                 sanitizedInput, sanitizer.sanitize(result), null);
            return result;
        } catch (Exception e) {
            double durationMs = nanoToMs(System.nanoTime() - startNano);
            emit(ctx, loc, functionName, description, startedAt, durationMs,
                 sanitizedInput, null, e);
            if (e instanceof RuntimeException) throw (RuntimeException) e;
            throw new RuntimeException(e);
        } finally {
            popSpan();
        }
    }

    private <T> CompletableFuture<T> traceAsyncInternal(String functionName,
                                                         String description,
                                                         List<Object> args,
                                                         Supplier<CompletableFuture<T>> fn) {
        if (!config.isEnabled() || shouldSkip()) {
            return fn.get();
        }

        SourceLocation loc = captureLocation(functionName);
        SpanContext ctx = pushSpan();
        long startedAt  = System.currentTimeMillis();
        long startNano  = System.nanoTime();

        List<Object> sanitizedInput = sanitizeArgs(args);

        CompletableFuture<T> future;
        try {
            future = fn.get();
        } catch (Exception e) {
            popSpan();
            double durationMs = nanoToMs(System.nanoTime() - startNano);
            emit(ctx, loc, functionName, description, startedAt, durationMs,
                 sanitizedInput, null, e);
            throw e;
        }

        // Capture context for the callback (may run on a different thread).
        final SpanContext capturedCtx = ctx;
        popSpan(); // Remove from current thread; we'll emit on future completion.

        return future.whenComplete((result, ex) -> {
            double durationMs = nanoToMs(System.nanoTime() - startNano);
            emit(capturedCtx, loc, functionName, description, startedAt, durationMs,
                 sanitizedInput,
                 ex == null ? sanitizer.sanitize(result) : null,
                 ex instanceof Exception ? (Exception) ex : null);
        }).thenApply(r -> r);
    }

    // -------------------------------------------------------------------------
    // Span context (thread-local stack for nested spans)
    // -------------------------------------------------------------------------

    private SpanContext pushSpan() {
        String traceId  = UUID.randomUUID().toString();
        String spanId   = UUID.randomUUID().toString();
        String parentId = null;

        Deque<String[]> stack = contextStack.get();
        if (!stack.isEmpty()) {
            String[] parent = stack.peek();
            traceId  = parent[0]; // inherit trace ID from parent
            parentId = parent[1]; // parent's span ID
        }
        spanId = UUID.randomUUID().toString();
        stack.push(new String[]{traceId, spanId, parentId});
        return new SpanContext(traceId, spanId, parentId);
    }

    private void popSpan() {
        Deque<String[]> stack = contextStack.get();
        if (!stack.isEmpty()) stack.pop();
    }

    // -------------------------------------------------------------------------
    // Emit
    // -------------------------------------------------------------------------

    private void emit(SpanContext ctx,
                      SourceLocation loc,
                      String functionName,
                      String description,
                      long startedAt,
                      double durationMs,
                      List<Object> input,
                      Object output,
                      Exception error) {
        SpanBuilder.Params p = new SpanBuilder.Params();
        p.traceId      = ctx.traceId;
        p.spanId       = ctx.spanId;
        p.parentSpanId = ctx.parentSpanId;
        p.agentId      = config.getAgentId();
        p.file         = loc.file;
        p.line         = loc.line;
        p.functionName = functionName;
        p.description  = description != null && !description.isBlank() ? description : null;
        p.startedAt    = startedAt;
        p.durationMs   = durationMs;
        p.input        = input;
        p.output       = output;
        p.error        = error;
        p.tags         = Collections.emptyMap();

        String json = SpanBuilder.toJson(p);
        if (json != null) transport.send(json);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private boolean shouldSkip() {
        double rate = config.getSampleRate();
        return rate < 1.0 && ThreadLocalRandom.current().nextDouble() > rate;
    }

    private List<Object> sanitizeArgs(List<Object> args) {
        if (args == null || args.isEmpty()) return Collections.emptyList();
        List<Object> result = new ArrayList<>(args.size());
        for (Object a : args) result.add(sanitizer.sanitize(a));
        return result;
    }

    private static double nanoToMs(long nanos) {
        return nanos / 1_000_000.0;
    }

    /**
     * Capture the call site (file + line) by inspecting the stack.
     * Skips ghost-doc frames to land on the actual caller.
     */
    private static SourceLocation captureLocation(String functionName) {
        StackTraceElement[] stack = Thread.currentThread().getStackTrace();
        for (StackTraceElement el : stack) {
            String cls = el.getClassName();
            if (!cls.startsWith("io.ghostdoc") &&
                !cls.equals(Thread.class.getName())) {
                String file = el.getClassName().replace('.', '/') + ".java";
                return new SourceLocation(file, el.getLineNumber());
            }
        }
        return new SourceLocation(functionName + ".java", 0);
    }

    @SuppressWarnings("unchecked")
    private static <T> T callUnchecked(Callable<T> fn) {
        try { return fn.call(); }
        catch (RuntimeException e) { throw e; }
        catch (Exception e) { throw new RuntimeException(e); }
    }

    public void disconnect() { transport.disconnect(); }
    public boolean isConnected() { return transport.isConnected(); }

    // -------------------------------------------------------------------------
    // Value types
    // -------------------------------------------------------------------------

    private record SpanContext(String traceId, String spanId, String parentSpanId) {}
    private record SourceLocation(String file, int line) {}
}
