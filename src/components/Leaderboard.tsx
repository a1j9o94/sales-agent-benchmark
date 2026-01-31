import { useState, useEffect, useMemo } from "react";

export interface LeaderboardEntry {
  rank: number;
  agentId: string;
  agentName?: string | null;
  score: number;
  maxScore: number;
  percentage: number;
  dealsEvaluated: number;
  checkpointsEvaluated?: number;
  avgLatencyMs?: number | null;
  lastRun: string;
  scores?: {
    riskIdentification: number;
    nextStepQuality: number;
    prioritization: number;
    outcomeAlignment: number;
  };
}

// In-memory leaderboard for current session (before persistence kicks in)
const sessionLeaderboard: LeaderboardEntry[] = [];

export function addToLeaderboard(result: {
  agentId: string;
  agentEndpoint: string;
  aggregateScore: number;
  maxPossibleScore: number;
  dealResults: { dealId: string; checkpointEvaluations: { scores: { riskIdentification: number; nextStepQuality: number; prioritization: number; outcomeAlignment: number } }[] }[];
  runTimestamp: string;
  mode?: string;
}) {
  // Calculate average dimension scores
  const totals = { riskIdentification: 0, nextStepQuality: 0, prioritization: 0, outcomeAlignment: 0 };
  let count = 0;
  for (const deal of result.dealResults) {
    for (const cp of deal.checkpointEvaluations) {
      totals.riskIdentification += cp.scores.riskIdentification;
      totals.nextStepQuality += cp.scores.nextStepQuality;
      totals.prioritization += cp.scores.prioritization;
      totals.outcomeAlignment += cp.scores.outcomeAlignment;
      count++;
    }
  }

  const entry: LeaderboardEntry = {
    rank: 0,
    agentId: result.agentId,
    score: result.aggregateScore,
    maxScore: result.maxPossibleScore,
    percentage: Math.round((result.aggregateScore / result.maxPossibleScore) * 100),
    dealsEvaluated: result.dealResults.length,
    checkpointsEvaluated: count,
    lastRun: result.runTimestamp,
    scores: count > 0 ? {
      riskIdentification: totals.riskIdentification / count,
      nextStepQuality: totals.nextStepQuality / count,
      prioritization: totals.prioritization / count,
      outcomeAlignment: totals.outcomeAlignment / count,
    } : undefined,
  };

  // Check if agent already exists
  const existingIndex = sessionLeaderboard.findIndex((e) => e.agentId === result.agentId);
  const existingEntry = existingIndex >= 0 ? sessionLeaderboard[existingIndex] : undefined;
  if (existingEntry) {
    if (entry.percentage > existingEntry.percentage) {
      sessionLeaderboard[existingIndex] = entry;
    }
  } else {
    sessionLeaderboard.push(entry);
  }

  // Re-sort and assign ranks
  sessionLeaderboard.sort((a, b) => b.percentage - a.percentage);
  sessionLeaderboard.forEach((e, i) => (e.rank = i + 1));

  // Also save to persistence API (fire and forget)
  fetch("/api/results", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...result,
      scores: entry.scores,
      checkpointsEvaluated: count,
    }),
  }).catch(console.error);
}

type SortField = "rank" | "percentage" | "riskIdentification" | "nextStepQuality" | "prioritization" | "outcomeAlignment" | "avgLatencyMs";
type SortDirection = "asc" | "desc";

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <div className="relative">
        <span className="text-2xl font-black rank-gold">#1</span>
        <div className="absolute -inset-2 bg-yellow-500/20 blur-xl rounded-full" />
      </div>
    );
  }
  if (rank === 2) {
    return <span className="text-2xl font-bold rank-silver">#2</span>;
  }
  if (rank === 3) {
    return <span className="text-2xl font-bold rank-bronze">#3</span>;
  }
  return <span className="text-xl font-medium text-slate-500">#{rank}</span>;
}

