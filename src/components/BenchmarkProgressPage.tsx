import { useState, useEffect, useRef } from "react";

interface JudgeResult {
  model: string;
  scores: {
    riskIdentification: number;
    nextStepQuality: number;
    prioritization: number;
    outcomeAlignment: number;
  };
  feedback: string;
}

interface CheckpointResult {
  checkpointId: string;
  dealId: string;
  dealName: string;
  mode: "public" | "private";
  score: number;
  maxScore: number;
  feedback: string | null;
  scores: {
    riskIdentification: number;
    nextStepQuality: number;
    prioritization: number;
    outcomeAlignment: number;
  };
  progress: { completed: number; total: number };
  error?: boolean;
  judges?: JudgeResult[];
}

interface CompleteEvent {
  type: "complete";
  runId: number | null;
  finalScore: number;
  maxScore: number;
  percentage: number;
  avgLatencyMs: number;
  scores: {
    riskIdentification: number;
    nextStepQuality: number;
    prioritization: number;
    outcomeAlignment: number;
  };
}

function ScoreBar({ percentage }: { percentage: number }) {
  const color =
    percentage >= 75
      ? "from-emerald-500 to-emerald-400"
      : percentage >= 50
      ? "from-amber-500 to-amber-400"
      : "from-red-500 to-red-400";

  return (
    <div className="relative h-3 bg-navy-800 rounded-full overflow-hidden">
      <div
        className={`absolute inset-y-0 left-0 bg-gradient-to-r ${color} rounded-full transition-all duration-500`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

function scoreColor(percentage: number): string {
  if (percentage >= 75) return "text-emerald-400";
  if (percentage >= 50) return "text-amber-400";
  return "text-red-400";
}

export function BenchmarkProgressPage() {
  const params = new URLSearchParams(window.location.search);
  const endpoint = params.get("endpoint") || "";
  const agentName = params.get("name") || "Your Agent";

  const [checkpoints, setCheckpoints] = useState<CheckpointResult[]>([]);
  const [complete, setComplete] = useState<CompleteEvent | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom as results come in
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [checkpoints]);

  // Start the benchmark stream on mount
  useEffect(() => {
    if (!endpoint) {
      setErrorMessage("No agent endpoint specified.");
      return;
    }

    setIsRunning(true);

    const abortController = new AbortController();

    (async () => {
      try {
        const res = await fetch("/api/benchmark/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint, agentName }),
          signal: abortController.signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Stream failed" }));
          setErrorMessage(err.error || `Server error: ${res.status}`);
          setIsRunning(false);
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) {
          setErrorMessage("No response stream available.");
          setIsRunning(false);
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events from buffer
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const json = line.slice(6).trim();
            if (!json) continue;

            try {
              const event = JSON.parse(json);

              if (event.type === "checkpoint") {
                setCheckpoints((prev) => [...prev, event as CheckpointResult]);
              } else if (event.type === "complete") {
                setComplete(event as CompleteEvent);
                setIsRunning(false);
              } else if (event.type === "error") {
                setErrorMessage(event.message);
                setIsRunning(false);
              }
            } catch {
              // Skip malformed events
            }
          }
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          setErrorMessage(err instanceof Error ? err.message : "Connection lost");
        }
        setIsRunning(false);
      }
    })();

    return () => {
      abortController.abort();
    };
  }, [endpoint, agentName]);

  // Calculate running totals
  const totalScore = checkpoints.reduce((sum, cp) => sum + cp.score, 0);
  const totalMaxScore = checkpoints.reduce((sum, cp) => sum + cp.maxScore, 0);
  const progress = checkpoints.length > 0 ? checkpoints[checkpoints.length - 1]!.progress : { completed: 0, total: 1 };
  const progressPct = Math.round((progress.completed / progress.total) * 100);
  const scorePct = totalMaxScore > 0 ? Math.round((totalScore / totalMaxScore) * 100) : 0;

  return (
    <div className="pt-24 pb-16">
      <div className="max-w-4xl mx-auto px-6">
        {/* Header */}
        <div className="mb-8">
          <div className="data-label text-cyan-400 mb-2">Live Benchmark</div>
          <h1 className="text-3xl font-bold mb-2">{agentName}</h1>
          <p className="text-sm text-slate-500 font-mono truncate">{endpoint}</p>
        </div>

        {/* Error state */}
        {errorMessage && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 mb-8">
            <div className="flex items-center gap-3 text-red-400 font-medium mb-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              Benchmark Error
            </div>
            <p className="text-slate-400 text-sm">{errorMessage}</p>
          </div>
        )}

        {/* Progress Overview */}
        <div className="bg-navy-900/40 rounded-2xl border border-white/5 p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              {isRunning ? (
                <div className="animate-spin w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full" />
              ) : complete ? (
                <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              ) : null}
              <span className="font-semibold">
                {isRunning
                  ? `Running... ${progress.completed}/${progress.total}`
                  : complete
                  ? "Benchmark Complete"
                  : "Waiting..."}
              </span>
            </div>
            <span className={`text-2xl font-bold tabular-nums ${scoreColor(scorePct)}`}>
              {scorePct}%
            </span>
          </div>

          {/* Progress bar */}
          <div className="mb-3">
            <ScoreBar percentage={progressPct} />
          </div>
          <div className="flex justify-between text-xs text-slate-500">
            <span>{progress.completed} of {progress.total} checkpoints</span>
            <span>{totalScore}/{totalMaxScore} points</span>
          </div>
        </div>

        {/* Complete summary */}
        {complete && (
          <div className="bg-navy-900/40 rounded-2xl border border-emerald-500/20 p-6 mb-8">
            <h3 className="font-semibold text-lg mb-4 text-emerald-400">Final Results</h3>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {[
                { label: "Risk ID", value: complete.scores.riskIdentification, color: "cyan" },
                { label: "Next Steps", value: complete.scores.nextStepQuality, color: "emerald" },
                { label: "Priority", value: complete.scores.prioritization, color: "amber" },
                { label: "Alignment", value: complete.scores.outcomeAlignment, color: "purple" },
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

            <div className="flex flex-col sm:flex-row gap-3">
              {complete.runId && (
                <a
                  href={`/results/${complete.runId}`}
                  onClick={(e) => {
                    e.preventDefault();
                    window.history.pushState({}, "", `/results/${complete.runId}`);
                    window.dispatchEvent(new PopStateEvent("popstate"));
                  }}
                  className="flex-1 px-4 py-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 font-medium
                    hover:bg-cyan-500/20 transition-colors text-center text-sm"
                >
                  View Full Results
                </a>
              )}
              <a
                href="/benchmark"
                onClick={(e) => {
                  e.preventDefault();
                  window.history.pushState({}, "", "/benchmark");
                  window.dispatchEvent(new PopStateEvent("popstate"));
                }}
                className="flex-1 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-slate-300 font-medium
                  hover:bg-white/10 transition-colors text-center text-sm"
              >
                Back to Leaderboard
              </a>
            </div>
          </div>
        )}

        {/* Checkpoint Results */}
        {checkpoints.length > 0 && (
          <div className="bg-navy-900/40 rounded-2xl border border-white/5 overflow-hidden">
            <div className="p-5 border-b border-white/5">
              <h3 className="font-semibold">Checkpoint Results</h3>
            </div>

            <div className="divide-y divide-white/5">
              {checkpoints.map((cp, idx) => {
                const cpPct = cp.maxScore > 0 ? Math.round((cp.score / cp.maxScore) * 100) : 0;
                return (
                  <div
                    key={`${cp.checkpointId}-${idx}`}
                    className="px-5 py-4"
                    style={{
                      animation: "fade-up 0.3s ease-out forwards",
                      animationDelay: `${idx * 0.02}s`,
                      opacity: 0,
                    }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          cp.mode === "public"
                            ? "bg-cyan-500/20 text-cyan-400"
                            : "bg-slate-500/20 text-slate-400"
                        }`}>
                          {cp.mode}
                        </span>
                        <span className="text-sm font-medium">{cp.dealName}</span>
                        <span className="text-xs text-slate-600 font-mono">{cp.checkpointId}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {cp.error && (
                          <span className="text-xs text-red-400">error</span>
                        )}
                        <span className={`font-bold tabular-nums ${scoreColor(cpPct)}`}>
                          {cp.score}/{cp.maxScore}
                        </span>
                      </div>
                    </div>

                    {/* Dimension scores row */}
                    <div className="flex gap-4 text-xs text-slate-500 mb-2">
                      <span>Risk: {cp.scores.riskIdentification.toFixed(1)}</span>
                      <span>Steps: {cp.scores.nextStepQuality.toFixed(1)}</span>
                      <span>Priority: {cp.scores.prioritization.toFixed(1)}</span>
                      <span>Align: {cp.scores.outcomeAlignment.toFixed(1)}</span>
                    </div>

                    {/* Individual judge scores */}
                    {cp.judges && cp.judges.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {cp.judges.map((judge, jIdx) => {
                          const judgeTotal = judge.scores.riskIdentification + judge.scores.nextStepQuality
                            + judge.scores.prioritization + judge.scores.outcomeAlignment;
                          const judgePct = Math.round((judgeTotal / 40) * 100);
                          return (
                            <div key={jIdx} className="bg-navy-900/30 rounded-lg px-3 py-2">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs font-medium text-slate-400">{judge.model}</span>
                                <span className={`text-xs font-bold tabular-nums ${scoreColor(judgePct)}`}>
                                  {judgeTotal.toFixed(1)}/40
                                </span>
                              </div>
                              <div className="flex gap-3 text-[11px] text-slate-500">
                                <span>Risk: {judge.scores.riskIdentification.toFixed(1)}</span>
                                <span>Steps: {judge.scores.nextStepQuality.toFixed(1)}</span>
                                <span>Priority: {judge.scores.prioritization.toFixed(1)}</span>
                                <span>Align: {judge.scores.outcomeAlignment.toFixed(1)}</span>
                              </div>
                              {judge.feedback && (
                                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                                  {judge.feedback}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Aggregate feedback for public checkpoints */}
                    {cp.feedback && !cp.judges && (
                      <p className="text-xs text-slate-400 leading-relaxed mt-1">
                        {cp.feedback}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  );
}

export default BenchmarkProgressPage;
