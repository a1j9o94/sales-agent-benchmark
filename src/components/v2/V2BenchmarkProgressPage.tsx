import { useState, useEffect, useRef } from "react";
import {
  scoreColor,
  scoreBarColor,
  taskTypeLabel,
  taskTypeColor,
  dimensionLabel,
  dimensionColor,
  V2_DIMENSION_KEYS,
} from "./utils";
import type { V2ScoringDimensions } from "@/types/benchmark-v2";

interface TaskResult {
  taskId: string;
  taskType: string;
  checkpointId: string;
  dealId: string;
  dealName: string;
  mode: "public" | "private";
  turnsUsed: number;
  artifactsRequested?: string[];
  scores: Partial<V2ScoringDimensions>;
  feedback: string | null;
  latencyMs?: number;
  error?: boolean;
  progress: { completed: number; total: number };
}

interface CheckpointEvent {
  checkpointId: string;
  dealId: string;
  dealName: string;
  mode: "public" | "private";
  tasksCompleted: number;
}

interface TurnEvent {
  taskId: string;
  turnNumber: number;
  maxTurns: number;
  artifactRequested?: string;
}

interface CompleteEvent {
  runId: number | null;
  version: 2;
  finalScore: number;
  maxScore: number;
  percentage: number;
  avgLatencyMs: number;
  tasksEvaluated: number;
  checkpointsEvaluated: number;
  dealsEvaluated: number;
  dimensions: Record<string, number>;
}

