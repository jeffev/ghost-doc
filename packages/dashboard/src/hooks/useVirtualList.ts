import { useState, useRef, useCallback, type RefObject } from "react";

export interface VirtualListOptions {
  /** Total number of items in the list. */
  itemCount: number;
  /** Height of a single collapsed row in pixels. */
  rowHeight: number;
  /** Number of extra rows to render above and below the visible window. */
  overscan?: number;
}

export interface VirtualListResult {
  /** Ref to attach to the scrollable container element. */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Index of the first rendered item. */
  startIndex: number;
  /** Index of the last rendered item (exclusive). */
  endIndex: number;
  /** Total scroll height for the spacer div (= itemCount * rowHeight). */
  totalHeight: number;
  /** Top offset (px) for the first rendered item. */
  offsetTop: number;
  /** Call this on the container's onScroll event. */
  onScroll: () => void;
}

/**
 * Minimal virtual list hook — no dependencies required.
 *
 * Renders only the rows visible in the scroll container plus `overscan` rows
 * above and below. Falls back gracefully when `itemCount` is small.
 */
export function useVirtualList({
  itemCount,
  rowHeight,
  overscan = 5,
}: VirtualListOptions): VirtualListResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const onScroll = useCallback(() => {
    if (containerRef.current !== null) {
      setScrollTop(containerRef.current.scrollTop);
    }
  }, []);

  const containerHeight = containerRef.current?.clientHeight ?? 400;
  const totalHeight = itemCount * rowHeight;

  const rawStart = Math.floor(scrollTop / rowHeight);
  const rawEnd = Math.ceil((scrollTop + containerHeight) / rowHeight);

  const startIndex = Math.max(0, rawStart - overscan);
  const endIndex = Math.min(itemCount, rawEnd + overscan);
  const offsetTop = startIndex * rowHeight;

  return { containerRef, startIndex, endIndex, totalHeight, offsetTop, onScroll };
}
