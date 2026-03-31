/**
 * HTTP middleware helpers for Ghost Doc tracing.
 *
 * Provides ready-to-use middleware for Express and Fastify that:
 *   1. Reads the X-Trace-Id header to continue an incoming distributed trace.
 *   2. Injects the active trace ID into the response headers so downstream
 *      services can correlate their own spans.
 *
 * Usage — Express:
 * ```ts
 * import express from "express";
 * import { createTracer } from "@ghost-doc/agent-js";
 * import { createExpressMiddleware } from "@ghost-doc/agent-js/middleware";
 *
 * const tracer = createTracer({ agentId: "my-api" });
 * const app = express();
 * app.use(createExpressMiddleware(tracer));
 * ```
 *
 * Usage — Fastify:
 * ```ts
 * import Fastify from "fastify";
 * import { createTracer } from "@ghost-doc/agent-js";
 * import { createFastifyPlugin } from "@ghost-doc/agent-js/middleware";
 *
 * const tracer = createTracer({ agentId: "my-api" });
 * const fastify = Fastify();
 * await fastify.register(createFastifyPlugin(tracer));
 * ```
 */

import type { TracerInstance } from "./tracer.js";
import { TRACE_ID_HEADER } from "./tracer.js";
import { newSpanId } from "./span.js";

// ---------------------------------------------------------------------------
// Express
// ---------------------------------------------------------------------------

/** Minimal Express types (avoids a hard dependency on @types/express). */
interface ExpressRequest {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
}

interface ExpressResponse {
  setHeader(name: string, value: string): this;
  on(event: string, listener: () => void): this;
  statusCode: number;
}

type NextFunction = (err?: unknown) => void;

type ExpressMiddleware = (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => void;

/**
 * Creates an Express middleware that propagates distributed trace IDs.
 *
 * - Reads `X-Trace-Id` from the incoming request headers.
 * - Runs the rest of the request inside a trace context so all nested
 *   `@tracer.trace` or `tracer.wrap()` calls share the same trace ID.
 * - Injects `X-Trace-Id` into the response for downstream correlation.
 */
export function createExpressMiddleware(tracer: TracerInstance): ExpressMiddleware {
  return function ghostDocMiddleware(req, res, next) {
    const incomingCtx = tracer.contextFromHeaders(req.headers);
    const ctx = incomingCtx ?? {
      traceId: newSpanId(), // generate a fresh trace for root requests
      spanId: newSpanId(),
    };

    // Echo the trace ID back so the caller can correlate response with their trace.
    res.setHeader(TRACE_ID_HEADER, ctx.traceId);

    tracer.runInContext(ctx, () => next());
  };
}

// ---------------------------------------------------------------------------
// Fastify
// ---------------------------------------------------------------------------

/** Minimal Fastify plugin types. */
interface FastifyInstance {
  addHook(
    event: string,
    hook: (req: FastifyRequest, reply: FastifyReply, done: () => void) => void,
  ): void;
  addHook(
    event: "onRequest",
    hook: (req: FastifyRequest, reply: FastifyReply, done: () => void) => void,
  ): void;
}

interface FastifyRequest {
  headers: Record<string, string | string[] | undefined>;
}

interface FastifyReply {
  header(name: string, value: string): this;
}

type FastifyPlugin = (fastify: FastifyInstance, _opts: unknown, done: () => void) => void;

/**
 * Creates a Fastify plugin that propagates distributed trace IDs.
 *
 * Registers an `onRequest` hook that:
 * - Reads `X-Trace-Id` from the incoming request.
 * - Runs the request handler in a trace context.
 * - Sets `X-Trace-Id` in the response.
 *
 * Note: Fastify's `onRequest` hook runs synchronously before route handlers.
 * Because `runInContext` is synchronous in Node.js AsyncLocalStorage, all
 * async work within the same request will automatically inherit the context.
 */
export function createFastifyPlugin(tracer: TracerInstance): FastifyPlugin {
  return function ghostDocPlugin(fastify, _opts, done) {
    fastify.addHook("onRequest", (req, reply, hookDone) => {
      const incomingCtx = tracer.contextFromHeaders(req.headers);
      const ctx = incomingCtx ?? {
        traceId: newSpanId(),
        spanId: newSpanId(),
      };

      reply.header(TRACE_ID_HEADER, ctx.traceId);

      // AsyncLocalStorage.run is synchronous — the hook completes synchronously
      // but the async context propagates through the entire request lifecycle.
      tracer.runInContext(ctx, hookDone);
    });

    done();
  };
}
