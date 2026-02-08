import { useState, useEffect } from "react";
import {
  scoreColor,
  scoreBgColor,
  scoreBarColor,
  taskTypeLabel,
  taskTypeColor,
  dimensionLabel,
  dimensionColor,
  dimensionFullLabel,
  getJudgeShortName,
  V2_DIMENSION_KEYS,
} from "./utils";
import type { V2ScoringDimensions } from "@/types/benchmark-v2";

interface V2RunDetails {
  id: number;
  agentId: string;
  agentName: string | null;
  mode: string;
  aggregateScore: number;
  maxPossibleScore: number;
  percentage: number;
  dealsEvaluated: number;
  checkpointsEvaluated: number;
  tasksEvaluated: number;
  avgTurnsPerTask: number;
  avgLatencyMs: number | null;
  runTimestamp: string;
  dimensions: Record<string, number>;
}

interface V2TaskEvaluation {
  runId: number;
  checkpointId: string;
  taskId: string;
  taskType: string;
  turnsUsed: number;
  scores: Partial<V2ScoringDimensions>;
  feedback?: string;
  artifactsRequested?: string[];
  judgeModel?: string;
}

function getDealPrefix(checkpointId: string): string {
  const idx = checkpointId.indexOf("_cp_");
  if (idx === -1) return checkpointId;
  return checkpointId.substring(0, idx);
}

function evalV2Total(eval_: V2TaskEvaluation): number {
  return (
    (eval_.scores.riskIdentification ?? 0) +
    (eval_.scores.nextStepQuality ?? 0) +
    (eval_.scores.prioritization ?? 0) +
    (eval_.scores.outcomeAlignment ?? 0)
  );
}