function ScoreBar({ percentage }: { percentage: number }) {
  const color =
    percentage >= 75
      ? "from-emerald-500 to-emerald-400"
      : percentage >= 50
      ? "from-amber-500 to-amber-400"
      : "from-red-500 to-red-400";

  return (
    <div className="relative h-2 bg-navy-800 rounded-full overflow-hidden w-32">
      <div
        className={`absolute inset-y-0 left-0 bg-gradient-to-r ${color} rounded-full transition-all duration-1000`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

// Scatter Plot Component
function ScatterPlot({ entries, onSelectEntry }: { entries: LeaderboardEntry[]; onSelectEntry?: (entry: LeaderboardEntry) => void }) {
  const width = 400;
  const height = 250;
  const padding = { top: 20, right: 30, bottom: 40, left: 50 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  // Calculate scales
  const latencies = entries.map(e => e.avgLatencyMs || 1000).filter(l => l > 0);
  const minLatency = Math.min(...latencies, 100);
  const maxLatency = Math.max(...latencies, 10000);

  // Log scale for X axis (latency)
  const logScale = (value: number) => {
    const logMin = Math.log10(minLatency);
    const logMax = Math.log10(maxLatency);
    const logValue = Math.log10(Math.max(value, minLatency));
    return ((logValue - logMin) / (logMax - logMin)) * plotWidth;
  };

  // Linear scale for Y axis (score percentage)
  const scoreScale = (percentage: number) => {
    return plotHeight - (percentage / 100) * plotHeight;
  };

  // Generate X axis ticks (log scale)
  const xTicks = [100, 500, 1000, 2000, 5000, 10000].filter(t => t >= minLatency && t <= maxLatency);
  const yTicks = [0, 25, 50, 75, 100];

  // Color based on score
  const getColor = (percentage: number) => {
    if (percentage >= 75) return "#10b981"; // emerald
    if (percentage >= 50) return "#f59e0b"; // amber
    return "#ef4444"; // red
  };

  // Point size based on checkpoints
  const getRadius = (checkpoints: number = 1) => {
    return Math.min(Math.max(4 + Math.sqrt(checkpoints) * 2, 6), 16);
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
              x1={padding.left + logScale(tick)}
              y1={padding.top}
              x2={padding.left + logScale(tick)}
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
            <g key={tick} transform={`translate(${padding.left + logScale(tick)}, 0)`}>
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
            Response Time (log scale)
          </text>
        </g>

        {/* Data points */}
        <g transform={`translate(${padding.left}, ${padding.top})`}>
          {entries.map((entry, i) => {
            const x = logScale(entry.avgLatencyMs || 1000);
            const y = scoreScale(entry.percentage);
            const r = getRadius(entry.checkpointsEvaluated);
            const color = getColor(entry.percentage);

            return (
              <g
                key={entry.agentId}
                transform={`translate(${x}, ${y})`}
                className="cursor-pointer transition-transform hover:scale-125"
                onClick={() => onSelectEntry?.(entry)}
              >
                <circle
                  r={r}
                  fill={color}
                  fillOpacity={0.8}
                  stroke={color}
                  strokeWidth={2}
                  style={{ filter: `drop-shadow(0 0 4px ${color})` }}
                />
                {/* Rank label for top 3 */}
                {entry.rank <= 3 && (
                  <text
                    y={-r - 4}
                    textAnchor="middle"
                    className="fill-white text-[10px] font-bold"
                  >
                    #{entry.rank}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

// Sortable Table Header
function SortableHeader({
  label,
  field,
  currentSort,
  currentDirection,
  onSort,
}: {
  label: string;
  field: SortField;
  currentSort: SortField;
  currentDirection: SortDirection;
  onSort: (field: SortField) => void;
}) {
  const isActive = currentSort === field;

  return (
    <button
      onClick={() => onSort(field)}
      className={`flex items-center gap-1 text-xs uppercase tracking-wider transition-colors
        ${isActive ? "text-cyan-400" : "text-slate-500 hover:text-slate-300"}`}
    >
      {label}
      <svg
        className={`w-3 h-3 transition-transform ${isActive && currentDirection === "asc" ? "rotate-180" : ""}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );
}

export function Leaderboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [mode, setMode] = useState<"public" | "private">("private");
  const [sortField, setSortField] = useState<SortField>("rank");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<LeaderboardEntry | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load leaderboard from API
  useEffect(() => {
    const loadLeaderboard = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/leaderboard?mode=${mode}`);
        if (res.ok) {
          const data = await res.json();
          if (data.entries && data.entries.length > 0) {
            setEntries(data.entries);
          } else {
            // Fall back to session data
            setEntries([...sessionLeaderboard]);
          }
        } else {
          setEntries([...sessionLeaderboard]);
        }
      } catch {
        // Fall back to session data
        setEntries([...sessionLeaderboard]);
      } finally {
        setIsLoading(false);
      }
    };

    loadLeaderboard();
  }, [mode]);

  // Handle sort
  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection(field === "avgLatencyMs" ? "asc" : "desc");
    }
  };

  // Filter and sort entries
  const filteredAndSortedEntries = useMemo(() => {
    let result = [...entries];

    // Filter by search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.agentId.toLowerCase().includes(query) ||
          e.agentName?.toLowerCase().includes(query)
      );
    }

    // Sort
    result.sort((a, b) => {
      let aVal: number, bVal: number;

      switch (sortField) {
        case "rank":
          aVal = a.rank;
          bVal = b.rank;
          break;
        case "percentage":
          aVal = a.percentage;
          bVal = b.percentage;
          break;
        case "riskIdentification":
          aVal = a.scores?.riskIdentification ?? 0;
          bVal = b.scores?.riskIdentification ?? 0;
          break;
        case "nextStepQuality":
          aVal = a.scores?.nextStepQuality ?? 0;
          bVal = b.scores?.nextStepQuality ?? 0;
          break;
        case "prioritization":
          aVal = a.scores?.prioritization ?? 0;
          bVal = b.scores?.prioritization ?? 0;
          break;
        case "outcomeAlignment":
          aVal = a.scores?.outcomeAlignment ?? 0;
          bVal = b.scores?.outcomeAlignment ?? 0;
          break;
        case "avgLatencyMs":
          aVal = a.avgLatencyMs ?? 9999999;
          bVal = b.avgLatencyMs ?? 9999999;
          break;
        default:
          aVal = a.rank;
          bVal = b.rank;
      }

      return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
    });

    return result;
  }, [entries, searchQuery, sortField, sortDirection]);

  if (isLoading) {
    return (
      <div className="bg-navy-900/40 rounded-2xl border border-white/5 p-8">
        <div className="flex items-center justify-center gap-3">
          <div className="animate-spin w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full" />
          <span className="text-slate-400">Loading leaderboard...</span>
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="bg-navy-900/40 rounded-2xl border border-white/5 p-8">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-navy-800/50 mb-4">
            <svg className="w-8 h-8 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h4 className="font-semibold text-lg mb-2">Leaderboard</h4>
          <p className="text-slate-500 text-sm max-w-xs mx-auto">
            Run benchmarks to see agents ranked here. Your agent could be #1!
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-navy-900/40 rounded-2xl border border-white/5 overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-white/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-emerald-500 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <div>
              <h4 className="font-semibold">Leaderboard</h4>
              <p className="text-xs text-slate-500">{entries.length} agents ranked</p>
            </div>
          </div>

          {/* Mode Toggle */}
          <div className="flex rounded-lg bg-navy-800/50 p-0.5">
            <button
              onClick={() => setMode("public")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                mode === "public" ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              Public
            </button>
            <button
              onClick={() => setMode("private")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                mode === "private" ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              Private
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="mt-4">
          <input
            type="text"
            placeholder="Search agents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2 rounded-lg bg-navy-800/50 border border-white/5 text-sm
              placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50"
          />
        </div>
      </div>

      {/* Scatter Plot */}
      {filteredAndSortedEntries.some((e) => e.avgLatencyMs) && (
        <div className="p-5 border-b border-white/5">
          <ScatterPlot entries={filteredAndSortedEntries} onSelectEntry={setSelectedEntry} />
        </div>
      )}

      {/* Table Header */}
      <div className="grid grid-cols-12 gap-2 px-5 py-3 bg-navy-800/30 text-xs">
        <div className="col-span-1">
          <SortableHeader label="#" field="rank" currentSort={sortField} currentDirection={sortDirection} onSort={handleSort} />
        </div>
        <div className="col-span-3">Agent</div>
        <div className="col-span-1 text-right">
          <SortableHeader label="Score" field="percentage" currentSort={sortField} currentDirection={sortDirection} onSort={handleSort} />
        </div>
        <div className="col-span-1 text-right">
          <SortableHeader label="Risk" field="riskIdentification" currentSort={sortField} currentDirection={sortDirection} onSort={handleSort} />
        </div>
        <div className="col-span-1 text-right">
          <SortableHeader label="Steps" field="nextStepQuality" currentSort={sortField} currentDirection={sortDirection} onSort={handleSort} />
        </div>
        <div className="col-span-1 text-right">
          <SortableHeader label="Prior." field="prioritization" currentSort={sortField} currentDirection={sortDirection} onSort={handleSort} />
        </div>
        <div className="col-span-1 text-right">
          <SortableHeader label="Align." field="outcomeAlignment" currentSort={sortField} currentDirection={sortDirection} onSort={handleSort} />
        </div>
        <div className="col-span-2 text-right">
          <SortableHeader label="Latency" field="avgLatencyMs" currentSort={sortField} currentDirection={sortDirection} onSort={handleSort} />
        </div>
        <div className="col-span-1 text-right text-slate-500">Deals</div>
      </div>

      {/* Entries */}
      <div className="divide-y divide-white/5">
        {filteredAndSortedEntries.map((entry, idx) => {
          const isSelected = selectedEntry?.agentId === entry.agentId;

          return (
            <div
              key={entry.agentId}
              onClick={() => setSelectedEntry(isSelected ? null : entry)}
              className={`grid grid-cols-12 gap-2 items-center px-5 py-4 cursor-pointer transition-colors
                ${entry.rank === 1 ? "bg-gradient-to-r from-yellow-500/5 to-transparent" : ""}
                ${isSelected ? "bg-cyan-500/10" : "hover:bg-white/[0.02]"}`}
              style={{
                animation: "fade-up 0.5s ease-out forwards",
                animationDelay: `${idx * 0.03}s`,
                opacity: 0,
              }}
            >
              {/* Rank */}
              <div className="col-span-1">
                <RankBadge rank={entry.rank} />
              </div>

              {/* Agent */}
              <div className="col-span-3">
                <div className="font-medium truncate">{entry.agentName || entry.agentId}</div>
                <div className="text-xs text-slate-600 font-mono truncate">{entry.agentId}</div>
              </div>

              {/* Score */}
              <div className="col-span-1 flex flex-col items-end gap-1">
                <div
                  className={`text-lg font-bold tabular-nums ${
                    entry.percentage >= 75
                      ? "text-emerald-400"
                      : entry.percentage >= 50
                      ? "text-amber-400"
                      : "text-red-400"
                  }`}
                >
                  {entry.percentage}%
                </div>
              </div>

              {/* Dimension Scores */}
              <div className="col-span-1 text-right">
                <span className="text-sm tabular-nums text-slate-300">
                  {entry.scores?.riskIdentification?.toFixed(1) ?? "-"}
                </span>
              </div>
              <div className="col-span-1 text-right">
                <span className="text-sm tabular-nums text-slate-300">
                  {entry.scores?.nextStepQuality?.toFixed(1) ?? "-"}
                </span>
              </div>
              <div className="col-span-1 text-right">
                <span className="text-sm tabular-nums text-slate-300">
                  {entry.scores?.prioritization?.toFixed(1) ?? "-"}
                </span>
              </div>
              <div className="col-span-1 text-right">
                <span className="text-sm tabular-nums text-slate-300">
                  {entry.scores?.outcomeAlignment?.toFixed(1) ?? "-"}
                </span>
              </div>

              {/* Latency */}
              <div className="col-span-2 text-right">
                <span className="text-sm tabular-nums text-slate-400">
                  {entry.avgLatencyMs ? `${(entry.avgLatencyMs / 1000).toFixed(2)}s` : "-"}
                </span>
              </div>

              {/* Deals */}
              <div className="col-span-1 text-right">
                <div className="font-medium text-sm">{entry.dealsEvaluated}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Selected Entry Detail */}
      {selectedEntry && (
        <div className="p-5 border-t border-white/5 bg-navy-800/20">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h5 className="font-semibold">{selectedEntry.agentName || selectedEntry.agentId}</h5>
              <p className="text-xs text-slate-500">
                Last run: {new Date(selectedEntry.lastRun).toLocaleString()}
              </p>
            </div>
            <button
              onClick={() => setSelectedEntry(null)}
              className="text-slate-500 hover:text-white"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Score breakdown */}
          {selectedEntry.scores && (
            <div className="grid grid-cols-4 gap-4">
              {[
                { label: "Risk ID", value: selectedEntry.scores.riskIdentification, color: "cyan" },
                { label: "Next Steps", value: selectedEntry.scores.nextStepQuality, color: "emerald" },
                { label: "Priority", value: selectedEntry.scores.prioritization, color: "amber" },
                { label: "Alignment", value: selectedEntry.scores.outcomeAlignment, color: "purple" },
              ].map((dim) => (
                <div key={dim.label} className="bg-navy-900/50 rounded-lg p-3 text-center">
                  <div className="text-xs text-slate-500 mb-1">{dim.label}</div>
                  <div className={`text-xl font-bold text-${dim.color}-400`}>
                    {dim.value.toFixed(1)}
                    <span className="text-slate-600 text-sm">/10</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Leaderboard;
