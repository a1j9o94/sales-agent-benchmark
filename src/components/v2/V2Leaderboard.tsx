import { useState, useEffect, useMemo } from "react";
import {
  scoreColor,
  scoreBarColor,
  dimensionLabel,
  dimensionColor,
  taskTypeLabel,
  taskTypeColor,
  V2_DIMENSION_KEYS,
} from "./utils";
import { ScatterPlot } from "@/components/shared/ScatterPlot";
import type { ScoringDimensionKey } from "@/types/benchmark-v2";

interface V2LeaderboardEntry {
  rank: number;
  agentId: string;
  agentName?: string | null;
  score: number;
  maxScore: number;
  percentage: number;
  dealsEvaluated: number;
  checkpointsEvaluated: number;
  tasksEvaluated: number;
  avgTurnsPerTask?: number;
  avgLatencyMs?: number | null;
  lastRun: string;
  dimensions: Record<string, number>;
  taskTypeBreakdown?: Record<string, { avgScore: number; count: number }>;
}

type SortField = "rank" | "percentage" | ScoringDimensionKey | "avgLatencyMs";
type SortDirection = "asc" | "desc";

function ScoreBar({ percentage }: { percentage: number }) {
  const color = scoreBarColor(percentage);
  return (
    <div className="relative h-2 bg-navy-800 rounded-full overflow-hidden w-full">
      <div
        className={`absolute inset-y-0 left-0 bg-gradient-to-r ${color} rounded-full transition-all duration-1000`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <div className="relative">
        <span className="text-2xl font-black rank-gold">#1</span>
        <div className="absolute -inset-2 bg-yellow-500/20 blur-xl rounded-full" />
      </div>
    );
  }
  if (rank === 2) return <span className="text-2xl font-bold rank-silver">#2</span>;
  if (rank === 3) return <span className="text-2xl font-bold rank-bronze">#3</span>;
  return <span className="text-xl font-medium text-slate-500">#{rank}</span>;
}

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