function ScoreBar({ percentage }: { percentage: number }) {
  const color = scoreBarColor(percentage);
  return (
    <div className="relative h-1.5 bg-navy-800 rounded-full overflow-hidden">
      <div
        className={`absolute inset-y-0 left-0 bg-gradient-to-r ${color} rounded-full transition-all duration-500`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

function JudgeDetail({ eval_ }: { eval_: V2TaskEvaluation }) {
  const total = evalV2Total(eval_);
  const totalPct = Math.round((total / 40) * 100);

  // Only show dimensions that have values
  const scoredDimensions = Object.entries(eval_.scores).filter(
    ([_, v]) => v !== undefined && v !== null
  );

  return (
    <div className="space-y-3">
      {/* Score bars */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {scoredDimensions.map(([key, value]) => (
          <div key={key} className="bg-navy-900/60 rounded-lg p-3">
            <div className="text-xs text-slate-500 mb-1">{dimensionLabel(key)}</div>
            <div className={`text-lg font-bold ${scoreColor(Math.round(((value ?? 0) / 10) * 100))}`}>
              {(value ?? 0).toFixed(1)}
              <span className="text-slate-600 text-xs">/10</span>
            </div>
            <div className="mt-1 h-1 bg-navy-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-cyan-500 rounded-full transition-all duration-500"
                style={{ width: `${((value ?? 0) / 10) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Total */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-slate-500">Total:</span>
        <span className={`font-bold ${scoreColor(totalPct)}`}>{total.toFixed(1)}/40</span>
      </div>

      {/* Feedback */}
      {eval_.feedback && (
        <div className="bg-navy-900/40 rounded-lg p-3">
          <div className="text-xs font-medium text-slate-400 mb-1">Feedback</div>
          <p className="text-xs text-slate-300 leading-relaxed">{eval_.feedback}</p>
        </div>
      )}

      {/* Turns & artifacts info */}
      <div className="flex gap-4 text-xs text-slate-500">
        <span>Turns used: <span className="text-slate-300">{eval_.turnsUsed}</span></span>
        {eval_.artifactsRequested && eval_.artifactsRequested.length > 0 && (
          <span>Artifacts requested: <span className="text-slate-300">{eval_.artifactsRequested.length}</span></span>
        )}
      </div>
    </div>
  );
}

export function V2ResultsPage() {
  const pathParts = window.location.pathname.split("/").filter(Boolean);
  const resultId = pathParts[pathParts.length - 1] || "";

  const [run, setRun] = useState<V2RunDetails | null>(null);
  const [taskEvaluations, setTaskEvaluations] = useState<V2TaskEvaluation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDeal, setSelectedDeal] = useState<string | null>(null);
  const [activeJudge, setActiveJudge] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!resultId) {
      setError("No result ID specified.");
      setIsLoading(false);
      return;
    }

    (async () => {
      try {
        const res = await fetch(`/api/v2/agent-results/${encodeURIComponent(resultId)}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Failed to load" }));
          setError(data.error || `Error: ${res.status}`);
          return;
        }
        const data = await res.json();
        setRun(data.run);
        setTaskEvaluations(data.taskEvaluations || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load results");
      } finally {
        setIsLoading(false);
      }
    })();
  }, [resultId]);

  // Group evaluations by checkpoint, then by deal
  const evalsByCheckpoint = taskEvaluations.reduce<Record<string, V2TaskEvaluation[]>>(
    (acc, eval_) => {
      if (!acc[eval_.checkpointId]) acc[eval_.checkpointId] = [];
      acc[eval_.checkpointId]!.push(eval_);
      return acc;
    },
    {}
  );

  const checkpointsByDeal = Object.keys(evalsByCheckpoint).reduce<Record<string, string[]>>(
    (acc, cpId) => {
      const deal = getDealPrefix(cpId);
      if (!acc[deal]) acc[deal] = [];
      acc[deal]!.push(cpId);
      return acc;
    },
    {}
  );

  const deals = Object.keys(checkpointsByDeal).sort();

  // Compute average score per deal
  function dealAvgScore(deal: string): number {
    const cps = checkpointsByDeal[deal];
    if (!cps || cps.length === 0) return 0;
    let total = 0;
    let count = 0;
    for (const cpId of cps) {
      const evals = evalsByCheckpoint[cpId];
      if (!evals) continue;
      for (const e of evals) {
        total += evalV2Total(e);
        count++;
      }
    }
    return count > 0 ? total / count : 0;
  }

  // Compute average score for a checkpoint
  function checkpointAvgScore(cpId: string): number {
    const evals = evalsByCheckpoint[cpId];
    if (!evals || evals.length === 0) return 0;
    const sum = evals.reduce((s, e) => s + evalV2Total(e), 0);
    return sum / evals.length;
  }

  // Filter checkpoints by selected deal
  const filteredCheckpoints = selectedDeal
    ? (checkpointsByDeal[selectedDeal] || [])
    : Object.keys(evalsByCheckpoint).sort();

  if (isLoading) {
    return (
      <div className="pt-24 pb-16">
        <div className="max-w-4xl mx-auto px-6">
          <div className="bg-navy-900/40 rounded-2xl border border-white/5 p-8">
            <div className="flex items-center justify-center gap-3">
              <div className="animate-spin w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full" />
              <span className="text-slate-400">Loading V2 results...</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="pt-24 pb-16">
        <div className="max-w-4xl mx-auto px-6">
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6">
            <h3 className="text-red-400 font-medium mb-2">Error</h3>
            <p className="text-slate-400 text-sm">{error || "Results not found"}</p>
          </div>
          <a
            href="/v2/benchmark"
            onClick={(e) => {
              e.preventDefault();
              window.history.pushState({}, "", "/v2/benchmark");
              window.dispatchEvent(new PopStateEvent("popstate"));
            }}
            className="inline-flex items-center gap-2 mt-4 text-sm text-cyan-400 hover:text-cyan-300"
          >
            Back to V2 Leaderboard
          </a>
        </div>
      </div>
    );
  }

  // Build combined scores object for the 8-dimension grid
  const allDimensions: Record<string, number | undefined> = {
    ...run.dimensions,
  };

  return (
    <div className="pt-24 pb-16">
      <div className="max-w-4xl mx-auto px-6">
        {/* Back link */}
        <a
          href="/v2/benchmark"
          onClick={(e) => {
            e.preventDefault();
            window.history.pushState({}, "", "/v2/benchmark");
            window.dispatchEvent(new PopStateEvent("popstate"));
          }}
          className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-white transition-colors mb-6"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to V2 Leaderboard
        </a>

        {/* Header */}
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="data-label text-cyan-400">V2 Benchmark Results</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/20 text-cyan-400 leading-none">V2</span>
          </div>
          <h1 className="text-3xl font-bold mb-2">{run.agentName || run.agentId}</h1>
          <p className="text-sm text-slate-500">
            Run on {new Date(run.runTimestamp).toLocaleString()} | {run.dealsEvaluated} deals, {run.checkpointsEvaluated} checkpoints, {run.tasksEvaluated} tasks
            {run.avgTurnsPerTask > 0 && ` | avg ${run.avgTurnsPerTask.toFixed(1)} turns/task`}
          </p>
        </div>

        {/* Score overview */}
        <div className={`rounded-2xl border p-6 mb-8 ${scoreBgColor(run.percentage)}`}>
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="text-sm text-slate-400 mb-1">Overall Score</div>
              <div className={`text-4xl font-bold ${scoreColor(run.percentage)}`}>
                {run.percentage}%
              </div>
              <div className="text-sm text-slate-500 mt-1">
                {run.aggregateScore} / {run.maxPossibleScore} points
              </div>
            </div>
            {run.avgLatencyMs && (
              <div className="text-right">
                <div className="text-sm text-slate-400 mb-1">Avg Latency</div>
                <div className="text-xl font-bold text-slate-300">
                  {(run.avgLatencyMs / 1000).toFixed(1)}s
                </div>
              </div>
            )}
          </div>

          {/* 8-dimension grid (2 rows x 4 cols) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {V2_DIMENSION_KEYS.map((key) => {
              const value = allDimensions[key];
              const color = dimensionColor(key);
              return (
                <div key={key} className="bg-navy-900/50 rounded-lg p-4 text-center">
                  <div className="text-xs text-slate-500 mb-2">{dimensionFullLabel(key)}</div>
                  <div className={`text-2xl font-bold text-${color}-400`}>
                    {value !== undefined ? value.toFixed(1) : "-"}
                    <span className="text-slate-600 text-base">/10</span>
                  </div>
                  {value !== undefined && (
                    <div className="mt-2">
                      <ScoreBar percentage={(value / 10) * 100} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 3-level hierarchy: Deal > Checkpoint > Task */}
        {Object.keys(evalsByCheckpoint).length > 0 && (
          <div className="bg-navy-900/40 rounded-2xl border border-white/5 overflow-hidden">
            <div className="p-5 border-b border-white/5">
              <h3 className="font-semibold">Per-Task Evaluations</h3>
              <p className="text-xs text-slate-500 mt-1">
                Detailed feedback from checkpoint task evaluations
              </p>
            </div>

            {/* Level 1: Deal pills */}
            {deals.length > 1 && (
              <div className="p-4 border-b border-white/5">
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
                  <button
                    onClick={() => setSelectedDeal(null)}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      selectedDeal === null
                        ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                        : "bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10"
                    }`}
                  >
                    All Deals
                  </button>
                  {deals.map((deal) => {
                    const avg = dealAvgScore(deal);
                    const avgPct = Math.round((avg / 40) * 100);
                    return (
                      <button
                        key={deal}
                        onClick={() => setSelectedDeal(deal)}
                        className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors flex items-center gap-2 ${
                          selectedDeal === deal
                            ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                            : "bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10"
                        }`}
                      >
                        {deal}
                        <span className={`${scoreColor(avgPct)} font-bold`}>
                          {avg.toFixed(0)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Level 2: Collapsible checkpoints */}
            <div className="divide-y divide-white/5">
              {filteredCheckpoints.map((cpId) => {
                const evals = evalsByCheckpoint[cpId];
                if (!evals || evals.length === 0) return null;

                const avg = checkpointAvgScore(cpId);
                const avgPct = Math.round((avg / 40) * 100);

                // Group evals by task
                const taskGroups: Record<string, V2TaskEvaluation[]> = {};
                for (const e of evals) {
                  if (!taskGroups[e.taskId]) taskGroups[e.taskId] = [];
                  taskGroups[e.taskId]!.push(e);
                }

                return (
                  <details key={cpId} className="group">
                    <summary className="p-4 cursor-pointer hover:bg-white/[0.02] transition-colors list-none">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <svg
                            className="w-4 h-4 text-slate-600 transition-transform group-open:rotate-90"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                          <span className="font-mono text-sm text-slate-300">{cpId}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          {/* Task type badges */}
                          <div className="hidden md:flex gap-1.5">
                            {Object.values(taskGroups).map((taskEvals) => {
                              const first = taskEvals[0]!;
                              const colors = taskTypeColor(first.taskType);
                              return (
                                <span
                                  key={first.taskId}
                                  className={`text-[10px] px-2 py-0.5 rounded-full ${colors.bg} ${colors.text} border ${colors.border}`}
                                >
                                  {taskTypeLabel(first.taskType)}
                                </span>
                              );
                            })}
                          </div>
                          <span className={`text-sm font-bold ${scoreColor(avgPct)}`}>
                            {avg.toFixed(1)}/40
                          </span>
                        </div>
                      </div>
                    </summary>

                    {/* Level 3: Task cards within checkpoint */}
                    <div className="px-4 pb-4 space-y-4">
                      {Object.entries(taskGroups).map(([taskId, taskEvals]) => {
                        const first = taskEvals[0]!;
                        const colors = taskTypeColor(first.taskType);
                        const judgeIdx = activeJudge[taskId] ?? 0;
                        const currentEval = taskEvals[judgeIdx] || taskEvals[0]!;

                        return (
                          <div key={taskId} className="bg-navy-900/50 rounded-lg overflow-hidden">
                            {/* Task header */}
                            <div className="p-4 border-b border-white/5">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors.bg} ${colors.text} border ${colors.border}`}>
                                    {taskTypeLabel(first.taskType)}
                                  </span>
                                  <span className="text-xs text-slate-600 font-mono">{taskId}</span>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-slate-500">
                                  <span>{first.turnsUsed} turn{first.turnsUsed !== 1 ? "s" : ""}</span>
                                  {first.artifactsRequested && first.artifactsRequested.length > 0 && (
                                    <span>| {first.artifactsRequested.length} artifacts</span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Judge tabs (if multiple judges) */}
                            {taskEvals.length > 1 && (
                              <div className="px-4 pt-3 flex gap-2">
                                {taskEvals.map((e, i) => (
                                  <button
                                    key={i}
                                    onClick={() => setActiveJudge((prev) => ({ ...prev, [taskId]: i }))}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                      judgeIdx === i
                                        ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                                        : "bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10"
                                    }`}
                                  >
                                    {getJudgeShortName(e.judgeModel || `Judge ${i + 1}`)}
                                  </button>
                                ))}
                              </div>
                            )}

                            {/* Judge detail */}
                            <div className="p-4">
                              {currentEval.judgeModel && (
                                <div className="text-xs text-slate-500 mb-3">{currentEval.judgeModel}</div>
                              )}
                              <JudgeDetail eval_={currentEval} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                );
              })}
            </div>
          </div>
        )}

        {/* No evaluations */}
        {Object.keys(evalsByCheckpoint).length === 0 && (
          <div className="bg-navy-900/40 rounded-2xl border border-white/5 p-8 text-center">
            <div className="text-slate-500 text-sm">
              No detailed task evaluations available for this run.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default V2ResultsPage;
