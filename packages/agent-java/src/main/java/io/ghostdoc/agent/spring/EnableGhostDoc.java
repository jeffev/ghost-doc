package io.ghostdoc.agent.spring;

import org.springframework.context.annotation.Import;

import java.lang.annotation.*;

/**
 * Enable Ghost Doc tracing in a Spring Boot application.
 *
 * <p>Add this annotation to a {@code @Configuration} class:
 *
 * <pre>{@code
 * @Configuration
 * @EnableAspectJAutoProxy
 * @EnableGhostDoc(agentId = "my-service")
 * public class AppConfig { }
 * }</pre>
 *
 * <p>Then annotate any Spring-managed method with {@link io.ghostdoc.agent.annotation.Trace}.
 */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Import(GhostDocAutoConfiguration.class)
public @interface EnableGhostDoc {

    /** Identifies this service in the Ghost Doc Hub (required). */
    String agentId();

    /** Hub WebSocket URL. Default: {@code ws://localhost:3001/agent} */
    String hubUrl() default "ws://localhost:3001/agent";

    /** Set to {@code false} to disable all tracing (e.g. in tests). Default: {@code true} */
    boolean enabled() default true;

    /** Fraction of spans to emit (0.0–1.0). Default: {@code 1.0} */
    double sampleRate() default 1.0;

    /** Additional field names to redact (merged with the built-in list). */
    String[] sanitizeKeys() default {};
}
