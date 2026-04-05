package io.ghostdoc.agent.core;

import java.util.Arrays;
import java.util.List;

/**
 * Immutable configuration for a {@link Tracer} instance.
 *
 * <pre>{@code
 * TracerConfig config = TracerConfig.builder("my-service")
 *     .hubUrl("ws://localhost:3001/agent")
 *     .sampleRate(0.5)
 *     .sanitizeKeys("password", "token", "secret")
 *     .build();
 * }</pre>
 */
public final class TracerConfig {

    private final String agentId;
    private final String hubUrl;
    private final boolean enabled;
    private final List<String> sanitizeKeys;
    private final int bufferSize;
    private final double sampleRate;

    private TracerConfig(Builder b) {
        this.agentId     = b.agentId;
        this.hubUrl      = b.hubUrl;
        this.enabled     = b.enabled;
        this.sanitizeKeys = b.sanitizeKeys;
        this.bufferSize  = b.bufferSize;
        this.sampleRate  = b.sampleRate;
    }

    public String getAgentId()          { return agentId; }
    public String getHubUrl()           { return hubUrl; }
    public boolean isEnabled()          { return enabled; }
    public List<String> getSanitizeKeys() { return sanitizeKeys; }
    public int getBufferSize()          { return bufferSize; }
    public double getSampleRate()       { return sampleRate; }

    public static Builder builder(String agentId) {
        return new Builder(agentId);
    }

    public static final class Builder {
        private final String agentId;
        private String       hubUrl      = "ws://localhost:3001/agent";
        private boolean      enabled     = true;
        private List<String> sanitizeKeys = Sanitizer.DEFAULT_KEYS;
        private int          bufferSize  = 500;
        private double       sampleRate  = 1.0;

        public Builder(String agentId) {
            if (agentId == null || agentId.isBlank())
                throw new IllegalArgumentException("agentId must not be blank");
            this.agentId = agentId;
        }

        public Builder hubUrl(String hubUrl)          { this.hubUrl = hubUrl; return this; }
        public Builder enabled(boolean enabled)        { this.enabled = enabled; return this; }
        public Builder sanitizeKeys(String... keys)   { this.sanitizeKeys = Arrays.asList(keys); return this; }
        public Builder sanitizeKeys(List<String> keys){ this.sanitizeKeys = keys; return this; }
        public Builder bufferSize(int size)            { this.bufferSize = Math.max(1, size); return this; }
        public Builder sampleRate(double rate)         { this.sampleRate = Math.max(0.0, Math.min(1.0, rate)); return this; }

        public TracerConfig build() { return new TracerConfig(this); }
    }
}
