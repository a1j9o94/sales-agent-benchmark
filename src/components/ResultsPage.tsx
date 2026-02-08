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

export function ResultsPage() {
  const pathParts = window.location.pathname.split("/").filter(Boolean);
  const resultId = pathParts[pathParts.length - 1] || "";

  const [run, setRun] = useState<RunDetails | null>(null);
  const [judgeEvaluations, setJudgeEvaluations] = useState<JudgeEvaluation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  // Group judge evaluations by checkpoint
  const evaluationsByCheckpoint = judgeEvaluations.reduce<Record<string, JudgeEvaluation[]>>(
    (acc, eval_) => {
      if (!acc[eval_.checkpointId]) acc[eval_.checkpointId] = [];
      acc[eval_.checkpointId]!.push(eval_);
      return acc;
    },
    {}
  );

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
                {/* Visual bar */}
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

        {/* Judge evaluations per checkpoint */}
        {Object.keys(evaluationsByCheckpoint).length > 0 && (
          <div className="bg-navy-900/40 rounded-2xl border border-white/5 overflow-hidden">
            <div className="p-5 border-b border-white/5">
              <h3 className="font-semibold">Per-Checkpoint Judge Evaluations</h3>
              <p className="text-xs text-slate-500 mt-1">
                Detailed feedback from public checkpoint evaluations
              </p>
            </div>

            <div className="divide-y divide-white/5">
              {Object.entries(evaluationsByCheckpoint).map(([checkpointId, evals]) => (
                <div key={checkpointId} className="p-5">
                  <div className="font-medium text-sm mb-3 font-mono text-slate-300">
                    {checkpointId}
                  </div>

                  <div className="space-y-4">
                    {evals.map((eval_, idx) => {
                      const total =
                        eval_.scores.riskIdentification +
                        eval_.scores.nextStepQuality +
                        eval_.scores.prioritization +
                        eval_.scores.outcomeAlignment;
                      const totalPct = Math.round((total / 40) * 100);

                      return (
                        <div key={`${eval_.judgeModel}-${idx}`} className="bg-navy-900/50 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-medium text-slate-400">
                              {eval_.judgeModel}
                            </span>
                            <span className={`text-sm font-bold ${scoreColor(totalPct)}`}>
                              {total}/40
                            </span>
                          </div>

                          {/* Scores row */}
                          <div className="flex gap-4 text-xs text-slate-500 mb-3">
                            <span>Risk: {eval_.scores.riskIdentification.toFixed(1)}</span>
                            <span>Steps: {eval_.scores.nextStepQuality.toFixed(1)}</span>
                            <span>Priority: {eval_.scores.prioritization.toFixed(1)}</span>
                            <span>Align: {eval_.scores.outcomeAlignment.toFixed(1)}</span>
                          </div>

                          {/* Feedback */}
                          {eval_.feedback && (
                            <p className="text-xs text-slate-400 leading-relaxed mb-3">
                              {eval_.feedback}
                            </p>
                          )}

                          {/* Risks & Recommendations */}
                          <div className="grid md:grid-cols-2 gap-3">
                            {eval_.risksIdentified && eval_.risksIdentified.length > 0 && (
                              <div>
                                <div className="text-xs font-medium text-emerald-400 mb-1">
                                  Risks Identified
                                </div>
                                <ul className="text-xs text-slate-400 space-y-0.5">
                                  {eval_.risksIdentified.map((r, i) => (
                                    <li key={i}>- {r}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {eval_.risksMissed && eval_.risksMissed.length > 0 && (
                              <div>
                                <div className="text-xs font-medium text-red-400 mb-1">
                                  Risks Missed
                                </div>
                                <ul className="text-xs text-slate-400 space-y-0.5">
                                  {eval_.risksMissed.map((r, i) => (
                                    <li key={i}>- {r}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {eval_.helpfulRecommendations && eval_.helpfulRecommendations.length > 0 && (
                              <div>
                                <div className="text-xs font-medium text-emerald-400 mb-1">
                                  Helpful Recommendations
                                </div>
                                <ul className="text-xs text-slate-400 space-y-0.5">
                                  {eval_.helpfulRecommendations.map((r, i) => (
                                    <li key={i}>- {r}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {eval_.unhelpfulRecommendations && eval_.unhelpfulRecommendations.length > 0 && (
                              <div>
                                <div className="text-xs font-medium text-red-400 mb-1">
                                  Unhelpful Recommendations
                                </div>
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
                    })}
                  </div>
                </div>
              ))}
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
