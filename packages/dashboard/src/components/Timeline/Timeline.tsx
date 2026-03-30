import { useCallback, useEffect, useRef } from "react";
import { useDashboardStore, selectTimeRange, selectAnomalyTimestamps } from "../../store/index.js";
import type { PlaybackSpeed } from "../../store/types.js";

const SPEEDS: PlaybackSpeed[] = [0.5, 1, 2, 10];

/**
 * Time-travel timeline bar.
 *
 * - Shows a horizontal scrubber spanning the time range of recorded spans.
 * - Anomalous spans appear as red ticks above the track.
 * - "Live" button snaps back to real-time mode.
 * - Playback controls let the user replay at 0.5×–10×.
 */
export function Timeline(): JSX.Element {
  const store = useDashboardStore();
  const timeRange = selectTimeRange(store);
  const anomalyTimestamps = selectAnomalyTimestamps(store);
  const { seekTs, isPlaying, playbackSpeed } = store.timeTravel;
  const isLive = seekTs === null;

  // Playback interval.
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        useDashboardStore.getState().tickPlayback();
      }, 200); // tick every 200 ms regardless of playback speed (speed is applied inside tickPlayback)
    } else {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current !== null) clearInterval(intervalRef.current);
    };
  }, [isPlaying]);

  const handleScrub = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (timeRange === null) return;
      const pct = Number(e.target.value) / 1000;
      const ts = timeRange.min + pct * (timeRange.max - timeRange.min);
      store.seekTo(ts);
    },
    [timeRange, store],
  );

  const handleLive = useCallback(() => {
    store.seekTo(null);
  }, [store]);

  const togglePlay = useCallback(() => {
    if (isLive && timeRange !== null) {
      // Start from the beginning.
      store.seekTo(timeRange.min);
      store.setPlaying(true);
    } else {
      store.setPlaying(!isPlaying);
    }
  }, [isLive, isPlaying, timeRange, store]);

  // Compute scrubber value (0–1000).
  const scrubValue =
    timeRange === null || isLive
      ? 1000
      : Math.round(
          ((( seekTs ?? timeRange.max) - timeRange.min) /
            Math.max(timeRange.max - timeRange.min, 1)) *
            1000,
        );

  // Compute anomaly tick positions as percentages.
  const anomalyPcts =
    timeRange !== null
      ? anomalyTimestamps.map((ts) =>
          Math.round(
            ((ts - timeRange.min) / Math.max(timeRange.max - timeRange.min, 1)) * 100,
          ),
        )
      : [];

  const formattedSeek =
    seekTs !== null ? new Date(seekTs).toLocaleTimeString() : "Live";

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-panel border-t border-border select-none">
      {/* Play / Pause */}
      <button
        onClick={togglePlay}
        className="w-7 h-7 flex items-center justify-center rounded bg-border hover:bg-accent/30 text-white transition-colors"
        title={isPlaying ? "Pause playback" : "Play from start"}
      >
        {isPlaying ? "⏸" : "▶"}
      </button>

      {/* Speed selector */}
      <div className="flex gap-1">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => store.setPlaybackSpeed(s)}
            className={`px-2 py-0.5 rounded text-xs font-mono transition-colors ${
              playbackSpeed === s
                ? "bg-accent text-white"
                : "bg-border text-gray-400 hover:bg-accent/30"
            }`}
          >
            {s}×
          </button>
        ))}
      </div>

      {/* Scrubber track */}
      <div className="relative flex-1 h-6 flex items-center">
        {/* Anomaly ticks */}
        {anomalyPcts.map((pct, i) => (
          <span
            key={i}
            className="absolute w-0.5 h-3 bg-anomaly rounded-full"
            style={{ left: `${pct}%`, top: 0 }}
          />
        ))}
        <input
          type="range"
          min={0}
          max={1000}
          value={scrubValue}
          onChange={handleScrub}
          className="w-full accent-accent"
          disabled={timeRange === null}
        />
      </div>

      {/* Current position label */}
      <span className="text-xs font-mono text-gray-400 w-20 text-right">
        {formattedSeek}
      </span>

      {/* Live button */}
      <button
        onClick={handleLive}
        className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
          isLive
            ? "bg-success/20 text-success border border-success/40"
            : "bg-border text-gray-400 hover:bg-success/20 hover:text-success"
        }`}
      >
        ● Live
      </button>
    </div>
  );
}
