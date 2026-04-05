package io.ghostdoc.agent;

import io.ghostdoc.agent.core.Sanitizer;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class SanitizerTest {

    private final Sanitizer sanitizer = new Sanitizer(Sanitizer.DEFAULT_KEYS);

    @Test
    void redactsPasswordKey() {
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("username", "alice");
        input.put("password", "s3cr3t");

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) sanitizer.sanitize(input);

        assertEquals("alice",       result.get("username"));
        assertEquals("[REDACTED]",  result.get("password"));
    }

    @Test
    void redactsTokenKeysCaseInsensitive() {
        Map<String, Object> input = Map.of("Authorization", "Bearer xyz");

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) sanitizer.sanitize(input);

        assertEquals("[REDACTED]", result.get("Authorization"));
    }

    @Test
    void redactsJwtValues() {
        // A string that matches the JWT pattern (three base64url segments)
        String jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.abc123";
        Map<String, Object> input = Map.of("token_data", jwt);

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) sanitizer.sanitize(input);

        assertEquals("[REDACTED]", result.get("token_data"));
    }

    @Test
    void doesNotRedactSafeFields() {
        Map<String, Object> input = Map.of("name", "Alice", "age", 30);

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) sanitizer.sanitize(input);

        assertEquals("Alice", result.get("name"));
        assertEquals(30,      result.get("age"));
    }

    @Test
    void handlesNestedObjects() {
        Map<String, Object> inner = new LinkedHashMap<>();
        inner.put("secret", "hidden");
        inner.put("value", 42);

        Map<String, Object> outer = new LinkedHashMap<>();
        outer.put("data", inner);

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) sanitizer.sanitize(outer);

        @SuppressWarnings("unchecked")
        Map<String, Object> resultInner = (Map<String, Object>) result.get("data");

        assertEquals("[REDACTED]", resultInner.get("secret"));
        assertEquals(42,           resultInner.get("value"));
    }

    @Test
    void handlesList() {
        List<Object> input = List.of("safe", "also-safe");
        @SuppressWarnings("unchecked")
        List<Object> result = (List<Object>) sanitizer.sanitize(input);
        assertEquals(List.of("safe", "also-safe"), result);
    }

    @Test
    void handlesNull() {
        assertNull(sanitizer.sanitize(null));
    }
}
