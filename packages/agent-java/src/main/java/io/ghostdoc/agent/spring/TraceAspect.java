package io.ghostdoc.agent.spring;

import io.ghostdoc.agent.annotation.Trace;
import io.ghostdoc.agent.core.Tracer;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;

import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.List;

/**
 * Spring AOP aspect that intercepts methods annotated with {@link Trace}.
 *
 * <p>This class is only compiled when Spring and AspectJ are on the classpath.
 * Register it as a Spring bean (via {@link GhostDocAutoConfiguration} or manually)
 * and enable proxy-based AOP with {@code @EnableAspectJAutoProxy}.
 *
 * <pre>{@code
 * @Configuration
 * @EnableAspectJAutoProxy
 * @EnableGhostDoc(agentId = "my-service")
 * public class AppConfig { }
 * }</pre>
 */
@Aspect
public class TraceAspect {

    private final Tracer tracer;

    public TraceAspect(Tracer tracer) {
        this.tracer = tracer;
    }

    @Around("@annotation(trace)")
    public Object around(ProceedingJoinPoint pjp, Trace trace) throws Throwable {
        MethodSignature sig    = (MethodSignature) pjp.getSignature();
        Method          method = sig.getMethod();

        String functionName = trace.value().isBlank() ? method.getName() : trace.value();
        String description  = trace.description().isBlank() ? null : trace.description();

        List<Object> args = Arrays.asList(pjp.getArgs());

        try {
            return tracer.traceInternal(functionName, description, args, () -> {
                try {
                    return pjp.proceed();
                } catch (Throwable t) {
                    if (t instanceof Exception e) throw e;
                    throw new RuntimeException(t);
                }
            });
        } catch (RuntimeException re) {
            // Unwrap the original checked exception so Spring sees the real type.
            Throwable cause = re.getCause();
            if (cause != null && !(cause instanceof RuntimeException)) throw cause;
            throw re;
        }
    }
}
