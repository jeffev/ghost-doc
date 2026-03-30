/**
 * Inline sparkline showing the distribution of execution durations.
 * Renders as a tiny SVG bar chart.
 */
interface SparklineProps {
  durations: number[];
  width?: number;
  height?: number;
}

export function Sparkline({ durations, width = 120, height = 24 }: SparklineProps): JSX.Element {
  if (durations.length === 0) {
    return <span className="text-gray-600 text-xs">no data</span>;
  }

  const max = Math.max(...durations);
  const barW = Math.max(1, Math.floor(width / durations.length) - 1);

  return (
    <svg width={width} height={height} className="inline-block align-middle">
      {durations.map((d, i) => {
        const barH = max > 0 ? Math.max(1, Math.round((d / max) * height)) : 1;
        return (
          <rect
            key={i}
            x={i * (barW + 1)}
            y={height - barH}
            width={barW}
            height={barH}
            fill="#6366f1"
            opacity={0.7}
          />
        );
      })}
    </svg>
  );
}
