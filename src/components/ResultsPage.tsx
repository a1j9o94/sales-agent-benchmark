import { useState, useEffect } from "react";

interface RunDetails {
  id: number;
  agentId: string;
  agentName: string | null;
  mode: string;
  aggregateScore: number;
  maxPossibleScore: number;
  percentage: number;
  dealsEvaluated: number;
  checkpointsEvaluated: number;
  avgLatencyMs: number | null;
  runTimestamp: string;
  scores: {
    riskIdentification: number;
    nextStepQuality: number;
    prioritization: number;
    outcomeAlignment: number;
  };
}

interface JudgeEvaluation {
  runId: number;
  checkpointId: string;
  judgeModel: string;
  scores: {
    riskIdentification: number;
    nextStepQuality: number;
    prioritization: number;
    outcomeAlignment: number;
  };
  feedback?: string;
  risksIdentified?: string[];
  risksMissed?: string[];
  helpfulRecommendations?: string[];
  unhelpfulRecommendations?: string[];
}

const DEAL_DISPLAY_NAMES: Record<string, string> = {
  "moxie": "Velocity Systems",
  "granola": "NoteFlow AI",
  "zenith-prep-academy": "Summit Learning",
  "avmedia": "StreamCore Media",
  "cool-rooms": "ChillSpace Tech",
};

function scoreColor(percentage: number): string {
  if (percentage >= 75) return "text-emerald-400";
  if (percentage >= 50) return "text-amber-400";
  return "text-red-400";
}

function scoreBgColor(percentage: number): string {
  if (percentage >= 75) return "bg-emerald-500/10 border-emerald-500/20";
  if (percentage >= 50) return "bg-amber-500/10 border-amber-500/20";
  return "bg-red-500/10 border-red-500/20";
}

function getDealPrefix(checkpointId: string): string {
  const idx = checkpointId.indexOf("_cp_");
  if (idx === -1) return checkpointId;
  return checkpointId.substring(0, idx);
}

function getJudgeShortName(model: string): string {
  // Extract a short display name from judge model string
  if (model.includes("claude")) {
    const match = model.match(/claude[- ](\w+)[- ]?([\d.]+)?/i);
    if (match) return `Claude ${match[1]}`;
  }
  if (model.includes("gpt")) {
    const match = model.match(/gpt[- ]?([\w.]+)/i);
    if (match) return `GPT-${match[1]}`;
  }
  if (model.includes("gemini")) {
    const match = model.match(/gemini[- ]?([\w.]+)/i);
    if (match) return `Gemini ${match[1]}`;
  }
  // Fallback: take last segment or truncate
  const parts = model.split("/");
  const last = parts[parts.length - 1] || model;
  return last.length > 20 ? last.substring(0, 20) + "..." : last;
}

function evalTotal(eval_: JudgeEvaluation): number {
  return (
    eval_.scores.riskIdentification +
    eval_.scores.nextStepQuality +
    eval_.scores.prioritization +
    eval_.scores.outcomeAlignment
  );
}

