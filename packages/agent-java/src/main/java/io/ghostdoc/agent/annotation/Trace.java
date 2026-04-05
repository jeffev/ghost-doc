package io.ghostdoc.agent.annotation;

import java.lang.annotation.*;

/**
 * Marks a method for Ghost Doc tracing.
 *
 * <p>When used with the Spring AOP adapter ({@code ghost-doc-agent-java} on the classpath
 * and {@code @EnableGhostDoc} on a Spring {@code @Configuration} class), Ghost Doc
 * automatically intercepts every call and emits a {@code TraceEvent} to the Hub.
 *
 * <pre>{@code
 * @Service
 * public class UserService {
 *
 *     @Trace
 *     public User findById(long id) { ... }
 *
 *     @Trace(description = "Sends welcome email")
 *     public void sendWelcomeEmail(String email) { ... }
 * }
 * }</pre>
 *
 * <p>Without Spring, use the functional API on {@link io.ghostdoc.agent.core.Tracer}:
 * <pre>{@code
 * User result = tracer.trace("findById", () -> repo.findById(id));
 * }</pre>
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface Trace {

    /**
     * Optional override for the function name shown in the dashboard.
     * Defaults to the Java method name.
     */
    String value() default "";

    /**
     * Human-readable description shown in the node tooltip.
     * Defaults to empty (no description).
     */
    String description() default "";
}
