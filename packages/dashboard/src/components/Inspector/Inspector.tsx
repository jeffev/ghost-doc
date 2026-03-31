import React, { useCallback, useState } from "react";
import { useDashboardStore, selectNode } from "../../store/index.js";
import type { StoredSpan } from "../../store/types.js";
import { Sparkline } from "./Sparkline.js";
import { useVirtualList } from "../../hooks/useVirtualList.js";

/**
 * Right-panel deep-dive inspector.
 * Appears when a node is selected in the flowchart.
 */
export function Inspector(): JSX.Element | null {
  const store = useDashboardStore();
  const selectedNodeId = store.selectedNodeId;
  const node = selectedNodeId !== null ? selectNode(store, selectedNodeId) : undefined;
  const spans = store.selectedNodeSpans();

  const [expandedSpanId, setExpandedSpanId] = useState<string | null>(null);

  const COLLAPSED_ROW_HEIGHT = 36;
  const virtual = useVirtualList({
    itemCount: spans.length,
    rowHeight: COLLAPSED_ROW_HEIGHT,
    overscan: 8,
  });

  if (node === undefined || selectedNodeId === null) {
    return (
      <aside className="w-80 flex-shrink-0 bg-panel border-l border-border flex items-center justify-center">
        <p className="text-gray-600 text-sm text-center px-6">
          Click a node in the flowchart to inspect its calls.
        </p>
      </aside>
    );
  }

  const durations = spans.map((s) => s.timing.duration_ms);

  return (
    <aside className="w-80 flex-shrink-0 bg-panel border-l border-border flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-mono bg-accent/20 text-accent px-2 py-0.5 rounded">
            {node.agentId}
          </span>
          {node.hasAnomaly && (
            <span
              className="text-xs text-anomaly font-semibold animate-pulse cursor-help"
              title="Anomaly detected: this function returned a different data type than previous calls. This may indicate a bug or unexpected code path."
            >
              ⚠ anomaly
            </span>
          )}
          {node.hasError && <span className="text-xs text-anomaly font-semibold">✗ error</span>}
        </div>
        <h2 className="text-white font-mono text-sm font-semibold break-all">
          {node.functionName}
        </h2>
        {node.latestSpan.source.description !== undefined && (
          <p className="text-gray-300 text-xs mt-1 italic">{node.latestSpan.source.description}</p>
        )}
        <p className="text-gray-500 text-xs mt-0.5 break-all">{node.latestSpan.source.file}</p>
      </div>

      {/* Stats */}
      <div className="px-4 py-2 border-b border-border grid grid-cols-2 gap-2 text-xs">
        <Stat label="Calls" value={String(node.callCount)} />
        <Stat label="Avg duration" value={`${Math.round(node.avgDurationMs)} ms`} />
        <Stat label="P95 duration" value={`${Math.round(node.p95DurationMs)} ms`} />
        <div className="col-span-2">
          <span className="text-gray-500 block mb-1">Duration histogram</span>
          <Sparkline durations={durations} width={240} height={28} />
        </div>
      </div>

      {/* Call list — virtualized for performance with large span counts */}
      <div
        ref={virtual.containerRef as React.RefObject<HTMLDivElement>}
        className="flex-1 overflow-y-auto"
        onScroll={virtual.onScroll}
      >
        {spans.length === 0 ? (
          <p className="text-gray-600 text-xs px-4 py-3">No calls recorded yet.</p>
        ) : (
          <div style={{ height: virtual.totalHeight, position: "relative" }}>
            <div style={{ position: "absolute", top: virtual.offsetTop, width: "100%" }}>
              {spans.slice(virtual.startIndex, virtual.endIndex).map((span) => (
                <SpanRow
                  key={span.span_id}
                  span={span}
                  isExpanded={expandedSpanId === span.span_id}
                  onToggle={() =>
                    setExpandedSpanId((prev) => (prev === span.span_id ? null : span.span_id))
                  }
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer actions */}
      {spans.length > 0 && (
        <div className="px-4 py-2 border-t border-border flex gap-2 flex-wrap">
          <CopyButton label="Copy trace JSON" value={JSON.stringify(spans[0], null, 2)} />
          {spans[0] !== undefined && generateCurl(spans[0]) !== null && (
            <CopyButton label="Copy as curl" value={generateCurl(spans[0])!} />
          )}
        </div>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <span className="text-gray-500 block">{label}</span>
      <span className="text-white font-mono">{value}</span>
    </div>
  );
}

interface SpanRowProps {
  span: StoredSpan;
  isExpanded: boolean;
  onToggle: () => void;
}

function SpanRow({ span, isExpanded, onToggle }: SpanRowProps): JSX.Element {
  const hasError = span.error !== null;
  const timestamp = new Date(span.timing.started_at).toLocaleTimeString();

  return (
    <div
      className={`border-b border-border cursor-pointer hover:bg-white/5 transition-colors ${
        hasError ? "border-l-2 border-l-anomaly" : ""
      }`}
      onClick={onToggle}
    >
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-xs font-mono text-gray-400">{timestamp}</span>
        <span
          className={`text-xs font-mono ${
            span.timing.duration_ms > 200 ? "text-warn" : "text-gray-300"
          }`}
        >
          {Math.round(span.timing.duration_ms)} ms
        </span>
        {hasError && <span className="text-anomaly text-xs ml-2">✗</span>}
        {span.anomaly && !hasError && (
          <span
            className="text-warn text-xs ml-2 cursor-help"
            title="This call returned a different type than expected"
          >
            ⚠
          </span>
        )}
      </div>

      {isExpanded && (
        <div className="px-4 pb-3 space-y-2 text-xs">
          <JsonBlock label="Input" value={span.input} />
          <JsonBlock label="Output" value={span.output} />
          {hasError && span.error !== null && (
            <div>
              <p className="text-anomaly font-semibold mb-1">
                {span.error.type}: {span.error.message}
              </p>
              <pre className="text-gray-500 whitespace-pre-wrap text-xs overflow-x-auto max-h-40 font-mono">
                {span.error.stack}
              </pre>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <CopyButton label="Copy JSON" value={JSON.stringify(span, null, 2)} />
          </div>
        </div>
      )}
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }): JSX.Element {
  return (
    <div>
      <span className="text-gray-500 block mb-0.5">{label}</span>
      <pre className="text-gray-300 whitespace-pre-wrap text-xs overflow-x-auto max-h-32 font-mono bg-canvas rounded p-2">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function CopyButton({ label, value }: { label: string; value: string }): JSX.Element {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1_500);
  }, [value]);

  return (
    <button
      onClick={handleCopy}
      className="text-xs px-2 py-1 rounded bg-border text-gray-400 hover:bg-accent/30 hover:text-white transition-colors"
    >
      {copied ? "✓ Copied!" : label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// curl generation
// ---------------------------------------------------------------------------

interface DetectedHttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * Inspects a span's input arguments to detect an HTTP request object.
 * Looks for objects with a `method` field and a `url`, `path`, or `pathname` field.
 * Returns null when the span does not look like an HTTP handler call.
 */
function detectHttpRequest(input: unknown[]): DetectedHttpRequest | null {
  for (const arg of input) {
    if (typeof arg !== "object" || arg === null || Array.isArray(arg)) continue;
    const obj = arg as Record<string, unknown>;
    const hasMethod = typeof obj["method"] === "string";
    const urlField = obj["url"] ?? obj["path"] ?? obj["pathname"];
    if (!hasMethod || typeof urlField !== "string") continue;

    const rawHeaders = obj["headers"];
    const headers: Record<string, string> =
      typeof rawHeaders === "object" && rawHeaders !== null && !Array.isArray(rawHeaders)
        ? Object.fromEntries(
            Object.entries(rawHeaders as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
          )
        : {};

    return {
      method: (obj["method"] as string).toUpperCase(),
      url: urlField,
      headers,
      body: obj["body"] ?? null,
    };
  }
  return null;
}

/**
 * Generates a curl command string from a span that looks like an HTTP handler.
 * Returns null when the span is not an HTTP handler.
 */
function generateCurl(span: StoredSpan): string | null {
  const req = detectHttpRequest(span.input);
  if (req === null) return null;

  const url = req.url.startsWith("http") ? req.url : `http://localhost${req.url}`;
  const parts: string[] = [`curl -X ${req.method} '${url}'`];

  for (const [key, value] of Object.entries(req.headers)) {
    parts.push(`  -H '${key}: ${value}'`);
  }

  if (req.body !== null && req.body !== undefined) {
    parts.push(`  -d '${JSON.stringify(req.body)}'`);
    if (!Object.keys(req.headers).some((k) => k.toLowerCase() === "content-type")) {
      parts.splice(parts.length - 1, 0, "  -H 'Content-Type: application/json'");
    }
  }

  return parts.join(" \\\n");
}
