import { describe, it, expect, beforeEach } from "vitest";
import {
  useDashboardStore,
  selectAgentIds,
  selectTimeRange,
  selectAnomalyTimestamps,
} from "../src/store/index.js";
import { makeSpan } from "./fixtures.js";

// Reset the store before each test.
beforeEach(() => {
  useDashboardStore.getState().clearSpans();
  useDashboardStore.setState({
    selectedNodeId: null,
    connectionStatus: "connecting",
    rateWindow: [],
    timeTravel: { seekTs: null, isPlaying: false, playbackSpeed: 1 },
    filter: { agentId: null, functionName: "", tag: "", groupBy: "none", nodeFilter: "all" },
  });
});

describe("addSpan", () => {
  it("appends span to the store", () => {
    const span = makeSpan();
    useDashboardStore.getState().addSpan(span);
    expect(useDashboardStore.getState().spans).toHaveLength(1);
  });

  it("updates graph nodes on new span", () => {
    useDashboardStore.getState().addSpan(makeSpan());
    const { graph } = useDashboardStore.getState();
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]?.functionName).toBe("doSomething");
  });

  it("increments node callCount across multiple spans", () => {
    useDashboardStore.getState().addSpan(makeSpan());
    useDashboardStore.getState().addSpan(makeSpan());
    const node = useDashboardStore.getState().graph.nodes[0];
    expect(node?.callCount).toBe(2);
  });
});

describe("loadSnapshot", () => {
  it("replaces existing spans", () => {
    useDashboardStore.getState().addSpan(makeSpan());
    const fresh = [makeSpan(), makeSpan()];
    useDashboardStore.getState().loadSnapshot(fresh);
    expect(useDashboardStore.getState().spans).toHaveLength(2);
  });
});

describe("clearSpans", () => {
  it("resets spans and graph", () => {
    useDashboardStore.getState().addSpan(makeSpan());
    useDashboardStore.getState().clearSpans();
    expect(useDashboardStore.getState().spans).toHaveLength(0);
    expect(useDashboardStore.getState().graph.nodes).toHaveLength(0);
  });
});

describe("selectedNodeSpans", () => {
  it("returns spans belonging to the selected node, newest first", () => {
    const older = makeSpan({ span_id: "aaaa-0000-4000-8000-000000000001", received_at: 1000 });
    const newer = makeSpan({ span_id: "aaaa-0000-4000-8000-000000000002", received_at: 2000 });
    useDashboardStore.getState().addSpan(older);
    useDashboardStore.getState().addSpan(newer);
    useDashboardStore.getState().selectNode("test-agent:doSomething");

    const result = useDashboardStore.getState().selectedNodeSpans();
    expect(result[0]?.span_id).toBe(newer.span_id);
    expect(result[1]?.span_id).toBe(older.span_id);
  });

  it("returns empty array when no node is selected", () => {
    useDashboardStore.getState().addSpan(makeSpan());
    expect(useDashboardStore.getState().selectedNodeSpans()).toHaveLength(0);
  });
});

describe("time-travel seekTo", () => {
  it("filters graph to only spans before seekTs", () => {
    const t = Date.now();
    const past = makeSpan({ received_at: t - 5000 });
    const future = makeSpan({
      received_at: t + 5000,
      source: {
        agent_id: "test-agent",
        language: "js",
        file: "f.ts",
        line: 1,
        function_name: "futureFunc",
      },
    });
    useDashboardStore.getState().addSpan(past);
    useDashboardStore.getState().addSpan(future);

    useDashboardStore.getState().seekTo(t);

    const { graph } = useDashboardStore.getState();
    expect(graph.nodes.every((n) => n.functionName !== "futureFunc")).toBe(true);
  });

  it("seekTo(null) restores live graph", () => {
    const t = Date.now();
    useDashboardStore.getState().addSpan(makeSpan({ received_at: t }));
    useDashboardStore.getState().seekTo(t - 10000);
    useDashboardStore.getState().seekTo(null);

    expect(useDashboardStore.getState().graph.nodes).toHaveLength(1);
    expect(useDashboardStore.getState().timeTravel.seekTs).toBeNull();
  });
});

describe("filter setFilter", () => {
  it("filters graph by agent", () => {
    useDashboardStore.getState().addSpan(
      makeSpan({
        source: {
          agent_id: "frontend",
          language: "js",
          file: "f.ts",
          line: 1,
          function_name: "fn",
        },
      }),
    );
    useDashboardStore.getState().addSpan(
      makeSpan({
        source: {
          agent_id: "backend",
          language: "python",
          file: "b.py",
          line: 1,
          function_name: "fn2",
        },
      }),
    );

    useDashboardStore.getState().setFilter({ agentId: "frontend" });
    const { graph } = useDashboardStore.getState();
    expect(graph.nodes.every((n) => n.agentId === "frontend")).toBe(true);
  });

  it("filters by function name (case-insensitive substring)", () => {
    useDashboardStore.getState().addSpan(
      makeSpan({
        source: {
          agent_id: "a",
          language: "js",
          file: "f.ts",
          line: 1,
          function_name: "handleLogin",
        },
      }),
    );
    useDashboardStore.getState().addSpan(
      makeSpan({
        source: {
          agent_id: "a",
          language: "js",
          file: "f.ts",
          line: 2,
          function_name: "fetchUser",
        },
      }),
    );

    useDashboardStore.getState().setFilter({ functionName: "login" });
    const { graph } = useDashboardStore.getState();
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]?.functionName).toBe("handleLogin");
  });
});

describe("selectors", () => {
  it("selectAgentIds returns sorted unique agent IDs", () => {
    useDashboardStore.getState().addSpan(
      makeSpan({
        source: {
          agent_id: "z-agent",
          language: "js",
          file: "f.ts",
          line: 1,
          function_name: "fn",
        },
      }),
    );
    useDashboardStore.getState().addSpan(
      makeSpan({
        source: {
          agent_id: "a-agent",
          language: "js",
          file: "f.ts",
          line: 1,
          function_name: "fn",
        },
      }),
    );
    const ids = selectAgentIds(useDashboardStore.getState());
    expect(ids).toEqual(["a-agent", "z-agent"]);
  });

  it("selectTimeRange returns min/max received_at", () => {
    useDashboardStore.getState().addSpan(makeSpan({ received_at: 1000 }));
    useDashboardStore.getState().addSpan(makeSpan({ received_at: 3000 }));
    const range = selectTimeRange(useDashboardStore.getState());
    expect(range?.min).toBe(1000);
    expect(range?.max).toBe(3000);
  });

  it("selectTimeRange returns null when store is empty", () => {
    expect(selectTimeRange(useDashboardStore.getState())).toBeNull();
  });

  it("selectAnomalyTimestamps returns only anomalous span timestamps", () => {
    useDashboardStore.getState().addSpan(makeSpan({ received_at: 100, anomaly: false }));
    useDashboardStore.getState().addSpan(makeSpan({ received_at: 200, anomaly: true }));
    const ticks = selectAnomalyTimestamps(useDashboardStore.getState());
    expect(ticks).toEqual([200]);
  });
});
