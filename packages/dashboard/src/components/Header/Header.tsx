import { useCallback, useRef } from "react";
import { useDashboardStore, selectAgentIds } from "../../store/index.js";
import type { StoredSpan } from "../../store/types.js";
import type { ViewMode } from "../../store/types.js";

/**
 * Top header bar.
 *
 * Contains:
 * - Ghost Doc logo + title
 * - Connection status indicator
 * - Connected agents list
 * - Trace rate counter
 * - Search / filter controls
 * - Clear button
 */
export function Header(): JSX.Element {
  const store = useDashboardStore();
  const agentIds = selectAgentIds(store);
  const status = store.connectionStatus;
  const rate = store.tracesPerSecond();
  const filter = store.filter;
  const viewMode = store.viewMode;
  const nodeSearch = store.nodeSearch;
  const compareActive = store.compareSpans !== null;

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleClear = useCallback(() => {
    store.clearSpans();
  }, [store]);

  const handleCompareClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file === undefined) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const spans = JSON.parse(ev.target?.result as string) as StoredSpan[];
          store.loadCompareSnapshot(spans);
        } catch {
          // Silently ignore malformed files.
        }
      };
      reader.readAsText(file);
      // Reset so the same file can be re-loaded.
      e.target.value = "";
    },
    [store],
  );

  return (
    <header className="flex items-center gap-3 px-4 py-2 bg-panel border-b border-border flex-shrink-0">
      {/* Logo */}
      <span className="font-bold text-white tracking-tight mr-2">
        👻 <span className="text-accent">Ghost</span>Doc
      </span>

      {/* Connection status */}
      <ConnectionDot status={status} />

      {/* Agent badges */}
      <div className="flex gap-1 flex-wrap">
        {agentIds.length === 0 ? (
          <span className="text-xs text-gray-600">no agents</span>
        ) : (
          agentIds.map((id) => (
            <button
              key={id}
              onClick={() =>
                store.setFilter({ agentId: filter.agentId === id ? null : id })
              }
              className={`text-xs px-2 py-0.5 rounded font-mono transition-colors ${
                filter.agentId === id
                  ? "bg-accent text-white"
                  : "bg-border text-gray-400 hover:bg-accent/30"
              }`}
            >
              {id}
            </button>
          ))
        )}
      </div>

      {/* Rate */}
      <span className="text-xs font-mono text-gray-500 ml-1">
        {rate}
        <span className="text-gray-600">/s</span>
      </span>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Node highlight search — flowchart only */}
      {viewMode === "flowchart" && (
        <input
          type="search"
          placeholder="Highlight node…"
          value={nodeSearch}
          onChange={(e) => store.setNodeSearch(e.target.value)}
          className="text-xs bg-canvas border border-border rounded px-2 py-1 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-accent w-36"
          title="Highlight matching nodes in the flowchart"
        />
      )}

      {/* Function name search */}
      <input
        type="search"
        placeholder="Filter function…"
        value={filter.functionName}
        onChange={(e) => store.setFilter({ functionName: e.target.value })}
        className="text-xs bg-canvas border border-border rounded px-2 py-1 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-accent w-40"
      />

      {/* Tag search */}
      <input
        type="search"
        placeholder="Filter tag…"
        value={filter.tag}
        onChange={(e) => store.setFilter({ tag: e.target.value })}
        className="text-xs bg-canvas border border-border rounded px-2 py-1 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-accent w-36"
      />

      {/* Group-by selector */}
      <select
        value={filter.groupBy}
        onChange={(e) =>
          store.setFilter({ groupBy: e.target.value as "none" | "agent" | "file" })
        }
        className="text-xs bg-canvas border border-border rounded px-2 py-1 text-gray-300 focus:outline-none focus:border-accent"
        title="Group nodes by…"
        aria-label="Group by"
      >
        <option value="none">No grouping</option>
        <option value="agent">Group by agent</option>
        <option value="file">Group by file</option>
      </select>

      {/* View mode toggle */}
      <ViewToggle viewMode={viewMode} onSelect={(m) => store.setViewMode(m)} />

      {/* Snapshot comparison */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleFileChange}
      />
      {compareActive ? (
        <button
          onClick={() => store.clearCompare()}
          className="text-xs px-3 py-1 rounded bg-green-900/40 text-green-400 hover:bg-anomaly/30 hover:text-anomaly border border-green-800 transition-colors"
          title="Clear snapshot comparison"
        >
          Clear diff
        </button>
      ) : (
        <button
          onClick={handleCompareClick}
          className="text-xs px-3 py-1 rounded bg-border text-gray-400 hover:bg-accent/30 hover:text-accent transition-colors"
          title="Load a snapshot JSON to compare against the current graph"
        >
          Compare…
        </button>
      )}

      {/* Clear */}
      <button
        onClick={handleClear}
        className="text-xs px-3 py-1 rounded bg-border text-gray-400 hover:bg-anomaly/30 hover:text-anomaly transition-colors"
        title="Clear all traces"
      >
        Clear
      </button>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Connection status dot
// ---------------------------------------------------------------------------

const STATUS_CONFIG = {
  connected: { color: "bg-success", pulse: true, label: "Connected" },
  connecting: { color: "bg-warn", pulse: true, label: "Connecting…" },
  disconnected: { color: "bg-anomaly", pulse: false, label: "Disconnected" },
} as const;

// ---------------------------------------------------------------------------
// View mode toggle
// ---------------------------------------------------------------------------

function ViewToggle({
  viewMode,
  onSelect,
}: {
  viewMode: ViewMode;
  onSelect: (mode: ViewMode) => void;
}): JSX.Element {
  return (
    <div className="flex rounded overflow-hidden border border-border text-xs">
      <button
        onClick={() => onSelect("flowchart")}
        className={`px-2.5 py-1 transition-colors ${
          viewMode === "flowchart"
            ? "bg-accent text-white"
            : "bg-canvas text-gray-400 hover:bg-border"
        }`}
        title="Flowchart view"
      >
        Flow
      </button>
      <button
        onClick={() => onSelect("flamegraph")}
        className={`px-2.5 py-1 transition-colors border-l border-border ${
          viewMode === "flamegraph"
            ? "bg-accent text-white"
            : "bg-canvas text-gray-400 hover:bg-border"
        }`}
        title="Flame graph view"
      >
        Flame
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connection status dot
// ---------------------------------------------------------------------------

function ConnectionDot({
  status,
}: {
  status: "connected" | "connecting" | "disconnected";
}): JSX.Element {
  const { color, pulse, label } = STATUS_CONFIG[status];
  return (
    <span className="flex items-center gap-1.5" title={label}>
      <span
        className={`inline-block w-2 h-2 rounded-full ${color} ${
          pulse ? "animate-pulse" : ""
        }`}
      />
      <span className="text-xs text-gray-500">{label}</span>
    </span>
  );
}
