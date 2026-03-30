import { useEffect, useRef } from "react";
import { useDashboardStore } from "../store/index.js";
import type { HubMessage } from "../store/index.js";

/**
 * Resolves the Hub WebSocket URL.
 *
 * Priority:
 *   1. Explicitly provided URL (prop).
 *   2. localStorage "ghost-doc-hub-url" override (E2E tests).
 *   3. Dev mode (Vite dev server) — hardcoded localhost:3001.
 *   4. Production — derive from window.location so the dashboard works when
 *      served by the Hub itself on any host/port.
 */
function resolveHubUrl(provided?: string): string {
  if (provided !== undefined && provided !== "") return provided;
  try {
    const override = window.localStorage.getItem("ghost-doc-hub-url");
    if (override !== null && override !== "") return override;
  } catch {
    // localStorage unavailable (SSR, sandboxed iframe) — fall through.
  }
  if (import.meta.env.DEV) {
    return "ws://localhost:3001/dashboard";
  }
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/dashboard`;
}

/**
 * Connects to the Ghost Doc Hub WebSocket and keeps the Zustand store in sync.
 *
 * Features:
 * - Auto-reconnect with exponential backoff (max 30 s).
 * - Updates `connectionStatus` to "connecting" / "connected" / "disconnected".
 * - Handles both `trace` (single span) and `snapshot` (bulk load) messages.
 * - Cleans up on component unmount.
 */
export function useHubSocket(hubUrl?: string): void {
  const resolvedUrl = resolveHubUrl(hubUrl);
  const addSpan = useDashboardStore((s) => s.addSpan);
  const loadSnapshot = useDashboardStore((s) => s.loadSnapshot);
  const setConnectionStatus = useDashboardStore((s) => s.setConnectionStatus);

  const wsRef = useRef<WebSocket | null>(null);
  const retryDelayRef = useRef<number>(1_000);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;

    function connect(): void {
      if (unmountedRef.current) return;
      setConnectionStatus("connecting");

      const ws = new WebSocket(resolvedUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (unmountedRef.current) { ws.close(); return; }
        retryDelayRef.current = 1_000; // reset backoff on success
        setConnectionStatus("connected");
      };

      ws.onmessage = (evt: MessageEvent<string>) => {
        let msg: HubMessage;
        try {
          msg = JSON.parse(evt.data) as HubMessage;
        } catch {
          return; // ignore malformed messages
        }

        if (msg.type === "trace") {
          addSpan(msg.span);
        } else if (msg.type === "snapshot") {
          loadSnapshot(msg.traces);
        }
      };

      ws.onclose = () => {
        if (unmountedRef.current) return;
        setConnectionStatus("disconnected");
        scheduleReconnect();
      };

      ws.onerror = () => {
        // onerror is always followed by onclose; let onclose handle the retry.
        ws.close();
      };
    }

    function scheduleReconnect(): void {
      if (unmountedRef.current) return;
      retryTimerRef.current = setTimeout(() => {
        retryDelayRef.current = Math.min(retryDelayRef.current * 2, 30_000);
        connect();
      }, retryDelayRef.current);
    }

    connect();

    return () => {
      unmountedRef.current = true;
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
      }
      wsRef.current?.close();
    };
  }, [resolvedUrl, addSpan, loadSnapshot, setConnectionStatus]);
}
