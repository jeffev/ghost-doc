import { useEffect, useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionCall {
  function: string;
  spanId: string;
  traceId: string;
  args: unknown[];
  return: unknown;
  durationMs: number;
  error: { type: string; message: string } | null;
  sequence: number;
}

interface SessionSnapshot {
  session: string;
  startTime: string;
  endTime: string;
  calls: SessionCall[];
}

interface SessionMeta {
  name: string;
  session: string;
  callCount: number;
  startTime: string;
  endTime: string;
}

interface SessionDiff {
  addedFunctions: string[];
  removedFunctions: string[];
  changedReturnShapes: Array<{ function: string; before: unknown; after: unknown }>;
  changedErrorRate: Array<{ function: string; before: number; after: number }>;
  latencyRegression: Array<{
    function: string;
    beforeP95Ms: number;
    afterP95Ms: number;
    changePercent: number;
  }>;
}

interface MockServerStatus {
  running: boolean;
  session?: string;
  port?: number;
  mode?: string;
  url?: string;
}

type TopTabView = "sessions" | "diff" | "server";

// ---------------------------------------------------------------------------
// Main tab
// ---------------------------------------------------------------------------

export function MocksTab(): JSX.Element {
  const [tabView, setTabView] = useState<TopTabView>("sessions");
  return (
    <div className="flex flex-col h-full overflow-hidden text-sm">
      <div className="flex border-b border-border flex-shrink-0">
        {(["sessions", "diff", "server"] as TopTabView[]).map((t) => (
          <TopTab key={t} active={tabView === t} onClick={() => setTabView(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </TopTab>
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        {tabView === "sessions" && <SessionsPanel />}
        {tabView === "diff" && <DiffPanel />}
        {tabView === "server" && <ServerPanel />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sessions panel
// ---------------------------------------------------------------------------

function SessionsPanel(): JSX.Element {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [selected, setSelected] = useState<SessionSnapshot | null>(null);
  const [selectedMeta, setSelectedMeta] = useState<SessionMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordName, setRecordName] = useState("");
  const [exporting, setExporting] = useState(false);
  const [fnFilter, setFnFilter] = useState("");
  const [showErrors, setShowErrors] = useState<"all" | "errors" | "success">("all");
  const [detailCall, setDetailCall] = useState<SessionCall | null>(null);
  const [sessionView, setSessionView] = useState<"calls" | "timeline">("calls");

  // Inline actions
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeSelected, setMergeSelected] = useState<Set<string>>(new Set());
  const [mergeName, setMergeName] = useState("");

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/mock/sessions");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSessions((await res.json()) as SessionMeta[]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  const loadSession = useCallback(async (meta: SessionMeta) => {
    setSelectedMeta(meta);
    setFnFilter("");
    setShowErrors("all");
    setSessionView("calls");
    try {
      const res = await fetch(`/mock/sessions/${encodeURIComponent(meta.name)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSelected((await res.json()) as SessionSnapshot);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const handleRecord = useCallback(async () => {
    if (!recordName.trim()) return;
    setRecording(true);
    try {
      const res = await fetch("/mock/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: recordName.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRecordName("");
      await fetchSessions();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRecording(false);
    }
  }, [recordName, fetchSessions]);

  const handleDelete = useCallback(
    async (name: string) => {
      try {
        await fetch(`/mock/sessions/${encodeURIComponent(name)}`, { method: "DELETE" });
        if (selectedMeta?.name === name) {
          setSelected(null);
          setSelectedMeta(null);
        }
        await fetchSessions();
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [selectedMeta, fetchSessions],
  );

  const handleClone = useCallback(
    async (name: string, sessionLabel: string) => {
      const newName = prompt(`Clone name:`, `${sessionLabel}-copy`);
      if (!newName) return;
      try {
        await fetch(`/mock/sessions/${encodeURIComponent(name)}/clone`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName }),
        });
        await fetchSessions();
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [fetchSessions],
  );

  const handleRename = useCallback(
    async (name: string) => {
      if (!renameValue.trim()) return;
      try {
        await fetch(`/mock/sessions/${encodeURIComponent(name)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: renameValue.trim() }),
        });
        setRenaming(null);
        setRenameValue("");
        if (selectedMeta?.name === name) {
          setSelected(null);
          setSelectedMeta(null);
        }
        await fetchSessions();
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [renameValue, selectedMeta, fetchSessions],
  );

  const handleMerge = useCallback(async () => {
    if (mergeSelected.size < 2 || !mergeName.trim()) return;
    try {
      await fetch("/mock/sessions/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessions: [...mergeSelected], name: mergeName.trim() }),
      });
      setMergeMode(false);
      setMergeSelected(new Set());
      setMergeName("");
      await fetchSessions();
    } catch (err) {
      setError((err as Error).message);
    }
  }, [mergeSelected, mergeName, fetchSessions]);

  const handleExport = useCallback(
    async (target: "jest" | "vitest" | "pytest") => {
      if (!selected) return;
      setExporting(true);
      try {
        const code = generateMocksLocally(selected, target);
        const ext = target === "pytest" ? ".py" : ".ts";
        downloadFile(`${selected.session}${ext}`, code);
      } finally {
        setExporting(false);
      }
    },
    [selected],
  );

  const handleExportOpenApi = useCallback(
    async (format: "json" | "yaml") => {
      if (!selectedMeta) return;
      try {
        const res = await fetch(
          `/mock/sessions/${encodeURIComponent(selectedMeta.name)}/openapi?format=${format}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const content =
          format === "yaml" ? await res.text() : JSON.stringify(await res.json(), null, 2);
        downloadFile(`${selectedMeta.session}-openapi.${format}`, content);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [selectedMeta],
  );

  const handleExportPostman = useCallback(() => {
    if (!selected) return;
    const collection = generatePostmanCollection(selected);
    downloadFile(`${selected.session}-postman.json`, JSON.stringify(collection, null, 2));
  }, [selected]);

  const filteredCalls =
    selected?.calls.filter((c) => {
      if (fnFilter && !c.function.toLowerCase().includes(fnFilter.toLowerCase())) return false;
      if (showErrors === "errors" && !c.error) return false;
      if (showErrors === "success" && c.error) return false;
      return true;
    }) ?? [];

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left */}
      <div className="w-72 flex-shrink-0 border-r border-border flex flex-col">
        {/* Record form */}
        <div className="p-3 border-b border-border flex-shrink-0">
          <div className="text-xs font-semibold text-gray-400 mb-2">Record session</div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="session-name"
              value={recordName}
              onChange={(e) => setRecordName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleRecord();
              }}
              className="flex-1 text-xs bg-canvas border border-border rounded px-2 py-1 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-accent"
            />
            <button
              onClick={() => void handleRecord()}
              disabled={recording || !recordName.trim()}
              className="text-xs px-2 py-1 rounded bg-accent/20 text-accent hover:bg-accent/30 transition-colors disabled:opacity-40"
            >
              {recording ? "…" : "Save"}
            </button>
          </div>
        </div>

        {/* Session list header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-panel">
          <span className="text-xs font-semibold text-gray-400">Sessions</span>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setMergeMode((v) => !v);
                setMergeSelected(new Set());
              }}
              className={`text-xs transition-colors ${mergeMode ? "text-accent" : "text-gray-600 hover:text-accent"}`}
              title="Merge sessions"
            >
              ⊕
            </button>
            <button
              onClick={() => void fetchSessions()}
              className="text-xs text-gray-500 hover:text-accent"
              title="Refresh"
            >
              ↻
            </button>
          </div>
        </div>

        {/* Merge controls */}
        {mergeMode && (
          <div className="px-3 py-2 border-b border-border bg-canvas/50 flex-shrink-0">
            <div className="text-xs text-gray-500 mb-2">Select ≥ 2 sessions to merge:</div>
            <input
              type="text"
              placeholder="merged-session-name"
              value={mergeName}
              onChange={(e) => setMergeName(e.target.value)}
              className="w-full text-xs bg-canvas border border-border rounded px-2 py-1 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-accent mb-2"
            />
            <button
              onClick={() => void handleMerge()}
              disabled={mergeSelected.size < 2 || !mergeName.trim()}
              className="w-full text-xs px-2 py-1 rounded bg-accent/20 text-accent hover:bg-accent/30 transition-colors disabled:opacity-40"
            >
              Merge ({mergeSelected.size} selected)
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading && <div className="px-3 py-4 text-gray-600 text-xs">Loading…</div>}
          {error && <div className="px-3 py-2 text-red-400 text-xs">{error}</div>}
          {!loading && sessions.length === 0 && (
            <div className="px-3 py-4 text-gray-600 text-xs">No sessions yet.</div>
          )}

          {sessions.map((s) => (
            <div
              key={s.name}
              className={`border-b border-border/50 transition-colors ${selectedMeta?.name === s.name ? "bg-accent/20" : "hover:bg-canvas/50"}`}
            >
              {renaming === s.name ? (
                <div className="flex gap-1 px-3 py-2">
                  <input
                    autoFocus
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleRename(s.name);
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    className="flex-1 text-xs bg-canvas border border-accent rounded px-1 text-gray-300 focus:outline-none"
                  />
                  <button
                    onClick={() => void handleRename(s.name)}
                    className="text-xs text-accent hover:text-white"
                  >
                    ✓
                  </button>
                  <button
                    onClick={() => setRenaming(null)}
                    className="text-xs text-gray-600 hover:text-gray-400"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <div
                  className="flex items-start px-3 py-2 cursor-pointer"
                  onClick={() => {
                    if (mergeMode) {
                      setMergeSelected((prev) => {
                        const n = new Set(prev);
                        if (n.has(s.name)) {
                          n.delete(s.name);
                        } else {
                          n.add(s.name);
                        }
                        return n;
                      });
                    } else {
                      void loadSession(s);
                    }
                  }}
                >
                  {mergeMode && (
                    <input
                      type="checkbox"
                      checked={mergeSelected.has(s.name)}
                      readOnly
                      className="mr-2 mt-0.5 accent-accent flex-shrink-0"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div
                      className={`font-mono truncate text-xs ${selectedMeta?.name === s.name ? "text-accent" : "text-gray-300"}`}
                    >
                      {s.session}
                    </div>
                    <div className="text-xs text-gray-600 mt-0.5">
                      {s.callCount} calls ·{" "}
                      {new Date(s.startTime).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                  {!mergeMode && (
                    <div
                      className="flex gap-1 ml-1 flex-shrink-0 opacity-0 group-hover:opacity-100"
                      style={{ opacity: undefined }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => {
                          setRenaming(s.name);
                          setRenameValue(s.session);
                        }}
                        className="text-xs text-gray-600 hover:text-accent transition-colors"
                        title="Rename"
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => void handleClone(s.name, s.session)}
                        className="text-xs text-gray-600 hover:text-accent transition-colors"
                        title="Clone"
                      >
                        ⎘
                      </button>
                      <button
                        onClick={() => void handleDelete(s.name)}
                        className="text-xs text-gray-600 hover:text-red-400 transition-colors"
                        title="Delete"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Right */}
      {selected === null ? (
        <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
          Select a session
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 border-b border-border flex items-center gap-3 flex-shrink-0 flex-wrap">
            <span className="font-mono font-semibold text-accent">{selected.session}</span>
            <span className="text-xs text-gray-600">
              {selected.calls.length} calls ·{" "}
              {[...new Set(selected.calls.map((c) => c.function))].length} fns
            </span>
            <div className="flex-1" />
            <ExportMenu
              label="Export mocks ▾"
              disabled={exporting}
              items={[
                { label: "Jest", onClick: () => void handleExport("jest") },
                { label: "Vitest", onClick: () => void handleExport("vitest") },
                { label: "pytest", onClick: () => void handleExport("pytest") },
              ]}
            />
            <ExportMenu
              label="OpenAPI ▾"
              items={[
                { label: "JSON", onClick: () => void handleExportOpenApi("json") },
                { label: "YAML", onClick: () => void handleExportOpenApi("yaml") },
              ]}
            />
            <button
              onClick={handleExportPostman}
              className="text-xs px-2 py-1 rounded bg-border text-gray-400 hover:bg-accent/20 hover:text-accent transition-colors"
            >
              Postman
            </button>
          </div>

          {/* Function summary chips */}
          <div className="flex gap-2 px-4 py-2 border-b border-border flex-wrap flex-shrink-0">
            {[...new Set(selected.calls.map((c) => c.function))].sort().map((fn) => {
              const calls = selected.calls.filter((c) => c.function === fn);
              const errors = calls.filter((c) => c.error).length;
              const avgMs = Math.round(calls.reduce((s, c) => s + c.durationMs, 0) / calls.length);
              return (
                <span
                  key={fn}
                  className="text-xs px-2 py-1 rounded bg-canvas border border-border text-gray-400"
                >
                  <span className="font-mono text-gray-300">{fn}</span>
                  <span className="ml-1.5 text-gray-600">{calls.length}×</span>
                  {errors > 0 && <span className="ml-1 text-red-400">{errors} err</span>}
                  <span className="ml-1 text-gray-700">{avgMs}ms avg</span>
                </span>
              );
            })}
          </div>

          {/* View toggle + filters */}
          <div className="flex items-center gap-3 px-4 py-2 border-b border-border flex-shrink-0">
            <div className="flex rounded overflow-hidden border border-border text-xs">
              {(["calls", "timeline"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setSessionView(v)}
                  className={`px-2.5 py-1 transition-colors ${v !== "calls" ? "border-l border-border" : ""} ${sessionView === v ? "bg-accent text-white" : "bg-canvas text-gray-400 hover:bg-border"}`}
                >
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
            {sessionView === "calls" && (
              <>
                <input
                  type="search"
                  placeholder="Filter function…"
                  value={fnFilter}
                  onChange={(e) => setFnFilter(e.target.value)}
                  className="text-xs bg-canvas border border-border rounded px-2 py-1 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-accent w-40"
                />
                <div className="flex gap-1">
                  {(["all", "errors", "success"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setShowErrors(v)}
                      className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                        showErrors === v
                          ? v === "errors"
                            ? "bg-red-900/50 text-red-400 border-red-800"
                            : v === "success"
                              ? "bg-green-900/40 text-green-400 border-green-800"
                              : "bg-accent/20 text-accent border-accent/50"
                          : "bg-canvas border-border text-gray-600 hover:text-gray-400"
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-gray-600 ml-auto">
                  {filteredCalls.length} / {selected.calls.length}
                </span>
              </>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {sessionView === "calls" ? (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-panel border-b border-border">
                  <tr>
                    <th className="text-left px-4 py-2 text-gray-600 font-medium w-8">#</th>
                    <th className="text-left px-4 py-2 text-gray-600 font-medium">Function</th>
                    <th className="text-left px-4 py-2 text-gray-600 font-medium">Args</th>
                    <th className="text-left px-4 py-2 text-gray-600 font-medium">
                      Return / Error
                    </th>
                    <th className="text-right px-4 py-2 text-gray-600 font-medium">ms</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCalls.map((call, i) => (
                    <tr
                      key={i}
                      onClick={() => setDetailCall(call)}
                      className={`border-b border-border/40 cursor-pointer ${call.error ? "bg-red-950/20 hover:bg-red-950/30" : "hover:bg-canvas/60"}`}
                    >
                      <td className="px-4 py-2 text-gray-600 tabular-nums">{call.sequence}</td>
                      <td className="px-4 py-2 font-mono text-gray-300 truncate max-w-[140px]">
                        {call.function}
                      </td>
                      <td className="px-4 py-2 font-mono text-gray-500 truncate max-w-[180px]">
                        {JSON.stringify(call.args)}
                      </td>
                      <td className="px-4 py-2 font-mono truncate max-w-[200px]">
                        {call.error ? (
                          <span className="text-red-400">
                            {call.error.type}: {call.error.message}
                          </span>
                        ) : (
                          <span className="text-gray-400">{JSON.stringify(call.return)}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 tabular-nums text-right text-gray-500">
                        {call.durationMs}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <TimelineView calls={selected.calls} onSelect={setDetailCall} />
            )}
          </div>
        </div>
      )}

      {/* Call detail modal */}
      {detailCall && <CallDetailModal call={detailCall} onClose={() => setDetailCall(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline view
// ---------------------------------------------------------------------------

function TimelineView({
  calls,
  onSelect,
}: {
  calls: SessionCall[];
  onSelect: (c: SessionCall) => void;
}): JSX.Element {
  if (calls.length === 0) return <div className="p-4 text-gray-600 text-xs">No calls.</div>;

  const fns = [...new Set(calls.map((c) => c.function))].sort();
  const maxDuration = Math.max(...calls.map((c) => c.durationMs), 1);
  const totalSpan = calls.length;

  const colors = [
    "bg-blue-500",
    "bg-purple-500",
    "bg-teal-500",
    "bg-orange-500",
    "bg-pink-500",
    "bg-indigo-500",
    "bg-yellow-500",
    "bg-green-500",
  ];
  const fnColor = new Map(fns.map((fn, i) => [fn, colors[i % colors.length]!]));

  return (
    <div className="p-4">
      {/* Legend */}
      <div className="flex flex-wrap gap-3 mb-4">
        {fns.map((fn) => (
          <span key={fn} className="flex items-center gap-1.5 text-xs text-gray-400">
            <span className={`w-2.5 h-2.5 rounded-sm ${fnColor.get(fn)}`} />
            {fn}
          </span>
        ))}
      </div>

      {/* Rows by function */}
      <div className="space-y-3">
        {fns.map((fn) => {
          const fnCalls = calls.filter((c) => c.function === fn);
          return (
            <div key={fn}>
              <div className="text-xs text-gray-500 mb-1 font-mono">{fn}</div>
              <div className="relative h-6 bg-canvas border border-border rounded overflow-hidden">
                {fnCalls.map((call) => {
                  const left = ((call.sequence - 1) / totalSpan) * 100;
                  const width = Math.max((call.durationMs / maxDuration) * 30, 0.5);
                  return (
                    <div
                      key={call.spanId}
                      title={`seq:${call.sequence} ${call.durationMs}ms`}
                      onClick={() => onSelect(call)}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      className={`absolute top-0 h-full cursor-pointer opacity-80 hover:opacity-100 transition-opacity ${call.error ? "bg-red-500" : fnColor.get(fn)}`}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Sequence axis */}
      <div className="flex justify-between mt-2 text-xs text-gray-700">
        <span>seq 1</span>
        <span>seq {totalSpan}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Call detail modal
// ---------------------------------------------------------------------------

function CallDetailModal({
  call,
  onClose,
}: {
  call: SessionCall;
  onClose: () => void;
}): JSX.Element {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-border rounded-lg w-full max-w-2xl max-h-[80vh] overflow-y-auto m-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-accent text-sm">{call.function}</span>
            <span className="text-xs text-gray-600">
              seq #{call.sequence} · {call.durationMs}ms
            </span>
            {call.error && (
              <span className="text-xs bg-red-900/50 text-red-400 px-1.5 py-0.5 rounded">
                error
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors text-lg"
          >
            ✕
          </button>
        </div>
        <div className="p-4 space-y-4">
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Args
            </h3>
            <pre className="text-xs font-mono bg-canvas border border-border rounded p-3 text-gray-300 whitespace-pre-wrap overflow-x-auto">
              {JSON.stringify(call.args, null, 2)}
            </pre>
          </section>
          {call.error ? (
            <section>
              <h3 className="text-xs font-semibold text-red-500 uppercase tracking-wider mb-2">
                Error
              </h3>
              <pre className="text-xs font-mono bg-red-950/20 border border-red-900/50 rounded p-3 text-red-300 whitespace-pre-wrap overflow-x-auto">
                {JSON.stringify(call.error, null, 2)}
              </pre>
            </section>
          ) : (
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Return
              </h3>
              <pre className="text-xs font-mono bg-canvas border border-border rounded p-3 text-green-300 whitespace-pre-wrap overflow-x-auto">
                {JSON.stringify(call.return, null, 2)}
              </pre>
            </section>
          )}
          <div className="text-xs text-gray-600 font-mono">
            spanId: {call.spanId} · traceId: {call.traceId}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diff panel
// ---------------------------------------------------------------------------

function DiffPanel(): JSX.Element {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [beforeName, setBeforeName] = useState("");
  const [afterName, setAfterName] = useState("");
  const [threshold, setThreshold] = useState(0);
  const [result, setResult] = useState<{
    diff: SessionDiff;
    breaking: boolean;
    before: string;
    after: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/mock/sessions")
      .then((r) => r.json())
      .then((d) => setSessions(d as SessionMeta[]))
      .catch(() => {});
  }, []);

  const handleDiff = useCallback(async () => {
    if (!beforeName || !afterName) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/mock/sessions/diff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ before: beforeName, after: afterName, threshold }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      setResult(await res.json());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [beforeName, afterName, threshold]);

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-64 flex-shrink-0 border-r border-border p-4 flex flex-col gap-4">
        <div>
          <div className="text-xs font-semibold text-gray-400 mb-2">Baseline (before)</div>
          <select
            value={beforeName}
            onChange={(e) => setBeforeName(e.target.value)}
            className="w-full text-xs bg-canvas border border-border rounded px-2 py-1.5 text-gray-300 focus:outline-none focus:border-accent"
          >
            <option value="">— select —</option>
            {sessions.map((s) => (
              <option key={s.name} value={s.name}>
                {s.session}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="text-xs font-semibold text-gray-400 mb-2">Current (after)</div>
          <select
            value={afterName}
            onChange={(e) => setAfterName(e.target.value)}
            className="w-full text-xs bg-canvas border border-border rounded px-2 py-1.5 text-gray-300 focus:outline-none focus:border-accent"
          >
            <option value="">— select —</option>
            {sessions.map((s) => (
              <option key={s.name} value={s.name}>
                {s.session}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500">Latency threshold</span>
            <span className="text-xs font-mono text-accent">{threshold}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="w-full accent-accent"
          />
        </div>
        <button
          onClick={() => void handleDiff()}
          disabled={loading || !beforeName || !afterName || beforeName === afterName}
          className="text-xs px-3 py-2 rounded bg-accent/20 text-accent hover:bg-accent/30 transition-colors disabled:opacity-40 font-medium"
        >
          {loading ? "Comparing…" : "Compare sessions"}
        </button>
        {error && <div className="text-xs text-red-400">{error}</div>}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {!result && !loading && (
          <div className="text-gray-600 text-sm flex items-center justify-center h-full">
            Select two sessions and compare
          </div>
        )}
        {result && (
          <div className="space-y-5 max-w-2xl">
            <div
              className={`flex items-center gap-2 px-3 py-2 rounded border text-sm font-semibold ${result.breaking ? "bg-red-950/40 border-red-800 text-red-400" : "bg-green-950/40 border-green-800 text-green-400"}`}
            >
              {result.breaking ? "⚠ Breaking changes" : "✓ No breaking changes"}
              <span className="font-normal text-xs opacity-70">
                {result.before} → {result.after}
              </span>
            </div>
            {result.diff.addedFunctions.length > 0 && (
              <DiffSection title="Added functions" color="text-green-400">
                {result.diff.addedFunctions.map((fn) => (
                  <DiffRow
                    key={fn}
                    label={fn}
                    badge="new"
                    badgeColor="bg-green-900/50 text-green-400"
                  />
                ))}
              </DiffSection>
            )}
            {result.diff.removedFunctions.length > 0 && (
              <DiffSection title="Removed functions" color="text-red-400">
                {result.diff.removedFunctions.map((fn) => (
                  <DiffRow
                    key={fn}
                    label={fn}
                    badge="removed"
                    badgeColor="bg-red-900/50 text-red-400"
                  />
                ))}
              </DiffSection>
            )}
            {result.diff.changedReturnShapes.length > 0 && (
              <DiffSection title="Changed return shapes" color="text-orange-400">
                {result.diff.changedReturnShapes.map((ch) => (
                  <div key={ch.function} className="mb-3">
                    <div className="font-mono text-xs text-gray-300 mb-1">{ch.function}</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-xs text-gray-600 mb-1">before</div>
                        <pre className="text-xs font-mono bg-canvas border border-border rounded p-2 text-red-300 whitespace-pre-wrap overflow-x-auto">
                          {JSON.stringify(ch.before, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <div className="text-xs text-gray-600 mb-1">after</div>
                        <pre className="text-xs font-mono bg-canvas border border-border rounded p-2 text-green-300 whitespace-pre-wrap overflow-x-auto">
                          {JSON.stringify(ch.after, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </div>
                ))}
              </DiffSection>
            )}
            {result.diff.changedErrorRate.length > 0 && (
              <DiffSection title="Error rate changes" color="text-yellow-400">
                {result.diff.changedErrorRate.map((ch) => (
                  <DiffRow
                    key={ch.function}
                    label={ch.function}
                    badge={`${(ch.before * 100).toFixed(0)}% → ${(ch.after * 100).toFixed(0)}%`}
                    badgeColor={
                      ch.after > ch.before
                        ? "bg-red-900/50 text-red-400"
                        : "bg-green-900/50 text-green-400"
                    }
                  />
                ))}
              </DiffSection>
            )}
            {result.diff.latencyRegression.length > 0 && (
              <DiffSection title={`Latency regressions (>${threshold}%)`} color="text-orange-400">
                {result.diff.latencyRegression.map((r) => (
                  <DiffRow
                    key={r.function}
                    label={r.function}
                    badge={`${r.beforeP95Ms}ms → ${r.afterP95Ms}ms (+${r.changePercent}%)`}
                    badgeColor="bg-orange-900/50 text-orange-400"
                  />
                ))}
              </DiffSection>
            )}
            {Object.values(result.diff).every((v) => (v as unknown[]).length === 0) && (
              <div className="text-gray-500 text-xs">Sessions are identical.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HTTP Mock Server panel
// ---------------------------------------------------------------------------

function ServerPanel(): JSX.Element {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [status, setStatus] = useState<MockServerStatus>({ running: false });
  const [session, setSession] = useState("");
  const [port, setPort] = useState(8080);
  const [mode, setMode] = useState<"exact" | "round-robin" | "latency-preserving">("exact");
  const [faultErrorRate, setFaultErrorRate] = useState(0);
  const [faultLatency, setFaultLatency] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/mock/server/status");
      if (res.ok) setStatus(await res.json());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
    fetch("/mock/sessions")
      .then((r) => r.json())
      .then((d) => setSessions(d as SessionMeta[]))
      .catch(() => {});
    const timer = setInterval(() => void fetchStatus(), 5000);
    return () => clearInterval(timer);
  }, [fetchStatus]);

  const handleStart = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/mock/server/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session,
          port,
          mode,
          faultErrorRate: faultErrorRate > 0 ? faultErrorRate / 100 : undefined,
          faultLatency: faultLatency !== 1 ? faultLatency : undefined,
        }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error: string }).error);
      await fetchStatus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [session, port, mode, faultErrorRate, faultLatency, fetchStatus]);

  const handleStop = useCallback(async () => {
    setLoading(true);
    try {
      await fetch("/mock/server/stop", { method: "POST" });
      await fetchStatus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [fetchStatus]);

  return (
    <div className="p-6 max-w-lg">
      <h2 className="text-sm font-semibold text-gray-300 mb-4">HTTP Mock Server</h2>

      {/* Status */}
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded border mb-5 text-xs ${status.running ? "bg-green-950/40 border-green-800 text-green-400" : "bg-canvas border-border text-gray-500"}`}
      >
        <span
          className={`w-2 h-2 rounded-full ${status.running ? "bg-green-400 animate-pulse" : "bg-gray-600"}`}
        />
        {status.running ? (
          <>
            <span className="font-semibold">Running</span>
            <span className="font-mono">{status.url}</span>
            <span className="opacity-70">
              · {status.session} · {status.mode}
            </span>
          </>
        ) : (
          "Not running"
        )}
      </div>

      {status.running ? (
        <div className="space-y-3">
          <div className="text-xs text-gray-500">
            Serving session <span className="font-mono text-accent">{status.session}</span> on port{" "}
            <span className="font-mono">{status.port}</span> in{" "}
            <span className="font-mono">{status.mode}</span> mode.
          </div>
          <div className="text-xs text-gray-600">
            Each recorded function is available at{" "}
            <span className="font-mono">POST {status.url ?? ""}/:functionName</span>
          </div>
          <button
            onClick={() => void handleStop()}
            disabled={loading}
            className="text-xs px-3 py-2 rounded bg-red-900/40 text-red-400 hover:bg-red-900/60 transition-colors disabled:opacity-40 font-medium"
          >
            {loading ? "Stopping…" : "Stop server"}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Session</label>
            <select
              value={session}
              onChange={(e) => setSession(e.target.value)}
              className="w-full text-xs bg-canvas border border-border rounded px-2 py-1.5 text-gray-300 focus:outline-none focus:border-accent"
            >
              <option value="">— select session —</option>
              {sessions.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.session}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Port</label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                className="w-full text-xs bg-canvas border border-border rounded px-2 py-1.5 text-gray-300 focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Mode</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
                className="w-full text-xs bg-canvas border border-border rounded px-2 py-1.5 text-gray-300 focus:outline-none focus:border-accent"
              >
                <option value="exact">exact</option>
                <option value="round-robin">round-robin</option>
                <option value="latency-preserving">latency-preserving</option>
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Fault injection
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400 w-28">Error rate</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={faultErrorRate}
                onChange={(e) => setFaultErrorRate(Number(e.target.value))}
                className="flex-1 accent-red-400"
              />
              <span className="text-xs font-mono text-red-400 w-8">{faultErrorRate}%</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400 w-28">Latency factor</span>
              <input
                type="range"
                min={1}
                max={10}
                step={0.5}
                value={faultLatency}
                onChange={(e) => setFaultLatency(Number(e.target.value))}
                className="flex-1 accent-yellow-400"
              />
              <span className="text-xs font-mono text-yellow-400 w-8">{faultLatency}×</span>
            </div>
          </div>
          {error && <div className="text-xs text-red-400">{error}</div>}
          <button
            onClick={() => void handleStart()}
            disabled={loading || !session}
            className="text-xs px-4 py-2 rounded bg-accent/20 text-accent hover:bg-accent/30 transition-colors disabled:opacity-40 font-medium w-full"
          >
            {loading ? "Starting…" : "Start mock server"}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diff helpers
// ---------------------------------------------------------------------------

function DiffSection({
  title,
  color,
  children,
}: {
  title: string;
  color: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section>
      <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${color}`}>{title}</h3>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function DiffRow({
  label,
  badge,
  badgeColor,
}: {
  label: string;
  badge: string;
  badgeColor: string;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded bg-canvas border border-border/50">
      <span className="font-mono text-xs text-gray-300 flex-1 truncate">{label}</span>
      <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${badgeColor}`}>{badge}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export menu
// ---------------------------------------------------------------------------

function ExportMenu({
  label,
  items,
  disabled = false,
}: {
  label: string;
  items: Array<{ label: string; onClick: () => void }>;
  disabled?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="text-xs px-2 py-1 rounded bg-border text-gray-400 hover:bg-accent/20 hover:text-accent transition-colors disabled:opacity-50"
      >
        {label}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-32 bg-panel border border-border rounded shadow-lg z-50">
            {items.map((item) => (
              <button
                key={item.label}
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
                className="w-full text-left text-xs px-3 py-2 text-gray-300 hover:bg-accent/20 hover:text-white transition-colors border-b border-border last:border-0"
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Postman collection generator
// ---------------------------------------------------------------------------

function generatePostmanCollection(session: SessionSnapshot): unknown {
  const groups = new Map<string, SessionCall[]>();
  for (const call of session.calls) {
    const arr = groups.get(call.function) ?? [];
    arr.push(call);
    groups.set(call.function, arr);
  }

  return {
    info: {
      name: session.session,
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: [...groups.entries()].map(([fnName, calls]) => ({
      name: fnName,
      item: calls.map((call, i) => ({
        name: `${fnName} #${call.sequence}${call.error ? " (error)" : ""}`,
        request: {
          method: "POST",
          header: [{ key: "Content-Type", value: "application/json" }],
          body: { mode: "raw", raw: JSON.stringify(call.args, null, 2) },
          url: {
            raw: `http://127.0.0.1:8080/${fnName}`,
            protocol: "http",
            host: ["127", "0", "0", "1"],
            port: "8080",
            path: [fnName],
          },
          description: `Recorded call #${i + 1} · ${call.durationMs}ms`,
        },
        response: [
          {
            name: call.error ? "Error response" : "Success response",
            originalRequest: {
              method: "POST",
              header: [],
              url: { raw: `http://127.0.0.1:8080/${fnName}` },
            },
            status: call.error ? "Internal Server Error" : "OK",
            code: call.error ? 500 : 200,
            header: [{ key: "Content-Type", value: "application/json" }],
            body: JSON.stringify(call.error ?? call.return, null, 2),
          },
        ],
      })),
    })),
  };
}

// ---------------------------------------------------------------------------
// Mock generator
// ---------------------------------------------------------------------------

function toCamelCase(name: string): string {
  return name.replace(/[_-](\w)/g, (_, c: string) => c.toUpperCase());
}
function toMockName(fnName: string): string {
  const c = toCamelCase(fnName);
  return `mock${(c[0] ?? "").toUpperCase()}${c.slice(1)}`;
}
function toPythonFnName(name: string): string {
  return name
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "");
}

function generateMocksLocally(
  session: SessionSnapshot,
  target: "jest" | "vitest" | "pytest",
): string {
  const groups = new Map<string, SessionCall[]>();
  for (const call of session.calls) {
    const arr = groups.get(call.function) ?? [];
    arr.push(call);
    groups.set(call.function, arr);
  }

  if (target === "pytest") {
    const lines = [`# auto-generated by ghost-doc — session: ${session.session}`, ""];
    for (const [fnName, calls] of groups) {
      const pyName = `mock_${toPythonFnName(fnName)}`;
      if (calls.length === 1) {
        const call = calls[0]!;
        if (call.error)
          lines.push(
            `def ${pyName}(*args, **kwargs):`,
            `    raise Exception(${JSON.stringify(call.error)})`,
            "",
          );
        else
          lines.push(
            `def ${pyName}(*args, **kwargs):`,
            `    return ${JSON.stringify(call.return)}`,
            "",
          );
      } else {
        lines.push(
          `_${pyName}_calls = 0`,
          `_${pyName}_responses = [${calls.map((c) => (c.error ? `{"__error__": ${JSON.stringify(c.error)}}` : JSON.stringify(c.return))).join(", ")}]`,
          "",
          `def ${pyName}(*args, **kwargs):`,
          `    global _${pyName}_calls`,
          `    resp = _${pyName}_responses[_${pyName}_calls % len(_${pyName}_responses)]`,
          `    _${pyName}_calls += 1`,
          `    if isinstance(resp, dict) and "__error__" in resp: raise Exception(resp["__error__"])`,
          `    return resp`,
          "",
        );
      }
    }
    return lines.join("\n");
  }

  const mockFn = `${target === "vitest" ? "vi" : "jest"}.fn()`;
  const lines = [`// auto-generated by ghost-doc — session: ${session.session}`, ""];
  if (target === "vitest") lines.push('import { vi } from "vitest";', "");
  for (const [fnName, calls] of groups) {
    const name = toMockName(fnName);
    if (calls.length === 1) {
      const call = calls[0]!;
      lines.push(
        call.error
          ? `export const ${name} = ${mockFn}.mockRejectedValue(${JSON.stringify(call.error)});`
          : `export const ${name} = ${mockFn}.mockResolvedValue(${JSON.stringify(call.return)});`,
        "",
      );
    } else {
      lines.push(
        `export const ${name} = ${mockFn}\n${calls.map((c) => (c.error ? `  .mockRejectedValueOnce(${JSON.stringify(c.error)})` : `  .mockResolvedValueOnce(${JSON.stringify(c.return)})`)).join("\n")};`,
        "",
      );
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function downloadFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function TopTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`px-5 py-2 text-xs font-medium transition-colors border-b-2 ${active ? "border-accent text-accent" : "border-transparent text-gray-500 hover:text-gray-300"}`}
    >
      {children}
    </button>
  );
}
