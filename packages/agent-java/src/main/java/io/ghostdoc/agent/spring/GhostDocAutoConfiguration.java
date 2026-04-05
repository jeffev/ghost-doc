package io.ghostdoc.agent.spring;

import io.ghostdoc.agent.core.Sanitizer;
import io.ghostdoc.agent.core.Tracer;
import io.ghostdoc.agent.core.TracerConfig;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.ImportAware;
import org.springframework.core.annotation.AnnotationAttributes;
import org.springframework.core.type.AnnotationMetadata;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Registers the {@link Tracer} and {@link TraceAspect} beans when
 * {@link EnableGhostDoc} is present on a {@code @Configuration} class.
 */
@Configuration
public class GhostDocAutoConfiguration implements ImportAware {

    private AnnotationAttributes attrs;

    @Override
    public void setImportMetadata(AnnotationMetadata metadata) {
        this.attrs = AnnotationAttributes.fromMap(
            metadata.getAnnotationAttributes(EnableGhostDoc.class.getName()));
    }

    @Bean
    public Tracer ghostDocTracer() {
        String   agentId    = attrs.getString("agentId");
        String   hubUrl     = attrs.getString("hubUrl");
        boolean  enabled    = attrs.getBoolean("enabled");
        double   sampleRate = (double) attrs.getNumber("sampleRate").doubleValue();
        String[] extraKeys  = attrs.getStringArray("sanitizeKeys");

        List<String> keys = new ArrayList<>(Sanitizer.DEFAULT_KEYS);
        keys.addAll(Arrays.asList(extraKeys));

        TracerConfig config = TracerConfig.builder(agentId)
            .hubUrl(hubUrl)
            .enabled(enabled)
            .sampleRate(sampleRate)
            .sanitizeKeys(keys)
            .build();

        return new Tracer(config);
    }

    @Bean
    public TraceAspect ghostDocTraceAspect(Tracer ghostDocTracer) {
        return new TraceAspect(ghostDocTracer);
    }
}
