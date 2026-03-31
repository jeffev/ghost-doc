import { useEffect, useRef } from "react";
import { useDashboardStore } from "../store/index.js";

/**
 * Global keyboard shortcuts for the Ghost Doc dashboard.
 *
 * Shortcuts (active when focus is NOT inside an input/textarea):
 *
 *   Esc        — close inspector (deselect node)
 *   f          — fit flowchart to screen
 *   c          — clear all traces (with confirmation)
 *   /          — focus the "Filter function…" search input
 *   v          — toggle view mode (flowchart ↔ flamegraph)
 *   Space      — toggle time-travel play/pause
 */
export function useKeyboardShortcuts(
  /** Callback to fit the flowchart to screen — wired up by useD3Graph */
  onFitGraph?: () => void,
): void {
  const store = useDashboardStore();
  // Keep a stable ref to store so the event listener doesn't need re-registration
  const storeRef = useRef(store);
  storeRef.current = store;

  const fitRef = useRef(onFitGraph);
  fitRef.current = onFitGraph;

  useEffect(() => {
    function isInputFocused(): boolean {
      const el = document.activeElement;
      if (el === null) return false;
      const tag = el.tagName.toLowerCase();
      return (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        (el as HTMLElement).isContentEditable
      );
    }

    function handleKeyDown(e: KeyboardEvent): void {
      const s = storeRef.current;

      // Always allow Escape even if an input is focused
      if (e.key === "Escape") {
        // Blur any focused input first
        (document.activeElement as HTMLElement | null)?.blur();
        s.selectNode(null);
        return;
      }

      if (isInputFocused()) return;

      switch (e.key) {
        case "f":
        case "F":
          fitRef.current?.();
          break;

        case "c":
        case "C":
          // Require Shift+C to avoid accidental clears
          if (e.shiftKey) {
            s.clearSpans();
          }
          break;

        case "/":
          e.preventDefault();
          document
            .querySelector<HTMLInputElement>('input[placeholder="Filter function…"]')
            ?.focus();
          break;

        case " ":
          e.preventDefault();
          if (s.timeTravel.seekTs !== null) {
            s.setPlaying(!s.timeTravel.isPlaying);
          }
          break;

        case "v":
        case "V":
          s.setViewMode(s.viewMode === "flowchart" ? "flamegraph" : "flowchart");
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