function ScoreBar({ percentage }: { percentage: number }) {
  const color = scoreBarColor(percentage);
  return (
    <div className="relative h-3 bg-navy-800 rounded-full overflow-hidden">
      <div
        className={`absolute inset-y-0 left-0 bg-gradient-to-r ${color} rounded-full transition-all duration-500`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

export function V2BenchmarkProgressPage() {
  const params = new URLSearchParams(window.location.search);
  const endpoint = params.get("endpoint") || "";
  const agentName = params.get("name") || "Your Agent";

  const [tasks, setTasks] = useState<TaskResult[]>([]);
  const [checkpoints, setCheckpoints] = useState<CheckpointEvent[]>([]);
  const [currentTurn, setCurrentTurn] = useState<TurnEvent | null>(null);
  const [complete, setComplete] = useState<CompleteEvent | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [tasks]);

  // Start the V2 benchmark stream
  useEffect(() => {
    if (!endpoint) {
      setErrorMessage("No agent endpoint specified.");
      return;
    }

    setIsRunning(true);
    const abortController = new AbortController();

    (async () => {
      try {
        const res = await fetch("/api/v2/benchmark/stream", {
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
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const json = line.slice(6).trim();
            if (!json) continue;

            try {
              const event = JSON.parse(json);

              if (event.type === "task") {
                setTasks((prev) => [...prev, event as TaskResult]);
                setCurrentTurn(null);
              } else if (event.type === "turn") {
                setCurrentTurn(event as TurnEvent);
              } else if (event.type === "checkpoint") {
                setCheckpoints((prev) => [...prev, event as CheckpointEvent]);
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

    return () => { abortController.abort(); };
  }, [endpoint, agentName]);

  // Calculate running totals
  const progress = tasks.length > 0 ? tasks[tasks.length - 1]!.progress : { completed: 0, total: 1 };
  const progressPct = Math.round((progress.completed / progress.total) * 100);

  // Running score from task scores
  const runningScoreSum = tasks.reduce((sum, t) => {
    if (t.error) return sum;
    return sum + (t.scores.riskIdentification ?? 0) + (t.scores.nextStepQuality ?? 0)
      + (t.scores.prioritization ?? 0) + (t.scores.outcomeAlignment ?? 0);
  }, 0);
  const completedNonError = tasks.filter((t) => !t.error).length;
  const maxRunningScore = completedNonError * 40;
  const scorePct = maxRunningScore > 0 ? Math.round((runningScoreSum / maxRunningScore) * 100) : 0;

  // Group tasks by checkpoint for display
  const tasksByCheckpoint: Record<string, TaskResult[]> = {};
  for (const task of tasks) {
    if (!tasksByCheckpoint[task.checkpointId]) tasksByCheckpoint[task.checkpointId] = [];
    tasksByCheckpoint[task.checkpointId]!.push(task);
  }

  return (
    <div className="pt-24 pb-16">
      <div className="max-w-4xl mx-auto px-6">
        {/* Header */}
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="data-label text-cyan-400">V2 Live Benchmark</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/20 text-cyan-400 leading-none">V2</span>
          </div>
          <h1 className="text-3xl font-bold mb-2">{agentName}</h1>
          <p className="text-sm text-slate-500 font-mono truncate">{endpoint}</p>
        </div>

        {/* Error */}
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
              <div>
                <span className="font-semibold">
                  {isRunning
                    ? `Running... ${progress.completed}/${progress.total} tasks`
                    : complete
                      ? "Benchmark Complete"
                      : "Waiting..."}
                </span>
                {isRunning && checkpoints.length > 0 && (
                  <span className="text-xs text-slate-500 ml-2">
                    (checkpoint {checkpoints.length})
                  </span>
                )}
              </div>
            </div>
            <span className={`text-2xl font-bold tabular-nums ${scoreColor(scorePct)}`}>
              {scorePct}%
            </span>
          </div>

          <div className="mb-3">
            <ScoreBar percentage={progressPct} />
          </div>
          <div className="flex justify-between text-xs text-slate-500">
            <span>{progress.completed} of {progress.total} tasks</span>
            <span>{runningScoreSum.toFixed(0)}/{maxRunningScore} points</span>
          </div>

          {/* Multi-turn indicator */}
          {currentTurn && (
            <div className="mt-4 flex items-center gap-2 px-3 py-2 bg-cyan-500/10 border border-cyan-500/20 rounded-lg text-sm">
              <div className="animate-pulse w-2 h-2 rounded-full bg-cyan-400" />
              <span className="text-cyan-400">
                Turn {currentTurn.turnNumber}/{currentTurn.maxTurns}
              </span>
              {currentTurn.artifactRequested && (
                <span className="text-slate-400">
                  — requesting artifact: <span className="font-mono text-xs">{currentTurn.artifactRequested}</span>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Complete summary */}
        {complete && (
          <div className="bg-navy-900/40 rounded-2xl border border-emerald-500/20 p-6 mb-8">
            <h3 className="font-semibold text-lg mb-4 text-emerald-400">Final Results</h3>

            {/* Stats row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              {[
                { label: "Tasks", value: String(complete.tasksEvaluated) },
                { label: "Checkpoints", value: String(complete.checkpointsEvaluated) },
                { label: "Deals", value: String(complete.dealsEvaluated) },
                { label: "Avg Latency", value: `${(complete.avgLatencyMs / 1000).toFixed(1)}s` },
              ].map((s) => (
                <div key={s.label} className="bg-navy-900/50 rounded-lg p-3 text-center">
                  <div className="text-xs text-slate-500 mb-1">{s.label}</div>
                  <div className="text-lg font-bold text-white">{s.value}</div>
                </div>
              ))}
            </div>

            {/* 8-dimension grid (2 rows x 4 cols) */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              {V2_DIMENSION_KEYS.map((key) => {
                const value = complete.dimensions[key];
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

            {/* Task type breakdown in completion summary */}
            {tasks.length > 0 && (
              <div className="mb-6">
                <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">By Task Type</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {Object.entries(
                    tasks.reduce<Record<string, { sum: number; count: number }>>((acc, t) => {
                      if (t.error) return acc;
                      if (!acc[t.taskType]) acc[t.taskType] = { sum: 0, count: 0 };
                      const total = (t.scores.riskIdentification ?? 0) + (t.scores.nextStepQuality ?? 0)
                        + (t.scores.prioritization ?? 0) + (t.scores.outcomeAlignment ?? 0);
                      acc[t.taskType]!.sum += total;
                      acc[t.taskType]!.count++;
                      return acc;
                    }, {})
                  ).map(([type, data]) => {
                    const avg = data.count > 0 ? data.sum / data.count : 0;
                    const pct = Math.round((avg / 40) * 100);
                    const colors = taskTypeColor(type);
                    return (
                      <div key={type} className={`${colors.bg} border ${colors.border} rounded-lg p-3`}>
                        <div className={`text-xs font-medium ${colors.text} mb-1`}>{taskTypeLabel(type)}</div>
                        <div className={`text-lg font-bold ${scoreColor(pct)}`}>
                          {avg.toFixed(1)}/40
                        </div>
                        <div className="text-xs text-slate-500">{data.count} tasks</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3">
              {complete.runId && (
                <a
                  href={`/v2/results/${complete.runId}`}
                  onClick={(e) => {
                    e.preventDefault();
                    window.history.pushState({}, "", `/v2/results/${complete.runId}`);
                    window.dispatchEvent(new PopStateEvent("popstate"));
                  }}
                  className="flex-1 px-4 py-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 font-medium
                    hover:bg-cyan-500/20 transition-colors text-center text-sm"
                >
                  View Full Results
                </a>
              )}
              <a
                href="/v2/benchmark"
                onClick={(e) => {
                  e.preventDefault();
                  window.history.pushState({}, "", "/v2/benchmark");
                  window.dispatchEvent(new PopStateEvent("popstate"));
                }}
                className="flex-1 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-slate-300 font-medium
                  hover:bg-white/10 transition-colors text-center text-sm"
              >
                Back to V2 Leaderboard
              </a>
            </div>
          </div>
        )}

        {/* Task Results grouped by checkpoint */}
        {tasks.length > 0 && (
          <div className="bg-navy-900/40 rounded-2xl border border-white/5 overflow-hidden">
            <div className="p-5 border-b border-white/5">
              <h3 className="font-semibold">Task Results</h3>
            </div>

            <div className="divide-y divide-white/5">
              {Object.entries(tasksByCheckpoint).map(([cpId, cpTasks], cpIdx) => {
                // Check if there's a checkpoint divider event
                const cpEvent = checkpoints.find((c) => c.checkpointId === cpId);

                return (
                  <div key={cpId}>
                    {/* Checkpoint divider */}
                    {cpEvent && (
                      <div className="px-5 py-2 bg-navy-800/30 flex items-center gap-3 text-xs">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          cpEvent.mode === "public" ? "bg-cyan-500/20 text-cyan-400" : "bg-slate-500/20 text-slate-400"
                        }`}>
                          {cpEvent.mode}
                        </span>
                        <span className="text-slate-400 font-medium">{cpEvent.dealName}</span>
                        <span className="text-slate-600 font-mono">{cpId}</span>
                        <span className="text-slate-600 ml-auto">{cpEvent.tasksCompleted} tasks</span>
                      </div>
                    )}

                    {/* Task cards */}
                    {cpTasks.map((task, idx) => {
                      const taskTotal = (task.scores.riskIdentification ?? 0) + (task.scores.nextStepQuality ?? 0)
                        + (task.scores.prioritization ?? 0) + (task.scores.outcomeAlignment ?? 0);
                      const taskPct = task.error ? 0 : Math.round((taskTotal / 40) * 100);
                      const colors = taskTypeColor(task.taskType);

                      return (
                        <div
                          key={`${task.taskId}-${idx}`}
                          className="px-5 py-4"
                          style={{
                            animation: "fade-up 0.3s ease-out forwards",
                            animationDelay: `${idx * 0.02}s`,
                            opacity: 0,
                          }}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-3">
                              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colors.bg} ${colors.text} border ${colors.border}`}>
                                {taskTypeLabel(task.taskType)}
                              </span>
                              <span className="text-xs text-slate-600 font-mono">{task.taskId}</span>
                              {task.turnsUsed > 1 && (
                                <span className="text-xs text-slate-500">
                                  {task.turnsUsed} turns
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {task.error && <span className="text-xs text-red-400">error</span>}
                              <span className={`font-bold tabular-nums ${scoreColor(taskPct)}`}>
                                {task.error ? "0" : taskTotal.toFixed(1)}/40
                              </span>
                            </div>
                          </div>

                          {/* Dimension scores */}
                          {!task.error && (
                            <div className="flex flex-wrap gap-3 text-xs text-slate-500 mb-2">
                              {Object.entries(task.scores).map(([key, value]) => (
                                value !== undefined && (
                                  <span key={key}>{dimensionLabel(key)}: {value.toFixed(1)}</span>
                                )
                              ))}
                            </div>
                          )}

                          {/* Artifacts info */}
                          {task.artifactsRequested && task.artifactsRequested.length > 0 && (
                            <div className="text-xs text-slate-600 mb-1">
                              Artifacts requested: {task.artifactsRequested.length}
                            </div>
                          )}

                          {/* Feedback (public only) */}
                          {task.feedback && (
                            <p className="text-xs text-slate-400 leading-relaxed mt-1">{task.feedback}</p>
                          )}
                        </div>
                      );
                    })}
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

export default V2BenchmarkProgressPage;
