import { useState, useEffect, useCallback } from "react";

interface Deal {
  id: string;
  name: string;
  checkpointCount: number;
  finalOutcome?: string;
}

interface BenchmarkResult {
  agentId: string;
  agentEndpoint: string;
  mode: string;
  runTimestamp: string;
  dealResults: {
    dealId: string;
    checkpointEvaluations: {
      checkpointId: string;
      scores: {
        riskIdentification: number;
        nextStepQuality: number;
        prioritization: number;
        outcomeAlignment: number;
      };
      totalScore: number;
      maxScore: number;
      feedback: string;
      groundTruthComparison?: {
        risksIdentified: string[];
        risksMissed: string[];
        helpfulRecommendations: string[];
        unhelpfulRecommendations: string[];
      };
    }[];
    dealScore: number;
  }[];
  aggregateScore: number;
  maxPossibleScore: number;
}

interface BenchmarkRunnerProps {
  agentEndpoint?: string;
  apiKey?: string;
  onResultsReady?: (results: BenchmarkResult) => void;
}

// LocalStorage keys
const STORAGE_KEYS = {
  selectedDeals: "benchmark_selected_deals",
  lastMode: "benchmark_last_mode",
};

export function BenchmarkRunner({ agentEndpoint, apiKey, onResultsReady }: BenchmarkRunnerProps) {
  const [mode, setMode] = useState<"public" | "private">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem(STORAGE_KEYS.lastMode) as "public" | "private") || "public";
    }
    return "public";
  });
  const [deals, setDeals] = useState<Deal[]>([]);
  const [selectedDeals, setSelectedDeals] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ current: number; total: number; currentDeal?: string } | null>(null);

  // Load deals when mode changes
  useEffect(() => {
    loadDeals();
    // Save mode preference
    localStorage.setItem(STORAGE_KEYS.lastMode, mode);
  }, [mode]);

  // Auto-select all deals when they load (for better UX)
  useEffect(() => {
    if (deals.length > 0 && selectedDeals.length === 0) {
      // Check for saved selection
      const savedSelection = localStorage.getItem(`${STORAGE_KEYS.selectedDeals}_${mode}`);
      if (savedSelection) {
        try {
          const parsed = JSON.parse(savedSelection);
          const validSelection = parsed.filter((id: string) => deals.some((d) => d.id === id));
          if (validSelection.length > 0) {
            setSelectedDeals(validSelection);
            return;
          }
        } catch {
          // Ignore parse errors
        }
      }
      // Default: select all public deals
      if (mode === "public") {
        setSelectedDeals(deals.map((d) => d.id));
      }
    }
  }, [deals, mode]);

  // Save selection to localStorage
  useEffect(() => {
    if (selectedDeals.length > 0) {
      localStorage.setItem(`${STORAGE_KEYS.selectedDeals}_${mode}`, JSON.stringify(selectedDeals));
    }
  }, [selectedDeals, mode]);

  const loadDeals = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/benchmark/deals?mode=${mode}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to load deals");
      }

      setDeals(data.deals || []);
      setSelectedDeals([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load deals");
      setDeals([]);
    } finally {
      setIsLoading(false);
    }
  };

  const runBenchmark = useCallback(async (quickRun = false) => {
    const endpoint = agentEndpoint || window.location.origin + "/api/agent";
    const dealIdsToRun = quickRun ? [deals[0]?.id].filter(Boolean) : (selectedDeals.length > 0 ? selectedDeals : deals.map((d) => d.id));
    const totalCheckpoints = deals
      .filter((d) => dealIdsToRun.includes(d.id))
      .reduce((sum, d) => sum + d.checkpointCount, 0);

    setIsRunning(true);
    setError(null);
    setProgress({ current: 0, total: totalCheckpoints });

    try {
      const headers: HeadersInit = {
        "Content-Type": "application/json",
      };
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      const body: Record<string, unknown> = {
        mode: quickRun ? "public" : mode,
        endpoint,
      };
      if (!quickRun && selectedDeals.length > 0) {
        body.dealIds = selectedDeals;
      } else if (quickRun) {
        body.dealIds = [deals[0]?.id];
        body.limit = 1;
      }

      // Simulate progress updates (since the API doesn't stream progress)
      let progressInterval: ReturnType<typeof setInterval> | null = null;
      const dealsBeingRun = deals.filter((d) => (body.dealIds as string[])?.includes(d.id) || !body.dealIds);
      let currentDealIndex = 0;

      progressInterval = setInterval(() => {
        setProgress((prev) => {
          if (!prev) return prev;
          const newCurrent = Math.min(prev.current + 1, prev.total - 1);
          // Estimate which deal we're on
          let checkpointsSoFar = 0;
          for (let i = 0; i < dealsBeingRun.length; i++) {
            const deal = dealsBeingRun[i];
            if (!deal) continue;
            checkpointsSoFar += deal.checkpointCount;
            if (newCurrent < checkpointsSoFar) {
              currentDealIndex = i;
              break;
            }
          }
          return {
            current: newCurrent,
            total: prev.total,
            currentDeal: dealsBeingRun[currentDealIndex]?.name || dealsBeingRun[currentDealIndex]?.id,
          };
        });
      }, 3000); // Update every 3 seconds

      const res = await fetch("/api/benchmark/run", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (progressInterval) clearInterval(progressInterval);

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Benchmark failed");
      }

      setProgress({ current: totalCheckpoints, total: totalCheckpoints });
      onResultsReady?.(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Benchmark failed");
    } finally {
      setIsRunning(false);
      setProgress(null);
    }
  }, [agentEndpoint, apiKey, mode, selectedDeals, deals, onResultsReady]);

  const toggleDeal = (dealId: string) => {
    setSelectedDeals((prev) =>
      prev.includes(dealId)
        ? prev.filter((id) => id !== dealId)
        : [...prev, dealId]
    );
  };

  const selectAll = () => setSelectedDeals(deals.map((d) => d.id));
  const selectNone = () => setSelectedDeals([]);

  const totalCheckpoints = selectedDeals.length > 0
    ? deals.filter((d) => selectedDeals.includes(d.id)).reduce((sum, d) => sum + d.checkpointCount, 0)
    : deals.reduce((sum, d) => sum + d.checkpointCount, 0);

  return (
    <div className="bg-navy-900/40 rounded-2xl border border-white/5 overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
            <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <div className="font-semibold">Run Benchmark</div>
            <div className="text-xs text-slate-500">
              {agentEndpoint ? "Your agent" : "Reference agent"} • {totalCheckpoints} checkpoints
            </div>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Quick Run Button */}
        {!agentEndpoint && deals.length > 0 && (
          <button
            onClick={() => runBenchmark(true)}
            disabled={isRunning}
            className="w-full px-4 py-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 font-medium
              hover:bg-cyan-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed
              flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Quick Run (1 deal, reference agent)
          </button>
        )}

        {/* Mode Toggle */}
        <div>
          <div className="data-label mb-2">Benchmark Mode</div>
          <div className="flex rounded-xl bg-navy-800/50 p-1">
            <button
              onClick={() => setMode("public")}
              className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                mode === "public"
                  ? "bg-white/10 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <span className="flex items-center justify-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Public ({deals.filter(() => mode === "public").length || "5"} deals)
              </span>
            </button>
            <button
              onClick={() => setMode("private")}
              className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                mode === "private"
                  ? "bg-white/10 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <span className="flex items-center justify-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                Private ({deals.filter(() => mode === "private").length || "10"} deals)
              </span>
            </button>
          </div>
          <p className="text-xs text-slate-600 mt-2">
            {mode === "public"
              ? "Full feedback with ground truth visible"
              : "Score only - prevents overfitting"}
          </p>
        </div>

        {/* Deal Selection */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="data-label">Select Deals</div>
            <div className="flex gap-2">
              <button
                onClick={selectAll}
                className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                All
              </button>
              <span className="text-slate-600">|</span>
              <button
                onClick={selectNone}
                className="text-xs text-slate-500 hover:text-slate-400 transition-colors"
              >
                None
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className="bg-navy-800/30 rounded-xl p-6 text-center">
              <div className="animate-spin w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full mx-auto mb-2" />
              <div className="text-sm text-slate-500">Loading deals...</div>
            </div>
          ) : deals.length === 0 ? (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-center">
              <div className="text-amber-400 text-sm">
                No deals found. Run the checkpoint extraction script first.
              </div>
            </div>
          ) : (
            <div className="bg-navy-800/30 rounded-xl p-2 max-h-[200px] overflow-y-auto space-y-1">
              {deals.map((deal) => {
                const isSelected = selectedDeals.includes(deal.id);
                return (
                  <label
                    key={deal.id}
                    className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${
                      isSelected
                        ? "bg-cyan-500/10 border border-cyan-500/20"
                        : "hover:bg-white/5 border border-transparent"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleDeal(deal.id)}
                      className="sr-only"
                    />
                    <div
                      className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${
                        isSelected
                          ? "bg-cyan-500 border-cyan-500"
                          : "border-slate-600"
                      }`}
                    >
                      {isSelected && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{deal.name}</div>
                      <div className="text-xs text-slate-600 font-mono">{deal.id}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 tabular-nums">
                        {deal.checkpointCount} cp
                      </span>
                      {deal.finalOutcome && (
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full ${
                            deal.finalOutcome === "won"
                              ? "bg-emerald-500/20 text-emerald-400"
                              : deal.finalOutcome === "lost"
                              ? "bg-red-500/20 text-red-400"
                              : "bg-slate-500/20 text-slate-400"
                          }`}
                        >
                          {deal.finalOutcome}
                        </span>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-xl p-4 text-sm bg-red-500/10 border border-red-500/20 text-red-300">
            {error}
          </div>
        )}

        {/* Progress */}
        {progress && (
          <div className="rounded-xl p-4 bg-cyan-500/10 border border-cyan-500/20">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-cyan-300">
                {progress.currentDeal ? `Evaluating: ${progress.currentDeal}` : "Running benchmark..."}
              </span>
              <span className="text-xs text-cyan-400 tabular-nums">
                {progress.current}/{progress.total} checkpoints
              </span>
            </div>
            <div className="h-2 bg-navy-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Run Button */}
        <button
          onClick={() => runBenchmark(false)}
          disabled={isRunning || deals.length === 0}
          className="w-full px-4 py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 text-white font-semibold
            hover:shadow-lg hover:shadow-cyan-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none
            flex items-center justify-center gap-2"
        >
          {isRunning ? (
            <>
              <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
              Running...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              </svg>
              Run Benchmark
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default BenchmarkRunner;
