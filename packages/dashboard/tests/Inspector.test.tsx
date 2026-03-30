import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useDashboardStore } from "../src/store/index.js";
import { Inspector } from "../src/components/Inspector/Inspector.js";
import { makeSpan } from "./fixtures.js";

beforeEach(() => {
  useDashboardStore.getState().clearSpans();
  useDashboardStore.setState({ selectedNodeId: null });
});

describe("Inspector", () => {
  it("shows empty-state prompt when no node is selected", () => {
    render(<Inspector />);
    expect(screen.getByText(/Click a node/i)).toBeInTheDocument();
  });

  it("shows function name when a node is selected", () => {
    const span = makeSpan({ source: { agent_id: "frontend", language: "js", file: "f.ts", line: 1, function_name: "handleLogin" } });
    useDashboardStore.getState().addSpan(span);
    useDashboardStore.getState().selectNode("frontend:handleLogin");

    render(<Inspector />);
    expect(screen.getByText("handleLogin")).toBeInTheDocument();
  });

  it("shows agent badge", () => {
    const span = makeSpan({ source: { agent_id: "my-agent", language: "js", file: "f.ts", line: 1, function_name: "fn" } });
    useDashboardStore.getState().addSpan(span);
    useDashboardStore.getState().selectNode("my-agent:fn");

    render(<Inspector />);
    expect(screen.getByText("my-agent")).toBeInTheDocument();
  });

  it("shows anomaly badge when node has anomaly", () => {
    const span = makeSpan({ anomaly: true });
    useDashboardStore.getState().addSpan(span);
    useDashboardStore.getState().selectNode("test-agent:doSomething");

    render(<Inspector />);
    expect(screen.getByText(/anomaly/i)).toBeInTheDocument();
  });

  it("shows error badge when node has error", () => {
    const span = makeSpan({ error: { type: "TypeError", message: "bad", stack: "..." } });
    useDashboardStore.getState().addSpan(span);
    useDashboardStore.getState().selectNode("test-agent:doSomething");

    render(<Inspector />);
    expect(screen.getByText(/error/i)).toBeInTheDocument();
  });

  it("shows call count stat", () => {
    useDashboardStore.getState().addSpan(makeSpan());
    useDashboardStore.getState().addSpan(makeSpan());
    useDashboardStore.getState().selectNode("test-agent:doSomething");

    render(<Inspector />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("expands span detail on row click", async () => {
    const span = makeSpan({ output: "hello-world" });
    useDashboardStore.getState().addSpan(span);
    useDashboardStore.getState().selectNode("test-agent:doSomething");

    const { container } = render(<Inspector />);

    // Click the first span row (the clickable div wrapping each call).
    const row = container.querySelector(".cursor-pointer");
    expect(row).not.toBeNull();
    await userEvent.click(row!);

    expect(screen.getByText(/"hello-world"/i)).toBeInTheDocument();
  });
});