function JudgeDetail({ eval_ }: { eval_: JudgeEvaluation }) {
  const total = evalTotal(eval_);
  const totalPct = Math.round((total / 40) * 100);

  return (
    <div className="space-y-3">
      {/* Score bars */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Risk ID", value: eval_.scores.riskIdentification },
          { label: "Next Steps", value: eval_.scores.nextStepQuality },
          { label: "Priority", value: eval_.scores.prioritization },
          { label: "Alignment", value: eval_.scores.outcomeAlignment },
        ].map((dim) => (
          <div key={dim.label} className="bg-navy-900/60 rounded-lg p-3">
            <div className="text-xs text-slate-500 mb-1">{dim.label}</div>
            <div className={`text-lg font-bold ${scoreColor(Math.round((dim.value / 10) * 100))}`}>
              {dim.value.toFixed(1)}
              <span className="text-slate-600 text-xs">/10</span>
            </div>
            <div className="mt-1 h-1 bg-navy-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-cyan-500 rounded-full transition-all duration-500"
                style={{ width: `${(dim.value / 10) * 100}%` }}
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

      {/* Risks & Recommendations */}
      <div className="grid md:grid-cols-2 gap-3">
        {eval_.risksIdentified && eval_.risksIdentified.length > 0 && (
          <div className="bg-navy-900/40 rounded-lg p-3">
            <div className="text-xs font-medium text-emerald-400 mb-1">Risks Identified</div>
            <ul className="text-xs text-slate-400 space-y-0.5">
              {eval_.risksIdentified.map((r, i) => (
                <li key={i}>- {r}</li>
              ))}
            </ul>
          </div>
        )}
        {eval_.risksMissed && eval_.risksMissed.length > 0 && (
          <div className="bg-navy-900/40 rounded-lg p-3">
            <div className="text-xs font-medium text-red-400 mb-1">Risks Missed</div>
            <ul className="text-xs text-slate-400 space-y-0.5">
              {eval_.risksMissed.map((r, i) => (
                <li key={i}>- {r}</li>
              ))}
            </ul>
          </div>
        )}
        {eval_.helpfulRecommendations && eval_.helpfulRecommendations.length > 0 && (
          <div className="bg-navy-900/40 rounded-lg p-3">
            <div className="text-xs font-medium text-emerald-400 mb-1">Helpful Recommendations</div>
            <ul className="text-xs text-slate-400 space-y-0.5">
              {eval_.helpfulRecommendations.map((r, i) => (
                <li key={i}>- {r}</li>
              ))}
            </ul>
          </div>
        )}
        {eval_.unhelpfulRecommendations && eval_.unhelpfulRecommendations.length > 0 && (
          <div className="bg-navy-900/40 rounded-lg p-3">
            <div className="text-xs font-medium text-red-400 mb-1">Unhelpful Recommendations</div>
            <ul className="text-xs text-slate-400 space-y-0.5">
              {eval_.unhelpfulRecommendations.map((r, i) => (
                <li key={i}>- {r}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export function ResultsPage() {
  const pathParts = window.location.pathname.split("/").filter(Boolean);
  const resultId = pathParts[pathParts.length - 1] || "";

  const [run, setRun] = useState<RunDetails | null>(null);
  const [judgeEvaluations, setJudgeEvaluations] = useState<JudgeEvaluation[]>([]);
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
        const res = await fetch(`/api/agent-results/${encodeURIComponent(resultId)}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Failed to load" }));
          setError(data.error || `Error: ${res.status}`);
          return;
        }
        const data = await res.json();
        setRun(data.run);
        setJudgeEvaluations(data.judgeEvaluations || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load results");
      } finally {
        setIsLoading(false);
      }
    })();
  }, [resultId]);

  // Group evaluations by checkpoint
  const evaluationsByCheckpoint = judgeEvaluations.reduce<Record<string, JudgeEvaluation[]>>(
    (acc, eval_) => {
      if (!acc[eval_.checkpointId]) acc[eval_.checkpointId] = [];
      acc[eval_.checkpointId]!.push(eval_);
      return acc;
    },
    {}
  );

  // Group checkpoints by deal prefix
  const checkpointsByDeal = Object.keys(evaluationsByCheckpoint).reduce<Record<string, string[]>>(
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
      const evals = evaluationsByCheckpoint[cpId];
      if (!evals) continue;
      for (const e of evals) {
        total += evalTotal(e);
        count++;
      }
    }
    return count > 0 ? total / count : 0;
  }

  // Compute average score for a checkpoint across judges
  function checkpointAvgScore(cpId: string): number {
    const evals = evaluationsByCheckpoint[cpId];
    if (!evals || evals.length === 0) return 0;
    const sum = evals.reduce((s, e) => s + evalTotal(e), 0);
    return sum / evals.length;
  }

  // Filter checkpoints based on selected deal
  const filteredCheckpoints = selectedDeal
    ? (checkpointsByDeal[selectedDeal] || [])
    : Object.keys(evaluationsByCheckpoint).sort();

  if (isLoading) {
    return (
      <div className="pt-24 pb-16">
        <div className="max-w-4xl mx-auto px-6">
          <div className="bg-navy-900/40 rounded-2xl border border-white/5 p-8">
            <div className="flex items-center justify-center gap-3">
              <div className="animate-spin w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full" />
              <span className="text-slate-400">Loading results...</span>
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
            href="/benchmark"
            onClick={(e) => {
              e.preventDefault();
              window.history.pushState({}, "", "/benchmark");
              window.dispatchEvent(new PopStateEvent("popstate"));
            }}
            className="inline-flex items-center gap-2 mt-4 text-sm text-cyan-400 hover:text-cyan-300"
          >
            Back to Leaderboard
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-24 pb-16">
      <div className="max-w-4xl mx-auto px-6">
        {/* Back link */}
        <a
          href="/benchmark"
          onClick={(e) => {
            e.preventDefault();
            window.history.pushState({}, "", "/benchmark");
            window.dispatchEvent(new PopStateEvent("popstate"));
          }}
          className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-white transition-colors mb-6"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Leaderboard
        </a>

        {/* Header */}
        <div className="mb-8">
          <div className="data-label text-cyan-400 mb-2">Benchmark Results</div>
          <h1 className="text-3xl font-bold mb-2">{run.agentName || run.agentId}</h1>
          <p className="text-sm text-slate-500">
            Run on {new Date(run.runTimestamp).toLocaleString()} | {run.dealsEvaluated} deals, {run.checkpointsEvaluated} checkpoints
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

          {/* Dimension breakdown */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Risk Identification", value: run.scores.riskIdentification, color: "cyan" },
              { label: "Next Step Quality", value: run.scores.nextStepQuality, color: "emerald" },
              { label: "Prioritization", value: run.scores.prioritization, color: "amber" },
              { label: "Outcome Alignment", value: run.scores.outcomeAlignment, color: "purple" },
            ].map((dim) => (
              <div key={dim.label} className="bg-navy-900/50 rounded-lg p-4 text-center">
                <div className="text-xs text-slate-500 mb-2">{dim.label}</div>
                <div className={`text-2xl font-bold text-${dim.color}-400`}>
                  {dim.value.toFixed(1)}
                  <span className="text-slate-600 text-base">/10</span>
                </div>
                <div className="mt-2 h-1.5 bg-navy-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full bg-${dim.color}-500 rounded-full transition-all duration-500`}
                    style={{ width: `${(dim.value / 10) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Judge evaluations with 3-level hierarchy */}
        {Object.keys(evaluationsByCheckpoint).length > 0 && (
          <div className="bg-navy-900/40 rounded-2xl border border-white/5 overflow-hidden">
            <div className="p-5 border-b border-white/5">
              <h3 className="font-semibold">Per-Checkpoint Judge Evaluations</h3>
              <p className="text-xs text-slate-500 mt-1">
                Detailed feedback from public checkpoint evaluations
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
                        {DEAL_DISPLAY_NAMES[deal] || deal}
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
                const evals = evaluationsByCheckpoint[cpId];
                if (!evals || evals.length === 0) return null;

                const avg = checkpointAvgScore(cpId);
                const avgPct = Math.round((avg / 40) * 100);
                const judgeIdx = activeJudge[cpId] ?? 0;
                const currentEval = evals[judgeIdx] || evals[0]!;

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
                          {/* Per-judge score badges */}
                          <div className="hidden md:flex gap-1.5">
                            {evals.map((e, i) => {
                              const t = evalTotal(e);
                              const p = Math.round((t / 40) * 100);
                              return (
                                <span
                                  key={i}
                                  className={`text-xs px-2 py-0.5 rounded-full ${
                                    p >= 75
                                      ? "bg-emerald-500/10 text-emerald-400"
                                      : p >= 50
                                        ? "bg-amber-500/10 text-amber-400"
                                        : "bg-red-500/10 text-red-400"
                                  }`}
                                >
                                  {t.toFixed(0)}
                                </span>
                              );
                            })}
                          </div>
                          {/* Average */}
                          <span className={`text-sm font-bold ${scoreColor(avgPct)}`}>
                            {avg.toFixed(1)}/40
                          </span>
                        </div>
                      </div>
                    </summary>

                    {/* Level 3: Judge carousel */}
                    <div className="px-4 pb-4">
                      {/* Judge tabs */}
                      {evals.length > 1 && (
                        <div className="flex gap-2 mb-3">
                          {evals.map((e, i) => (
                            <button
                              key={i}
                              onClick={() =>
                                setActiveJudge((prev) => ({ ...prev, [cpId]: i }))
                              }
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                (judgeIdx) === i
                                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                                  : "bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10"
                              }`}
                            >
                              {getJudgeShortName(e.judgeModel)}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Single judge's full evaluation */}
                      <div className="bg-navy-900/50 rounded-lg p-4">
                        <div className="text-xs text-slate-500 mb-3">
                          {currentEval.judgeModel}
                        </div>
                        <JudgeDetail eval_={currentEval} />
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          </div>
        )}

        {/* No judge evaluations */}
        {Object.keys(evaluationsByCheckpoint).length === 0 && (
          <div className="bg-navy-900/40 rounded-2xl border border-white/5 p-8 text-center">
            <div className="text-slate-500 text-sm">
              No detailed judge evaluations available for this run.
              <br />
              Detailed feedback is only available for public checkpoint evaluations.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ResultsPage;
