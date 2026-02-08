export interface ScatterPlotEntry {
  id: string;
  name: string;
  percentage: number;
  avgLatencyMs: number | null;
}

interface ScatterPlotProps {
  entries: ScatterPlotEntry[];
  onSelectEntry?: (entry: ScatterPlotEntry) => void;
}

export function ScatterPlot({ entries, onSelectEntry }: ScatterPlotProps) {
  const width = 600;
  const height = 280;
  const padding = { top: 20, right: 100, bottom: 40, left: 50 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const latencies = entries.map(e => e.avgLatencyMs || 1000).filter(l => l > 0);
  const scores = entries.map(e => e.percentage);

  const dataMinLatency = Math.min(...latencies);
  const dataMaxLatency = Math.max(...latencies);
  const latencyRange = dataMaxLatency - dataMinLatency;
  const minLatency = Math.max(100, dataMinLatency - latencyRange * 0.3);
  const maxLatency = dataMaxLatency + latencyRange * 0.3;

  const dataMinScore = Math.min(...scores);
  const dataMaxScore = Math.max(...scores);
  const scoreRange = Math.max(dataMaxScore - dataMinScore, 10);
  const minScore = Math.max(0, Math.floor((dataMinScore - scoreRange * 0.3) / 5) * 5);
  const maxScore = Math.min(100, Math.ceil((dataMaxScore + scoreRange * 0.3) / 5) * 5);

  const latencyScale = (value: number) => {
    return ((value - minLatency) / (maxLatency - minLatency)) * plotWidth;
  };

  const scoreScale = (percentage: number) => {
    return plotHeight - ((percentage - minScore) / (maxScore - minScore)) * plotHeight;
  };

  const latencyStep = Math.ceil((maxLatency - minLatency) / 4 / 1000) * 1000 || 5000;
  const xTicks: number[] = [];
  for (let t = Math.ceil(minLatency / latencyStep) * latencyStep; t <= maxLatency; t += latencyStep) {
    xTicks.push(t);
  }

  const yTicks: number[] = [];
  const yStep = Math.ceil((maxScore - minScore) / 4 / 5) * 5 || 5;
  for (let t = minScore; t <= maxScore; t += yStep) {
    yTicks.push(t);
  }

  const getColor = (percentage: number) => {
    if (percentage >= 75) return "#10b981";
    if (percentage >= 50) return "#f59e0b";
    return "#ef4444";
  };

  return (
    <div className="bg-navy-900/50 rounded-xl border border-white/5 p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4 className="font-semibold text-sm">Efficiency vs Effectiveness</h4>
          <p className="text-xs text-slate-500">Lower latency, higher score = better</p>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500" /> &ge;75%
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-500" /> &ge;50%
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-500" /> &lt;50%
          </span>
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
        {/* Grid lines */}
        <g className="text-slate-700">
          {yTicks.map(tick => (
            <line
              key={`y-${tick}`}
              x1={padding.left}
              y1={padding.top + scoreScale(tick)}
              x2={width - padding.right}
              y2={padding.top + scoreScale(tick)}
              stroke="currentColor"
              strokeOpacity={0.2}
              strokeDasharray={tick === 50 ? "none" : "2 4"}
            />
          ))}
          {xTicks.map(tick => (
            <line
              key={`x-${tick}`}
              x1={padding.left + latencyScale(tick)}
              y1={padding.top}
              x2={padding.left + latencyScale(tick)}
              y2={height - padding.bottom}
              stroke="currentColor"
              strokeOpacity={0.2}
              strokeDasharray="2 4"
            />
          ))}
        </g>

        {/* Y Axis */}
        <g transform={`translate(${padding.left}, 0)`}>
          <line y1={padding.top} y2={height - padding.bottom} stroke="rgba(255,255,255,0.2)" />
          {yTicks.map(tick => (
            <g key={tick} transform={`translate(0, ${padding.top + scoreScale(tick)})`}>
              <text x={-8} textAnchor="end" dominantBaseline="middle" className="fill-slate-500 text-[10px]">
                {tick}%
              </text>
            </g>
          ))}
          <text
            transform={`translate(-35, ${padding.top + plotHeight / 2}) rotate(-90)`}
            textAnchor="middle"
            className="fill-slate-400 text-[10px] font-medium"
          >
            Score
          </text>
        </g>

        {/* X Axis */}
        <g transform={`translate(0, ${height - padding.bottom})`}>
          <line x1={padding.left} x2={width - padding.right} stroke="rgba(255,255,255,0.2)" />
          {xTicks.map(tick => (
            <g key={tick} transform={`translate(${padding.left + latencyScale(tick)}, 0)`}>
              <text y={20} textAnchor="middle" className="fill-slate-500 text-[10px]">
                {tick >= 1000 ? `${tick / 1000}s` : `${tick}ms`}
              </text>
            </g>
          ))}
          <text
            x={padding.left + plotWidth / 2}
            y={35}
            textAnchor="middle"
            className="fill-slate-400 text-[10px] font-medium"
          >
            Response Time
          </text>
        </g>

        {/* Data points */}
        <g transform={`translate(${padding.left}, ${padding.top})`}>
          {entries.map((entry) => {
            const x = latencyScale(entry.avgLatencyMs || 1000);
            const y = scoreScale(entry.percentage);
            const r = 4;
            const color = getColor(entry.percentage);
            const latencyStr = entry.avgLatencyMs ? `${(entry.avgLatencyMs / 1000).toFixed(1)}s` : "N/A";
            const shortName = entry.name.length > 12 ? entry.name.slice(0, 11) + "\u2026" : entry.name;

            return (
              <g
                key={entry.id}
                transform={`translate(${x}, ${y})`}
                className="cursor-pointer"
                onClick={() => onSelectEntry?.(entry)}
              >
                <title>{`${entry.name}\nScore: ${entry.percentage}%\nLatency: ${latencyStr}`}</title>
                <circle r={12} fill="transparent" />
                <circle
                  r={r}
                  fill={color}
                  fillOpacity={0.9}
                  stroke={color}
                  strokeWidth={1.5}
                  style={{ filter: `drop-shadow(0 0 3px ${color})` }}
                />
                <text
                  x={r + 4}
                  y={1}
                  dominantBaseline="middle"
                  className="fill-slate-300 text-[8px] font-medium pointer-events-none"
                >
                  {shortName}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

export default ScatterPlot;
