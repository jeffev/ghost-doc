package io.ghostdoc.agent.core;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.util.List;
import java.util.Map;

/**
 * Assembles a Ghost Doc {@code TraceEvent} JSON string.
 *
 * <p>The output schema matches {@code @ghost-doc/shared-types v1.0}:
 * <pre>
 * {
 *   "schema_version": "1.0",
 *   "trace_id": "uuid",
 *   "span_id": "uuid",
 *   "parent_span_id": "uuid" | null,
 *   "source": { agent_id, language, file, line, function_name, description? },
 *   "timing": { started_at, duration_ms },
 *   "input": [...],
 *   "output": ...,
 *   "error": { type, message, stack } | null,
 *   "tags": {}
 * }
 * </pre>
 */
public final class SpanBuilder {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private SpanBuilder() {}

    public static class Params {
        public String traceId;
        public String spanId;
        public String parentSpanId;       // null = root span
        public String agentId;
        public String file;
        public int    line;
        public String functionName;
        public String description;        // may be null
        public long   startedAt;          // Unix ms
        public double durationMs;
        public List<Object> input;
        public Object  output;
        public Throwable error;
        public Map<String, String> tags;
    }

    /**
     * Serialize a span to JSON. Returns null on serialization failure (should never happen).
     */
    public static String toJson(Params p) {
        try {
            ObjectNode root = MAPPER.createObjectNode();
            root.put("schema_version", "1.0");
            root.put("trace_id",       p.traceId);
            root.put("span_id",        p.spanId);
            if (p.parentSpanId != null) {
                root.put("parent_span_id", p.parentSpanId);
            } else {
                root.putNull("parent_span_id");
            }

            ObjectNode source = root.putObject("source");
            source.put("agent_id",     p.agentId);
            source.put("language",     "java");
            source.put("file",         p.file);
            source.put("line",         p.line);
            source.put("function_name", p.functionName);
            if (p.description != null) source.put("description", p.description);

            ObjectNode timing = root.putObject("timing");
            timing.put("started_at",  p.startedAt);
            timing.put("duration_ms", p.durationMs);

            // Input — serialize each argument
            ArrayNode inputNode = root.putArray("input");
            if (p.input != null) {
                for (Object arg : p.input) {
                    inputNode.addPOJO(arg);
                }
            }

            // Output
            if (p.output != null) {
                root.set("output", MAPPER.valueToTree(p.output));
            } else {
                root.putNull("output");
            }

            // Error
            if (p.error != null) {
                ObjectNode err = root.putObject("error");
                err.put("type",    p.error.getClass().getSimpleName());
                err.put("message", p.error.getMessage() != null ? p.error.getMessage() : "");
                err.put("stack",   stackTrace(p.error));
            } else {
                root.putNull("error");
            }

            // Tags
            ObjectNode tagsNode = root.putObject("tags");
            if (p.tags != null) {
                p.tags.forEach(tagsNode::put);
            }

            return MAPPER.writeValueAsString(root);
        } catch (Exception e) {
            System.err.println("[ghost-doc] Failed to serialize span: " + e.getMessage());
            return null;
        }
    }

    private static String stackTrace(Throwable t) {
        StringBuilder sb = new StringBuilder();
        sb.append(t.toString()).append("\n");
        for (StackTraceElement el : t.getStackTrace()) {
            sb.append("\tat ").append(el).append("\n");
        }
        return sb.toString();
    }
}