function EntryDetail({ entry, onClose }: { entry: V2LeaderboardEntry; onClose: () => void }) {
  return (
    <div className="p-5 border-t border-white/5 bg-navy-800/20">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h5 className="font-semibold">{entry.agentName || entry.agentId}</h5>
          <p className="text-xs text-slate-500">Last run: {new Date(entry.lastRun).toLocaleString()}</p>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-white">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 8-dimension grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {V2_DIMENSION_KEYS.map((key) => {
          const value = entry.dimensions[key];
          const color = dimensionColor(key);
          return (
            <div key={key} className="bg-navy-900/50 rounded-lg p-3 text-center">
              <div className="text-xs text-slate-500 mb-1">{dimensionLabel(key)}</div>
              <div className={`text-xl font-bold text-${color}-400`}>
                {value !== undefined ? value.toFixed(1) : "-"}
                <span className="text-slate-600 text-sm">/10</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Task type breakdown */}
      {entry.taskTypeBreakdown && Object.keys(entry.taskTypeBreakdown).length > 0 && (
        <div className="mb-4">
          <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">Task Type Breakdown</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {Object.entries(entry.taskTypeBreakdown).map(([type, data]) => {
              const colors = taskTypeColor(type);
              const pct = Math.round((data.avgScore / 10) * 100);
              return (
                <div key={type} className={`${colors.bg} border ${colors.border} rounded-lg p-3`}>
                  <div className={`text-xs font-medium ${colors.text} mb-1`}>{taskTypeLabel(type)}</div>
                  <div className={`text-lg font-bold ${scoreColor(pct)}`}>
                    {data.avgScore.toFixed(1)}
                    <span className="text-slate-600 text-xs"> ({data.count})</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Multi-turn stats */}
      {entry.avgTurnsPerTask !== undefined && (
        <div className="text-xs text-slate-500">
          Avg turns per task: <span className="text-slate-300 font-medium">{entry.avgTurnsPerTask.toFixed(1)}</span>
        </div>
      )}

      {/* View Full Results link */}
      <a
        href={`/results/${encodeURIComponent(entry.agentId)}?type=artifact-based`}
        onClick={(e) => {
          e.preventDefault();
          window.history.pushState({}, "", `/results/${encodeURIComponent(entry.agentId)}?type=artifact-based`);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }}
        className="inline-flex items-center gap-2 mt-4 px-4 py-2.5 bg-cyan-500/10 border border-cyan-500/20 rounded-xl text-cyan-400 text-sm font-medium hover:bg-cyan-500/20 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        View Full Results
      </a>
    </div>
  );
}

export function V2Leaderboard() {
  const [entries, setEntries] = useState<V2LeaderboardEntry[]>([]);
  const [sortField, setSortField] = useState<SortField>("rank");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<V2LeaderboardEntry | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showDimensions, setShowDimensions] = useState(false);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      try {
        const res = await fetch("/api/v2/leaderboard");
        if (res.ok) {
          const data = await res.json();
          if (data.entries?.length > 0) {
            setEntries(data.entries);
          }
        }
      } catch {
        // No data yet
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection(field === "avgLatencyMs" ? "asc" : "desc");
    }
  };

  const filteredAndSorted = useMemo(() => {
    let result = [...entries];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (e) => e.agentId.toLowerCase().includes(q) || e.agentName?.toLowerCase().includes(q)
      );
    }

    result.sort((a, b) => {
      let aVal: number, bVal: number;
      if (sortField === "rank") {
        aVal = a.rank; bVal = b.rank;
      } else if (sortField === "percentage") {
        aVal = a.percentage; bVal = b.percentage;
      } else if (sortField === "avgLatencyMs") {
        aVal = a.avgLatencyMs ?? 9999999; bVal = b.avgLatencyMs ?? 9999999;
      } else {
        aVal = a.dimensions[sortField] ?? 0; bVal = b.dimensions[sortField] ?? 0;
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

  return (
    <>
      {entries.length === 0 ? (
        <div className="bg-navy-900/40 rounded-2xl border border-white/5 p-12 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-navy-800/50 mb-4">
            <svg className="w-8 h-8 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h4 className="font-semibold text-lg mb-2">No Results Yet</h4>
          <p className="text-slate-500 text-sm max-w-sm mx-auto">
            The artifact-based benchmark is being set up. Once agents are evaluated against real-world artifacts, results will appear here.
          </p>
          <div className="mt-6 flex items-center justify-center gap-2 text-sm text-cyan-400">
            <div className="animate-spin w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full" />
            <span>Check back soon</span>
          </div>
        </div>
      ) : (
        <div className="bg-navy-900/40 rounded-2xl border border-white/5 overflow-hidden">
          {/* Header bar */}
          <div className="p-5 border-b border-white/5">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-emerald-500 flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                </div>
                <div>
                  <h4 className="font-semibold">Model Rankings</h4>
                  <p className="text-xs text-slate-500">{entries.length} models, 8 dimensions</p>
                </div>
              </div>
                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <button
                    onClick={() => setShowDimensions(!showDimensions)}
                    className="md:hidden px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-400 hover:bg-white/10"
                  >
                    {showDimensions ? "Hide" : "Show"} Dimensions
                  </button>
                  <input
                    type="text"
                    placeholder="Search models..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="flex-1 sm:w-64 px-4 py-2 rounded-lg bg-navy-800/50 border border-white/5 text-sm
                      placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50"
                  />
                </div>
              </div>
            </div>

            {/* Scatter Plot */}
            {filteredAndSorted.some((e) => e.avgLatencyMs) && (
              <div className="hidden sm:block p-5 border-b border-white/5">
                <ScatterPlot
                  entries={filteredAndSorted.map(e => ({
                    id: e.agentId,
                    name: e.agentName || e.agentId,
                    percentage: e.percentage,
                    avgLatencyMs: e.avgLatencyMs ?? null,
                  }))}
                  onSelectEntry={(sp) => {
                    const match = filteredAndSorted.find(e => e.agentId === sp.id);
                    if (match) setSelectedEntry(match);
                  }}
                />
              </div>
            )}

            {/* Desktop table header */}
            <div className="hidden lg:grid grid-cols-[60px_minmax(150px,2fr)_80px_repeat(8,minmax(60px,1fr))_70px] gap-2 px-6 py-3 bg-navy-800/30 text-xs items-center">
              <div>
                <SortableHeader label="#" field="rank" currentSort={sortField} currentDirection={sortDirection} onSort={handleSort} />
              </div>
              <div className="text-slate-500 uppercase tracking-wider">Agent</div>
              <div className="text-center">
                <SortableHeader label="Score" field="percentage" currentSort={sortField} currentDirection={sortDirection} onSort={handleSort} />
              </div>
              {V2_DIMENSION_KEYS.map((key) => (
                <div key={key} className="text-center">
                  <SortableHeader
                    label={dimensionLabel(key)}
                    field={key}
                    currentSort={sortField}
                    currentDirection={sortDirection}
                    onSort={handleSort}
                  />
                </div>
              ))}
              <div className="text-center">
                <SortableHeader label="Latency" field="avgLatencyMs" currentSort={sortField} currentDirection={sortDirection} onSort={handleSort} />
              </div>
            </div>

            {/* Entries */}
            <div className="divide-y divide-white/5">
              {filteredAndSorted.map((entry, idx) => {
                const isSelected = selectedEntry?.agentId === entry.agentId;
                return (
                  <div key={entry.agentId}>
                    {/* Desktop row */}
                    <div
                      onClick={() => setSelectedEntry(isSelected ? null : entry)}
                      className={`hidden lg:grid grid-cols-[60px_minmax(150px,2fr)_80px_repeat(8,minmax(60px,1fr))_70px] gap-2 items-center px-6 py-4 cursor-pointer transition-colors
                        ${entry.rank === 1 ? "bg-gradient-to-r from-yellow-500/5 to-transparent" : ""}
                        ${isSelected ? "bg-cyan-500/10" : "hover:bg-white/[0.02]"}`}
                      style={{
                        animation: "fade-up 0.5s ease-out forwards",
                        animationDelay: `${idx * 0.03}s`,
                        opacity: 0,
                      }}
                    >
                      <div><RankBadge rank={entry.rank} /></div>
                      <div>
                        <div className="font-medium truncate">{entry.agentName || entry.agentId}</div>
                        <div className="text-xs text-slate-600 font-mono truncate">{entry.agentId}</div>
                      </div>
                      <div className="text-center">
                        <span className={`text-lg font-bold tabular-nums ${scoreColor(entry.percentage)}`}>
                          {entry.percentage}%
                        </span>
                      </div>
                      {V2_DIMENSION_KEYS.map((key) => (
                        <div key={key} className="text-center">
                          <span className="text-sm tabular-nums text-slate-300">
                            {entry.dimensions[key] !== undefined ? entry.dimensions[key]!.toFixed(1) : "-"}
                          </span>
                        </div>
                      ))}
                      <div className="text-center">
                        <span className="text-sm tabular-nums text-slate-400">
                          {entry.avgLatencyMs ? `${(entry.avgLatencyMs / 1000).toFixed(1)}s` : "-"}
                        </span>
                      </div>
                    </div>

                    {/* Mobile / tablet card */}
                    <div
                      onClick={() => setSelectedEntry(isSelected ? null : entry)}
                      className={`lg:hidden p-4 cursor-pointer transition-colors
                        ${entry.rank === 1 ? "bg-gradient-to-r from-yellow-500/5 to-transparent" : ""}
                        ${isSelected ? "bg-cyan-500/10" : "hover:bg-white/[0.02]"}`}
                      style={{
                        animation: "fade-up 0.5s ease-out forwards",
                        animationDelay: `${idx * 0.03}s`,
                        opacity: 0,
                      }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <RankBadge rank={entry.rank} />
                          <div>
                            <div className="font-medium text-sm truncate max-w-[200px]">{entry.agentName || entry.agentId}</div>
                            <div className="text-xs text-slate-600 font-mono truncate max-w-[200px]">{entry.agentId}</div>
                          </div>
                        </div>
                        <span className={`text-lg font-bold tabular-nums ${scoreColor(entry.percentage)}`}>
                          {entry.percentage}%
                        </span>
                      </div>
                      {showDimensions && (
                        <div className="grid grid-cols-4 gap-2 mt-2 text-xs text-slate-500">
                          {V2_DIMENSION_KEYS.map((key) => (
                            <div key={key} className="text-center">
                              <div className="text-[10px] text-slate-600">{dimensionLabel(key)}</div>
                              <div className="text-slate-300 font-medium">
                                {entry.dimensions[key] !== undefined ? entry.dimensions[key]!.toFixed(1) : "-"}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {isSelected && <EntryDetail entry={entry} onClose={() => setSelectedEntry(null)} />}
                  </div>
                );
              })}
            </div>
          </div>
        )}
    </>
  );
}

export default V2Leaderboard;
