import { type RunChartPoint } from "@/lib/data/runs";

const BAR_WIDTH = 20;
const BAR_GAP = 4;
const HEIGHT = 160;
const TOP_PAD = 24;
const BOTTOM_PAD = 4;

/**
 * Zero-dependency SVG bar chart of run volume over the last 14 days — stacked
 * succeeded on top, failures overlaid in red. Server-rendered, so the overview
 * stays fast and offline-friendly.
 */
export function RunsChart({ points }: { points: RunChartPoint[] }) {
  const max = Math.max(1, ...points.map((point) => point.total));
  const width = points.length * (BAR_WIDTH + BAR_GAP);
  const baseline = HEIGHT - BOTTOM_PAD;
  const region = baseline - TOP_PAD;

  return (
    <div className="flex items-end gap-2">
      <svg
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        aria-label="Runs per day for the last 14 days"
        className="overflow-visible"
      >
        {points.map((point, index) => {
          const x = index * (BAR_WIDTH + BAR_GAP);
          const totalHeight = Math.max(2, (point.total / max) * region);
          const successHeight = Math.max(2, (point.succeeded / max) * region);
          const failedHeight = Math.max(2, (point.failed / max) * region);
          const totalY = baseline - totalHeight;
          return (
            <g key={point.day.toISOString().slice(0, 10)}>
              <rect
                x={x}
                y={totalY}
                width={BAR_WIDTH}
                height={totalHeight}
                className="fill-secondary"
                rx={2}
              />
              <rect
                x={x}
                y={baseline - successHeight}
                width={BAR_WIDTH}
                height={successHeight}
                className="fill-success"
                opacity={0.95}
                rx={2}
              />
              {point.failed > 0 && (
                <rect
                  x={x}
                  y={baseline - failedHeight}
                  width={BAR_WIDTH}
                  height={failedHeight}
                  className="fill-destructive"
                  rx={2}
                />
              )}
              <title>{`${point.day.toLocaleDateString()}: ${point.total} run(s)`}</title>
            </g>
          );
        })}
      </svg>
      <div className="flex flex-col gap-1 pb-1 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-success" />
          Succeeded
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-destructive" />
          Failed
        </span>
        <span className="mt-1">Last {points.length} days</span>
      </div>
    </div>
  );
}