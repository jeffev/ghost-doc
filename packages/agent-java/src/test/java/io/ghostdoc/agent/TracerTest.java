package io.ghostdoc.agent;

import io.ghostdoc.agent.core.Tracer;
import io.ghostdoc.agent.core.TracerConfig;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.*;

class TracerTest {

    /** Config with tracing disabled so no real WS connection is opened. */
    private static TracerConfig disabledConfig() {
        return TracerConfig.builder("test-agent")
            .enabled(false)
            .build();
    }

    @Test
    void traceExecutesCallable() throws Exception {
        Tracer tracer = new Tracer(disabledConfig());
        int result = tracer.trace("add", List.of(2, 3), () -> 2 + 3);
        assertEquals(5, result);
    }

    @Test
    void tracePropagatesException() {
        Tracer tracer = new Tracer(disabledConfig());
        RuntimeException thrown = assertThrows(RuntimeException.class, () ->
            tracer.trace("boom", List.of(), () -> { throw new IllegalStateException("fail"); })
        );
        assertTrue(thrown.getMessage().contains("fail") ||
                   (thrown.getCause() != null && thrown.getCause().getMessage().contains("fail")));
    }

    @Test
    void traceAsyncCompletesNormally() throws Exception {
        Tracer tracer = new Tracer(disabledConfig());
        CompletableFuture<String> future = tracer.traceAsync(
            "asyncOp", List.of(),
            () -> CompletableFuture.completedFuture("done")
        );
        assertEquals("done", future.get());
    }

    @Test
    void traceAsyncPropagatesFailure() {
        Tracer tracer = new Tracer(disabledConfig());
        CompletableFuture<String> future = tracer.traceAsync(
            "asyncFail", List.of(),
            () -> CompletableFuture.failedFuture(new RuntimeException("async error"))
        );
        assertTrue(future.isCompletedExceptionally());
    }

    @Test
    void sampleRateZeroSkipsAllSpans() {
        AtomicBoolean called = new AtomicBoolean(false);
        TracerConfig config = TracerConfig.builder("test-agent")
            .enabled(true)
            .sampleRate(0.0)
            .build();
        Tracer tracer = new Tracer(config);
        try {
            boolean result = tracer.trace("fn", List.of(), () -> {
                called.set(true);
                return true;
            });
            assertTrue(result);
            assertTrue(called.get(), "Callable must always run even when sampled out");
        } finally {
            tracer.disconnect();
        }
    }

    @Test
    void disabledTracerStillExecutesCallable() {
        Tracer tracer = new Tracer(disabledConfig());
        String result = tracer.trace("noop", List.of(), () -> "hello");
        assertEquals("hello", result);
    }
}
