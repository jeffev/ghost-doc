import { randomUUID } from "node:crypto";
import type { SpanInput, Snapshot } from "./types.js";

// ---------------------------------------------------------------------------
// Snapshot creation
// ---------------------------------------------------------------------------

/**
 * Creates a Snapshot object from a set of spans.
 * The caller is responsible for persisting the snapshot to disk.
 */
export function createSnapshot(
  spans: SpanInput[],
  tags: Record<string, string> = {},
): Snapshot {
  const agents = [...new Set(spans.map((s) => s.source.agent_id))];
  return {
    id: randomUUID(),
    createdAt: Date.now(),
    agents,
    spans,
    tags,
  };
}

// ---------------------------------------------------------------------------
// Encode / decode (base64url — safe for URL fragments)
// ---------------------------------------------------------------------------

/**
 * Encodes a Snapshot as a base64url string, suitable for use as a URL
 * fragment: `ghost-doc://#<encoded>`.
 *
 * Compression is intentionally omitted to keep the implementation
 * dependency-free. For large snapshots, use `ghost-doc share <id>` with a
 * file-based reference instead.
 */
export function encodeSnapshot(snapshot: Snapshot): string {
  const json = JSON.stringify(snapshot);
  return Buffer.from(json, "utf-8").toString("base64url");
}

/**
 * Decodes a base64url-encoded snapshot string back to a Snapshot object.
 * Throws if the payload is not valid JSON or missing required fields.
 */
export function decodeSnapshot(encoded: string): Snapshot {
  let json: string;
  try {
    json = Buffer.from(encoded, "base64url").toString("utf-8");
  } catch {
    throw new Error("Invalid snapshot encoding: base64url decode failed");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Invalid snapshot encoding: JSON parse failed");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("id" in parsed) ||
    !("spans" in parsed) ||
    !("createdAt" in parsed)
  ) {
    throw new Error("Invalid snapshot: missing required fields (id, spans, createdAt)");
  }

  return parsed as Snapshot;
}

// ---------------------------------------------------------------------------
// Share URL helpers
// ---------------------------------------------------------------------------

const SHARE_PREFIX = "ghost-doc://#";

/**
 * Wraps an encoded snapshot in a share URL fragment string.
 * Example: `ghost-doc://#eyJpZCI6...`
 */
export function buildShareUrl(encoded: string): string {
  return `${SHARE_PREFIX}${encoded}`;
}

/**
 * Extracts the encoded payload from a share URL produced by `buildShareUrl`.
 * Returns `null` if the URL does not match the expected format.
 */
export function parseShareUrl(url: string): string | null {
  if (!url.startsWith(SHARE_PREFIX)) return null;
  return url.slice(SHARE_PREFIX.length);
}
