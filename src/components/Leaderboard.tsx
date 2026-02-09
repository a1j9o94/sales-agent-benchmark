import { useState, useEffect, useMemo, useRef } from "react";
import { ScatterPlot } from "@/components/shared/ScatterPlot";
import type { ScatterPlotEntry } from "@/components/shared/ScatterPlot";

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

// Column descriptions for tooltips
const columnDescriptions: Record<string, string> = {
  riskIdentification: "Risk Identification: How well does the model identify deal risks and blockers? (0-10, higher is better)",
  nextStepQuality: "Next Step Quality: How actionable and relevant are the suggested next steps? (0-10, higher is better)",
  prioritization: "Prioritization: Does the model focus on what matters most for the deal? (0-10, higher is better)",
  outcomeAlignment: "Outcome Alignment: Are recommendations aligned with closing the deal? (0-10, higher is better)",
  avgLatencyMs: "Avg Response Time: Mean time to generate a response across all checkpoints (lower is faster)",
  percentage: "Overall Score: Aggregate score across all evaluation dimensions",
  rank: "Rank: Position based on overall score",
};

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
  const description = columnDescriptions[field];

  return (
    <button
      onClick={() => onSort(field)}
      title={description}
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

function EntryDetailPanel({ entry, onClose }: { entry: LeaderboardEntry; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [judgeData, setJudgeData] = useState<any[]>([]);
  const [activeJudgeIdx, setActiveJudgeIdx] = useState(0);
  const [isLoadingJudges, setIsLoadingJudges] = useState(false);

  // Auto-scroll into view
  useEffect(() => {
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);

  // Fetch judge evaluations
  useEffect(() => {
    (async () => {
      setIsLoadingJudges(true);
      try {
        const res = await fetch(`/api/agent-results/${encodeURIComponent(entry.agentId)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.judgeEvaluations?.length > 0) {
            // Group by judgeModel, compute per-judge averages
            const byJudge = new Map<string, { scores: number[]; count: number; model: string }>();
            for (const eval_ of data.judgeEvaluations) {
              const existing = byJudge.get(eval_.judgeModel) || { scores: [0,0,0,0], count: 0, model: eval_.judgeModel };
              existing.scores[0] += eval_.scores.riskIdentification;
              existing.scores[1] += eval_.scores.nextStepQuality;
              existing.scores[2] += eval_.scores.prioritization;
              existing.scores[3] += eval_.scores.outcomeAlignment;
              existing.count++;
              byJudge.set(eval_.judgeModel, existing);
            }
            setJudgeData(Array.from(byJudge.entries()).map(([model, data]) => ({
              model,
              scores: {
                riskIdentification: data.scores[0]! / data.count,
                nextStepQuality: data.scores[1]! / data.count,
                prioritization: data.scores[2]! / data.count,
                outcomeAlignment: data.scores[3]! / data.count,
              },
            })));
          }
        }
      } catch {}
      setIsLoadingJudges(false);
    })();
  }, [entry.agentId]);

  return (
    <div ref={panelRef} className="p-5 border-t border-white/5 bg-navy-800/20">
      {/* Header with close button */}
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

      {/* Aggregate score breakdown */}
      {entry.scores && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          {[
            { label: "Risk ID", value: entry.scores.riskIdentification, color: "cyan" },
            { label: "Next Steps", value: entry.scores.nextStepQuality, color: "emerald" },
            { label: "Priority", value: entry.scores.prioritization, color: "amber" },
            { label: "Alignment", value: entry.scores.outcomeAlignment, color: "purple" },
          ].map((dim) => (
            <div key={dim.label} className="bg-navy-900/50 rounded-lg p-3 text-center">
              <div className="text-xs text-slate-500 mb-1">{dim.label}</div>
              <div className={`text-xl font-bold text-${dim.color}-400`}>
                {dim.value.toFixed(1)}<span className="text-slate-600 text-sm">/10</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Judge carousel */}
      {judgeData.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-slate-500 uppercase tracking-wider">Per-Judge Scores</span>
            <span className="text-xs text-slate-600">{activeJudgeIdx + 1}/{judgeData.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveJudgeIdx(i => (i - 1 + judgeData.length) % judgeData.length)}
              className="p-1 rounded text-slate-500 hover:text-white hover:bg-white/10"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="flex-1 bg-navy-900/50 rounded-lg p-3">
              <div className="text-sm font-medium text-slate-300 mb-2">{judgeData[activeJudgeIdx]?.model}</div>
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: "Risk", value: judgeData[activeJudgeIdx]?.scores.riskIdentification, color: "cyan" },
                  { label: "Steps", value: judgeData[activeJudgeIdx]?.scores.nextStepQuality, color: "emerald" },
                  { label: "Priority", value: judgeData[activeJudgeIdx]?.scores.prioritization, color: "amber" },
                  { label: "Align", value: judgeData[activeJudgeIdx]?.scores.outcomeAlignment, color: "purple" },
                ].map(dim => (
                  <div key={dim.label} className="text-center">
                    <div className="text-[10px] text-slate-600">{dim.label}</div>
                    <div className={`text-sm font-bold text-${dim.color}-400`}>{dim.value?.toFixed(1)}</div>
                  </div>
                ))}
              </div>
            </div>
            <button
              onClick={() => setActiveJudgeIdx(i => (i + 1) % judgeData.length)}
              className="p-1 rounded text-slate-500 hover:text-white hover:bg-white/10"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      )}
      {isLoadingJudges && (
        <div className="flex items-center gap-2 text-xs text-slate-500 mb-4">
          <div className="animate-spin w-3 h-3 border border-slate-500 border-t-transparent rounded-full" />
          Loading judge data...
        </div>
      )}

      {/* View Full Results link */}
      <a
        href={`/results/${encodeURIComponent(entry.agentId)}`}
        onClick={(e) => {
          e.preventDefault();
          window.history.pushState({}, "", `/results/${encodeURIComponent(entry.agentId)}`);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }}
        className="inline-flex items-center gap-2 px-4 py-2.5 bg-cyan-500/10 border border-cyan-500/20 rounded-xl text-cyan-400 text-sm font-medium hover:bg-cyan-500/20 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        View Full Results
      </a>
    </div>
  );
}

export function Leaderboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [sortField, setSortField] = useState<SortField>("rank");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<LeaderboardEntry | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load leaderboard from API (always use "public" mode which has combined scores)
  useEffect(() => {
    const loadLeaderboard = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/leaderboard?mode=public`);
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
  }, []);

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
      <div className="bg-navy-900/40 rounded-2xl border border-white/5 p-12">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-navy-800/50 mb-4">
            <svg className="w-8 h-8 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h4 className="font-semibold text-lg mb-2">Benchmark Running</h4>
          <p className="text-slate-500 text-sm max-w-sm mx-auto">
            We're currently evaluating models against the full benchmark suite.
            Results will appear here as models complete their evaluation.
          </p>
          <div className="mt-6 flex items-center justify-center gap-2 text-sm text-cyan-400">
            <div className="animate-spin w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full" />
            <span>Check back soon</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-navy-900/40 rounded-2xl border border-white/5 overflow-hidden">
      {/* Header */}
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
              <p className="text-xs text-slate-500">{entries.length} models, 4 scoring dimensions</p>
            </div>
          </div>

          {/* Search */}
          <div className="w-full sm:w-64">
            <input
              type="text"
              placeholder="Search models..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2 rounded-lg bg-navy-800/50 border border-white/5 text-sm
                placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50"
            />
          </div>
        </div>
      </div>

      {/* Scatter Plot */}
      {filteredAndSortedEntries.some((e) => e.avgLatencyMs) && (
        <div className="hidden sm:block p-5 border-b border-white/5">
          <ScatterPlot
            entries={filteredAndSortedEntries.map(e => ({
              id: e.agentId,
              name: e.agentName || e.agentId,
              percentage: e.percentage,
              avgLatencyMs: e.avgLatencyMs ?? null,
            }))}
            onSelectEntry={(sp) => {
              const match = filteredAndSortedEntries.find(e => e.agentId === sp.id);
              if (match) setSelectedEntry(match);
            }}
          />
        </div>
      )}

      {/* Table Header */}
      <div className="hidden md:grid grid-cols-10 gap-4 px-6 py-3 bg-navy-800/30 text-xs items-center">
        <div className="col-span-1">
          <SortableHeader label="#" field="rank" currentSort={sortField} currentDirection={sortDirection} onSort={handleSort} />
        </div>
        <div className="col-span-3 text-slate-500 uppercase tracking-wider">Agent</div>
        <div className="col-span-1 text-center">
          <SortableHeader label="Score" field="percentage" currentSort={sortField} currentDirection={sortDirection} onSort={handleSort} />
        </div>
        <div className="col-span-1 text-center" title="Risk Identification: How well does the model spot deal risks? (0-10, higher is better)">
          <SortableHeader label="Risk" field="riskIdentification" currentSort={sortField} currentDirection={sortDirection} onSort={handleSort} />
        </div>
        <div className="col-span-1 text-center" title="Next Step Quality: Are suggested actions relevant and actionable? (0-10, higher is better)">
          <SortableHeader label="Steps" field="nextStepQuality" currentSort={sortField} currentDirection={sortDirection} onSort={handleSort} />
        </div>
        <div className="col-span-1 text-center" title="Prioritization: Does the model focus on what matters most? (0-10, higher is better)">
          <SortableHeader label="Priority" field="prioritization" currentSort={sortField} currentDirection={sortDirection} onSort={handleSort} />
        </div>
        <div className="col-span-1 text-center" title="Outcome Alignment: Are recommendations aligned with closing the deal? (0-10, higher is better)">
          <SortableHeader label="Align" field="outcomeAlignment" currentSort={sortField} currentDirection={sortDirection} onSort={handleSort} />
        </div>
        <div className="col-span-1 text-center" title="Average response time per checkpoint (lower is faster)">
          <SortableHeader label="Latency" field="avgLatencyMs" currentSort={sortField} currentDirection={sortDirection} onSort={handleSort} />
        </div>
      </div>

      {/* Entries */}
      <div className="divide-y divide-white/5">
        {filteredAndSortedEntries.map((entry, idx) => {
          const isSelected = selectedEntry?.agentId === entry.agentId;

          return (
            <div key={entry.agentId}>
              {/* Desktop row */}
              <div
                onClick={() => setSelectedEntry(isSelected ? null : entry)}
                className={`hidden md:grid grid-cols-10 gap-4 items-center px-6 py-4 cursor-pointer transition-colors
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
                <div className="col-span-1 text-center">
                  <span
                    className={`text-lg font-bold tabular-nums ${
                      entry.percentage >= 75
                        ? "text-emerald-400"
                        : entry.percentage >= 50
                        ? "text-amber-400"
                        : "text-red-400"
                    }`}
                  >
                    {entry.percentage}%
                  </span>
                </div>

                {/* Dimension Scores */}
                <div className="col-span-1 text-center">
                  <span className="text-sm tabular-nums text-slate-300">
                    {entry.scores?.riskIdentification?.toFixed(1) ?? "-"}
                  </span>
                </div>
                <div className="col-span-1 text-center">
                  <span className="text-sm tabular-nums text-slate-300">
                    {entry.scores?.nextStepQuality?.toFixed(1) ?? "-"}
                  </span>
                </div>
                <div className="col-span-1 text-center">
                  <span className="text-sm tabular-nums text-slate-300">
                    {entry.scores?.prioritization?.toFixed(1) ?? "-"}
                  </span>
                </div>
                <div className="col-span-1 text-center">
                  <span className="text-sm tabular-nums text-slate-300">
                    {entry.scores?.outcomeAlignment?.toFixed(1) ?? "-"}
                  </span>
                </div>

                {/* Latency */}
                <div className="col-span-1 text-center">
                  <span className="text-sm tabular-nums text-slate-400">
                    {entry.avgLatencyMs ? `${(entry.avgLatencyMs / 1000).toFixed(1)}s` : "-"}
                  </span>
                </div>
              </div>
              {/* Mobile card */}
              <div
                onClick={() => setSelectedEntry(isSelected ? null : entry)}
                className={`md:hidden p-4 cursor-pointer transition-colors
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
                  <span className={`text-lg font-bold tabular-nums ${
                    entry.percentage >= 75 ? "text-emerald-400" : entry.percentage >= 50 ? "text-amber-400" : "text-red-400"
                  }`}>
                    {entry.percentage}%
                  </span>
                </div>
                <div className="flex gap-3 text-xs text-slate-500">
                  <span>Risk: {entry.scores?.riskIdentification?.toFixed(1) ?? "-"}</span>
                  <span>Steps: {entry.scores?.nextStepQuality?.toFixed(1) ?? "-"}</span>
                  <span>Pri: {entry.scores?.prioritization?.toFixed(1) ?? "-"}</span>
                  <span>Align: {entry.scores?.outcomeAlignment?.toFixed(1) ?? "-"}</span>
                </div>
              </div>
              {isSelected && <EntryDetailPanel entry={entry} onClose={() => setSelectedEntry(null)} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default Leaderboard;
