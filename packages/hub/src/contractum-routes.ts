/**
 * Ghost Doc Hub — Contractum & Mock Registry REST routes
 *
 * GET  /contracts                        Infer contracts for all functions in store
 * GET  /contracts/:functionName          Infer contract for one function
 * GET  /contracts/:functionName/drift    Diff current inferred vs saved contract
 * POST /contracts/validate               Validate spans against a contract
 * POST /contracts/save                   Save inferred contract to disk
 * GET  /contracts/saved                  List saved contracts
 * GET  /contracts/saved/:name            Load a saved contract
 *
 * GET  /mock/sessions                    List saved session files
 * POST /mock/sessions                    Create + save session from current store spans
 * GET  /mock/sessions/:name              Load a saved session
 * DELETE /mock/sessions/:name            Delete a saved session
 * POST /mock/sessions/:name/clone        Clone a session under a new name
 * PATCH /mock/sessions/:name             Rename a session
 * POST /mock/sessions/merge              Merge multiple sessions into one
 * POST /mock/sessions/diff               Diff two sessions
 * GET  /mock/sessions/:name/openapi      Export session as OpenAPI 3.0 spec
 *
 * GET  /mock/server/status               HTTP mock server status
 * POST /mock/server/start                Start HTTP mock server for a session
 * POST /mock/server/stop                 Stop running HTTP mock server
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { FastifyInstance } from "fastify";
import type { TraceEvent } from "@ghost-doc/shared-types";
import {
  inferContract,
  inferAllContracts,
  validateCalls,
  spansToSession,
  sessionToJson,
  loadSession,
  diffSessions,
  serveMocks,
  InsufficientSamplesError,
} from "@ghost-doc/contractum";
import type {
  ContractDefinition,
  RecordingOptions,
  SessionSnapshot,
  MockServer,
  JSONSchema,
} from "@ghost-doc/contractum";
import type { TraceStore } from "./store.js";

// ---------------------------------------------------------------------------
// Schema diff helpers (for contract drift)
// ---------------------------------------------------------------------------

interface SchemaChange {
  path: string;
  kind:
    | "type_changed"
    | "required_added"
    | "required_removed"
    | "field_added"
    | "field_removed"
    | "enum_changed"
    | "format_changed";
  before: unknown;
  after: unknown;
}

function diffSchemas(
  before: JSONSchema,
  after: JSONSchema,
  path = "root",
  changes: SchemaChange[] = [],
): SchemaChange[] {
  // Type change
  const beforeType = JSON.stringify(before.type ?? null);
  const afterType = JSON.stringify(after.type ?? null);
  if (beforeType !== afterType) {
    changes.push({ path, kind: "type_changed", before: before.type, after: after.type });
  }

  // Format change
  if ((before.format ?? null) !== (after.format ?? null)) {
    changes.push({
      path: `${path}.format`,
      kind: "format_changed",
      before: before.format,
      after: after.format,
    });
  }

  // Enum change
  if (JSON.stringify(before.enum ?? null) !== JSON.stringify(after.enum ?? null)) {
    changes.push({ path, kind: "enum_changed", before: before.enum, after: after.enum });
  }

  // Object properties
  if (before.properties || after.properties) {
    const beforeProps = before.properties ?? {};
    const afterProps = after.properties ?? {};
    const beforeRequired = new Set(before.required ?? []);
    const afterRequired = new Set(after.required ?? []);
    const allKeys = new Set([...Object.keys(beforeProps), ...Object.keys(afterProps)]);

    for (const key of allKeys) {
      const childPath = `${path}.${key}`;
      if (!(key in beforeProps)) {
        changes.push({
          path: childPath,
          kind: "field_added",
          before: undefined,
          after: afterProps[key],
        });
      } else if (!(key in afterProps)) {
        changes.push({
          path: childPath,
          kind: "field_removed",
          before: beforeProps[key],
          after: undefined,
        });
      } else {
        diffSchemas(beforeProps[key]!, afterProps[key]!, childPath, changes);
      }
      // Required changes
      if (beforeRequired.has(key) && !afterRequired.has(key)) {
        changes.push({ path: childPath, kind: "required_removed", before: true, after: false });
      } else if (!beforeRequired.has(key) && afterRequired.has(key)) {
        changes.push({ path: childPath, kind: "required_added", before: false, after: true });
      }
    }
  }

  // Array items
  if (before.items || after.items) {
    if (before.items && after.items) {
      diffSchemas(before.items, after.items, `${path}[items]`, changes);
    }
  }

  return changes;
}

function contractDrift(
  saved: ContractDefinition,
  current: ContractDefinition,
): { changes: SchemaChange[]; isBreaking: boolean } {
  const changes: SchemaChange[] = [];

  // Diff each arg
  const maxArgs = Math.max(saved.args.length, current.args.length);
  for (let i = 0; i < maxArgs; i++) {
    const before = saved.args[i] ?? {};
    const after = current.args[i] ?? {};
    diffSchemas(before, after, `args[${i}]`, changes);
  }

  // Diff return value
  diffSchemas(saved.returns, current.returns, "returns", changes);

  const breakingKinds: SchemaChange["kind"][] = [
    "type_changed",
    "required_added",
    "field_removed",
    "enum_changed",
  ];
  const isBreaking = changes.some((c) => breakingKinds.includes(c.kind));

  return { changes, isBreaking };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerContractumRoutes(
  app: FastifyInstance,
  store: TraceStore,
  storageDir: string,
): void {
  const sessionsDir = path.join(storageDir, "sessions");
  const contractsDir = path.join(storageDir, "contracts");

  // Active HTTP mock server (one at a time per Hub instance)
  let activeMockServer: MockServer | null = null;
  let activeMockMeta: { session: string; port: number; mode: string } | null = null;

  // ---------------------------------------------------------------------------
  // Contracts
  // ---------------------------------------------------------------------------

  app.get<{ Querystring: { min_samples?: string; strict?: string } }>("/contracts", async (req) => {
    const minSamples = parseInt(req.query.min_samples ?? "5", 10);
    const strictTypes = req.query.strict === "true";
    const spans = store.getRecent(10_000) as unknown as TraceEvent[];
    return inferAllContracts(spans, { minSamples, strictTypes });
  });

  app.get<{
    Params: { functionName: string };
    Querystring: { min_samples?: string; strict?: string };
  }>("/contracts/:functionName", async (req, reply) => {
    const minSamples = parseInt(req.query.min_samples ?? "5", 10);
    const strictTypes = req.query.strict === "true";
    const spans = store.getRecent(10_000) as unknown as TraceEvent[];

    try {
      return inferContract(spans, {
        functionName: req.params.functionName,
        minSamples,
        strictTypes,
      });
    } catch (err) {
      if (err instanceof InsufficientSamplesError) {
        return reply.status(422).send({
          error: "insufficient_samples",
          message: err.message,
          actual: err.actual,
          required: err.required,
        });
      }
      throw err;
    }
  });

  // GET /contracts/:functionName/drift — diff current inferred vs saved contract
  app.get<{
    Params: { functionName: string };
    Querystring: { min_samples?: string };
  }>("/contracts/:functionName/drift", async (req, reply) => {
    const { functionName } = req.params;
    const minSamples = parseInt(req.query.min_samples ?? "1", 10);

    // Load saved contract
    let saved: ContractDefinition | null = null;
    for (const ext of ["json", "yaml", "ts"]) {
      const filePath = path.join(contractsDir, `${functionName}.${ext}`);
      try {
        const raw = await fs.readFile(filePath, "utf-8");
        saved = JSON.parse(raw) as ContractDefinition;
        break;
      } catch {
        continue;
      }
    }
    if (saved === null) {
      return reply.status(404).send({ error: `No saved contract found for: ${functionName}` });
    }

    // Infer current contract
    const spans = store.getRecent(10_000) as unknown as TraceEvent[];
    let current: ContractDefinition;
    try {
      current = inferContract(spans, { functionName, minSamples });
    } catch (err) {
      if (err instanceof InsufficientSamplesError) {
        return reply.status(422).send({
          error: "insufficient_samples",
          message: (err as InsufficientSamplesError).message,
        });
      }
      throw err;
    }

    const { changes, isBreaking } = contractDrift(saved, current);
    return { functionName, isBreaking, changes, saved, current };
  });

  app.post<{
    Body: { contract: ContractDefinition; spans?: TraceEvent[] };
  }>("/contracts/validate", async (req, reply) => {
    const { contract, spans: bodySpans } = req.body;
    if (typeof contract !== "object" || contract === null) {
      return reply.status(400).send({ error: "contract is required" });
    }
    const spans =
      bodySpans !== undefined ? bodySpans : (store.getRecent(10_000) as unknown as TraceEvent[]);
    const violations = validateCalls(spans, contract);
    return { violations, count: violations.length };
  });

  app.post<{
    Body: { functionName?: string; contract?: ContractDefinition; format?: string };
  }>("/contracts/save", async (req, reply) => {
    const { functionName, contract: bodyContract, format = "json-schema" } = req.body ?? {};

    let contract: ContractDefinition;
    if (bodyContract !== undefined) {
      contract = bodyContract;
    } else if (typeof functionName === "string") {
      const spans = store.getRecent(10_000) as unknown as TraceEvent[];
      try {
        contract = inferContract(spans, { functionName, minSamples: 1 });
      } catch (err) {
        if (err instanceof InsufficientSamplesError) {
          return reply.status(422).send({ error: (err as InsufficientSamplesError).message });
        }
        throw err;
      }
    } else {
      return reply.status(400).send({ error: "functionName or contract is required" });
    }

    await fs.mkdir(contractsDir, { recursive: true });
    const ext = format === "yaml" ? "yaml" : format === "typescript" ? "ts" : "json";
    const filename = `${contract.functionName}.${ext}`;
    const filePath = path.join(contractsDir, filename);
    await fs.writeFile(filePath, JSON.stringify(contract, null, 2), "utf-8");
    return { saved: filePath, functionName: contract.functionName };
  });

  app.get("/contracts/saved", async () => {
    try {
      const files = await fs.readdir(contractsDir);
      return files
        .filter((f) => f.endsWith(".json") || f.endsWith(".yaml") || f.endsWith(".ts"))
        .map((f) => ({ name: f, file: f }));
    } catch {
      return [];
    }
  });

  app.get<{ Params: { name: string } }>("/contracts/saved/:name", async (req, reply) => {
    const { name } = req.params;
    for (const candidate of [name, `${name}.json`]) {
      const filePath = path.join(contractsDir, candidate);
      try {
        const raw = await fs.readFile(filePath, "utf-8");
        return JSON.parse(raw) as ContractDefinition;
      } catch {
        continue;
      }
    }
    return reply.status(404).send({ error: `contract not found: ${name}` });
  });

  // ---------------------------------------------------------------------------
  // Mock Sessions
  // ---------------------------------------------------------------------------

  async function resolveSession(name: string): Promise<SessionSnapshot | null> {
    try {
      const files = await fs.readdir(sessionsDir);
      const match = files.find((f) => f === `${name}.json` || f.startsWith(`${name}-`));
      if (!match) return null;
      const raw = await fs.readFile(path.join(sessionsDir, match), "utf-8");
      return loadSession(JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  }

  async function resolveSessionFilename(name: string): Promise<string | null> {
    try {
      const files = await fs.readdir(sessionsDir);
      return files.find((f) => f === `${name}.json` || f.startsWith(`${name}-`)) ?? null;
    } catch {
      return null;
    }
  }

  app.get("/mock/sessions", async () => {
    try {
      const files = await fs.readdir(sessionsDir);
      const sessions = await Promise.all(
        files
          .filter((f) => f.endsWith(".json"))
          .map(async (f) => {
            try {
              const raw = await fs.readFile(path.join(sessionsDir, f), "utf-8");
              const s = JSON.parse(raw) as {
                session: string;
                startTime: string;
                endTime: string;
                calls: unknown[];
              };
              return {
                name: f.replace(/\.json$/, ""),
                file: f,
                session: s.session,
                startTime: s.startTime,
                endTime: s.endTime,
                callCount: s.calls.length,
              };
            } catch {
              return null;
            }
          }),
      );
      return sessions.filter(Boolean);
    } catch {
      return [];
    }
  });

  app.post<{
    Body: { name: string; functions?: string[]; maxCallsPerFunction?: number };
  }>("/mock/sessions", async (req, reply) => {
    const { name, functions, maxCallsPerFunction } = req.body ?? {};
    if (typeof name !== "string" || name.trim() === "") {
      return reply.status(400).send({ error: '"name" is required' });
    }
    const spans = store.getRecent(10_000) as unknown as TraceEvent[];
    const opts: RecordingOptions = {};
    if (Array.isArray(functions)) opts.functions = functions;
    if (typeof maxCallsPerFunction === "number") opts.maxCallsPerFunction = maxCallsPerFunction;

    const session = spansToSession(name.trim(), spans, opts);
    const json = sessionToJson(session);
    await fs.mkdir(sessionsDir, { recursive: true });
    const safeName = name.trim().replace(/[^a-z0-9_-]/gi, "_");
    const filename = `${safeName}-${Date.now()}.json`;
    await fs.writeFile(path.join(sessionsDir, filename), json, "utf-8");
    return {
      saved: filename,
      name: filename.replace(/\.json$/, ""),
      session: session.session,
      callCount: session.calls.length,
      startTime: session.startTime,
      endTime: session.endTime,
    };
  });

  app.get<{ Params: { name: string } }>("/mock/sessions/:name", async (req, reply) => {
    const session = await resolveSession(req.params.name);
    if (session === null)
      return reply.status(404).send({ error: `session not found: ${req.params.name}` });
    return session;
  });

  app.delete<{ Params: { name: string } }>("/mock/sessions/:name", async (req, reply) => {
    const filename = await resolveSessionFilename(req.params.name);
    if (filename === null)
      return reply.status(404).send({ error: `session not found: ${req.params.name}` });
    await fs.rm(path.join(sessionsDir, filename));
    return { deleted: filename };
  });

  // POST /mock/sessions/:name/clone
  app.post<{ Params: { name: string }; Body: { name: string } }>(
    "/mock/sessions/:name/clone",
    async (req, reply) => {
      const session = await resolveSession(req.params.name);
      if (session === null)
        return reply.status(404).send({ error: `session not found: ${req.params.name}` });

      const newName = req.body?.name?.trim();
      if (!newName) return reply.status(400).send({ error: '"name" is required' });

      const cloned: SessionSnapshot = { ...session, session: newName };
      const safeName = newName.replace(/[^a-z0-9_-]/gi, "_");
      const filename = `${safeName}-${Date.now()}.json`;
      await fs.mkdir(sessionsDir, { recursive: true });
      await fs.writeFile(path.join(sessionsDir, filename), sessionToJson(cloned), "utf-8");
      return {
        name: filename.replace(/\.json$/, ""),
        session: newName,
        callCount: cloned.calls.length,
      };
    },
  );

  // PATCH /mock/sessions/:name — rename
  app.patch<{ Params: { name: string }; Body: { name: string } }>(
    "/mock/sessions/:name",
    async (req, reply) => {
      const filename = await resolveSessionFilename(req.params.name);
      if (filename === null)
        return reply.status(404).send({ error: `session not found: ${req.params.name}` });

      const newName = req.body?.name?.trim();
      if (!newName) return reply.status(400).send({ error: '"name" is required' });

      const raw = await fs.readFile(path.join(sessionsDir, filename), "utf-8");
      const session = loadSession(JSON.parse(raw) as unknown);
      const renamed: SessionSnapshot = { ...session, session: newName };

      const safeName = newName.replace(/[^a-z0-9_-]/gi, "_");
      const newFilename = `${safeName}-${Date.now()}.json`;
      await fs.writeFile(path.join(sessionsDir, newFilename), sessionToJson(renamed), "utf-8");
      await fs.rm(path.join(sessionsDir, filename));
      return { name: newFilename.replace(/\.json$/, ""), session: newName };
    },
  );

  // POST /mock/sessions/merge
  app.post<{ Body: { sessions: string[]; name: string } }>(
    "/mock/sessions/merge",
    async (req, reply) => {
      const { sessions: sessionNames, name } = req.body ?? {};
      if (!Array.isArray(sessionNames) || sessionNames.length < 2) {
        return reply.status(400).send({ error: 'At least 2 session names required in "sessions"' });
      }
      if (!name?.trim()) return reply.status(400).send({ error: '"name" is required' });

      const loaded: SessionSnapshot[] = [];
      for (const sName of sessionNames) {
        const s = await resolveSession(sName);
        if (s === null) return reply.status(404).send({ error: `session not found: ${sName}` });
        loaded.push(s);
      }

      // Merge: concatenate calls, re-sequence, use earliest startTime / latest endTime
      const allCalls = loaded.flatMap((s) => s.calls);
      allCalls.sort((a, b) => a.sequence - b.sequence);
      const resequenced = allCalls.map((c, i) => ({ ...c, sequence: i + 1 }));

      const merged: SessionSnapshot = {
        session: name.trim(),
        startTime: loaded.map((s) => s.startTime).sort()[0]!,
        endTime: loaded
          .map((s) => s.endTime)
          .sort()
          .at(-1)!,
        calls: resequenced,
      };

      const safeName = name.trim().replace(/[^a-z0-9_-]/gi, "_");
      const filename = `${safeName}-${Date.now()}.json`;
      await fs.mkdir(sessionsDir, { recursive: true });
      await fs.writeFile(path.join(sessionsDir, filename), sessionToJson(merged), "utf-8");
      return {
        name: filename.replace(/\.json$/, ""),
        session: merged.session,
        callCount: merged.calls.length,
      };
    },
  );

  // POST /mock/sessions/diff
  app.post<{ Body: { before: string; after: string; threshold?: number } }>(
    "/mock/sessions/diff",
    async (req, reply) => {
      const { before: beforeName, after: afterName, threshold = 0 } = req.body ?? {};
      if (typeof beforeName !== "string" || typeof afterName !== "string") {
        return reply.status(400).send({ error: '"before" and "after" are required' });
      }
      const [beforeSession, afterSession] = await Promise.all([
        resolveSession(beforeName),
        resolveSession(afterName),
      ]);
      if (beforeSession === null)
        return reply.status(404).send({ error: `session not found: ${beforeName}` });
      if (afterSession === null)
        return reply.status(404).send({ error: `session not found: ${afterName}` });

      const diff = diffSessions(beforeSession, afterSession, threshold);
      const breaking =
        diff.removedFunctions.length > 0 ||
        diff.changedReturnShapes.length > 0 ||
        diff.latencyRegression.some((r) => r.changePercent >= 20);
      return { diff, breaking, before: beforeName, after: afterName, threshold };
    },
  );

  // GET /mock/sessions/:name/openapi
  app.get<{ Params: { name: string }; Querystring: { format?: string } }>(
    "/mock/sessions/:name/openapi",
    async (req, reply) => {
      const session = await resolveSession(req.params.name);
      if (session === null)
        return reply.status(404).send({ error: `session not found: ${req.params.name}` });

      const spec = buildOpenApiSpec(session);
      const format = req.query.format ?? "json";
      if (format === "yaml") {
        reply.header("Content-Type", "text/yaml");
        return reply.send(specToYaml(spec));
      }
      return spec;
    },
  );

  // ---------------------------------------------------------------------------
  // HTTP Mock Server
  // ---------------------------------------------------------------------------

  app.get("/mock/server/status", async () => {
    if (activeMockServer === null || activeMockMeta === null) {
      return { running: false };
    }
    return { running: true, ...activeMockMeta };
  });

  app.post<{
    Body: {
      session: string;
      port?: number;
      mode?: "exact" | "round-robin" | "latency-preserving";
      faultErrorRate?: number;
      faultLatency?: number;
    };
  }>("/mock/server/start", async (req, reply) => {
    const {
      session: sessionName,
      port = 8080,
      mode = "exact",
      faultErrorRate,
      faultLatency,
    } = req.body ?? {};
    if (!sessionName) return reply.status(400).send({ error: '"session" is required' });

    if (activeMockServer !== null) {
      return reply.status(409).send({ error: "A mock server is already running. Stop it first." });
    }

    const session = await resolveSession(sessionName);
    if (session === null)
      return reply.status(404).send({ error: `session not found: ${sessionName}` });

    try {
      activeMockServer = await serveMocks(port, session, {
        mode,
        faultInjection:
          faultErrorRate !== undefined || faultLatency !== undefined
            ? { errorRate: faultErrorRate, latencyFactor: faultLatency }
            : undefined,
      });
      activeMockMeta = { session: sessionName, port, mode };
      return { running: true, url: activeMockServer.url, session: sessionName, port, mode };
    } catch (err) {
      activeMockServer = null;
      activeMockMeta = null;
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  app.post("/mock/server/stop", async (_, reply) => {
    if (activeMockServer === null) {
      return reply.status(404).send({ error: "No mock server is running" });
    }
    await activeMockServer.stop();
    activeMockServer = null;
    activeMockMeta = null;
    return { stopped: true };
  });
}

// ---------------------------------------------------------------------------
// OpenAPI spec builder
// ---------------------------------------------------------------------------

interface OpenApiSpec {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, unknown>;
}

function buildOpenApiSpec(session: SessionSnapshot): OpenApiSpec {
  const groups = new Map<string, typeof session.calls>();
  for (const call of session.calls) {
    const arr = groups.get(call.function) ?? [];
    arr.push(call);
    groups.set(call.function, arr);
  }

  const paths: Record<string, unknown> = {};
  for (const [fnName, calls] of groups) {
    const slug = `/${fnName.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}`;
    const successCalls = calls.filter((c) => c.error === null);
    const errorCalls = calls.filter((c) => c.error !== null);
    const avgMs = Math.round(calls.reduce((s, c) => s + c.durationMs, 0) / calls.length);

    const responses: Record<string, unknown> = {
      "200": {
        description: "Successful response",
        content: {
          "application/json": {
            examples: successCalls.slice(0, 3).reduce(
              (acc, c, i) => {
                acc[`example${i + 1}`] = { value: c.return };
                return acc;
              },
              {} as Record<string, unknown>,
            ),
          },
        },
      },
    };
    if (errorCalls.length > 0) {
      responses["500"] = {
        description: "Error response",
        content: {
          "application/json": {
            examples: errorCalls.slice(0, 2).reduce(
              (acc, c, i) => {
                acc[`error${i + 1}`] = { value: c.error };
                return acc;
              },
              {} as Record<string, unknown>,
            ),
          },
        },
      };
    }

    paths[slug] = {
      post: {
        operationId: fnName,
        summary: `${fnName} (${calls.length} recorded calls, avg ${avgMs}ms)`,
        "x-ghost-doc-session": session.session,
        requestBody:
          calls[0] && calls[0].args.length > 0
            ? {
                required: true,
                content: {
                  "application/json": {
                    examples: calls.slice(0, 3).reduce(
                      (acc, c, i) => {
                        acc[`example${i + 1}`] = { value: c.args };
                        return acc;
                      },
                      {} as Record<string, unknown>,
                    ),
                  },
                },
              }
            : undefined,
        responses,
      },
    };
  }

  return {
    openapi: "3.0.3",
    info: { title: `Ghost Doc — ${session.session}`, version: "1.0.0" },
    paths,
  };
}

function specToYaml(obj: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "boolean") return String(obj);
  if (typeof obj === "number") return String(obj);
  if (typeof obj === "string") {
    if (/[:#\[\]{},&*?|<>=!%@`'"\n]/.test(obj) || obj === "") return JSON.stringify(obj);
    return obj;
  }
  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    return obj.map((v) => `\n${pad}- ${specToYaml(v, indent + 1)}`).join("");
  }
  const entries = Object.entries(obj as Record<string, unknown>).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return "{}";
  return entries
    .map(([k, v]) => {
      const valStr = specToYaml(v, indent + 1);
      return `\n${pad}${k}:${valStr.startsWith("\n") ? valStr : ` ${valStr}`}`;
    })
    .join("");
}
