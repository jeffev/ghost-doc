package io.ghostdoc.agent.core;

import java.lang.reflect.Array;
import java.util.*;
import java.util.regex.Pattern;

/**
 * Deep-clones an object graph while redacting sensitive field names and values.
 *
 * <p>Matches the Ghost Doc JS agent sanitization model:
 * <ul>
 *   <li>Keys matched case-insensitively against the block-list → value replaced with {@code "[REDACTED]"}</li>
 *   <li>String values that look like JWTs or credit card numbers → also redacted</li>
 *   <li>Circular references → replaced with {@code "[Circular]"}</li>
 * </ul>
 */
public final class Sanitizer {

    public static final List<String> DEFAULT_KEYS = Collections.unmodifiableList(Arrays.asList(
        "password", "passwd", "token", "secret", "authorization",
        "api_key", "apikey", "apitoken", "api_token",
        "auth", "auth_token", "access_token", "refresh_token", "id_token",
        "bearer", "jwt", "credential", "credentials",
        "private_key", "privatekey", "client_secret", "client_id",
        "session", "session_id", "sessionid", "cookie", "set_cookie",
        "x_api_key", "ssn", "social_security", "credit_card",
        "card_number", "cvv", "pin", "bank_account", "routing_number"
    ));

    private static final String REDACTED  = "[REDACTED]";
    private static final String CIRCULAR  = "[Circular]";

    // JWT: three base64url segments separated by dots
    private static final Pattern JWT_PATTERN =
        Pattern.compile("^[A-Za-z0-9_-]{2,}(?:\\.[A-Za-z0-9_-]{2,}){2}$");

    // Bare credit-card numbers (13-19 digits, optional spaces/dashes)
    private static final Pattern CARD_PATTERN =
        Pattern.compile("^\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{1,7}$");

    private final Set<String> blockList;

    public Sanitizer(List<String> keys) {
        Set<String> set = new HashSet<>();
        for (String k : keys) set.add(k.toLowerCase(Locale.ROOT));
        this.blockList = Collections.unmodifiableSet(set);
    }

    /** Recursively sanitize a value. Primitive wrappers and Strings are returned as-is (or redacted). */
    public Object sanitize(Object value) {
        return walk(value, Collections.newSetFromMap(new IdentityHashMap<>()));
    }

    private Object walk(Object value, Set<Object> seen) {
        if (value == null)                             return null;
        if (value instanceof Number)                   return value;
        if (value instanceof Boolean)                  return value;
        if (value instanceof String)                   return value;

        if (value.getClass().isArray()) {
            return walkArray(value, seen);
        }

        if (value instanceof List) {
            return walkList((List<?>) value, seen);
        }

        if (value instanceof Map) {
            return walkMap((Map<?, ?>) value, seen);
        }

        // For arbitrary objects, convert to string representation (safe fallback).
        return value.toString();
    }

    private Object walkArray(Object arr, Set<Object> seen) {
        int len = Array.getLength(arr);
        List<Object> result = new ArrayList<>(len);
        for (int i = 0; i < len; i++) {
            result.add(walk(Array.get(arr, i), seen));
        }
        return result;
    }

    private List<Object> walkList(List<?> list, Set<Object> seen) {
        if (seen.contains(list)) return Collections.singletonList(CIRCULAR);
        seen.add(list);
        List<Object> result = new ArrayList<>(list.size());
        for (Object item : list) result.add(walk(item, seen));
        seen.remove(list);
        return result;
    }

    private Map<String, Object> walkMap(Map<?, ?> map, Set<Object> seen) {
        if (seen.contains(map)) {
            Map<String, Object> circ = new LinkedHashMap<>();
            circ.put("_circular", CIRCULAR);
            return circ;
        }
        seen.add(map);
        Map<String, Object> result = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            String key = String.valueOf(entry.getKey());
            Object raw = entry.getValue();
            result.put(key, shouldRedact(key, raw) ? REDACTED : walk(raw, seen));
        }
        seen.remove(map);
        return result;
    }

    private boolean shouldRedact(String key, Object value) {
        if (blockList.contains(key.toLowerCase(Locale.ROOT))) return true;
        if (value instanceof String) {
            String s = ((String) value).trim();
            if (JWT_PATTERN.matcher(s).matches()) return true;
            if (CARD_PATTERN.matcher(s).matches()) return true;
        }
        return false;
    }
}
