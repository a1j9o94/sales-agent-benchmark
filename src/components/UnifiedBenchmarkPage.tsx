import { useState, useEffect } from "react";
import { AgentRegistration } from "@/components/AgentRegistration";
import { Leaderboard } from "@/components/Leaderboard";
import { V2Leaderboard } from "@/components/v2/V2Leaderboard";

type BenchmarkTab = "summary" | "artifact-based";

function getTabFromURL(): BenchmarkTab {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab");
  return tab === "artifact-based" ? "artifact-based" : "summary";
}

export function UnifiedBenchmarkPage() {
  const [activeTab, setActiveTab] = useState<BenchmarkTab>(getTabFromURL);
  const [showTestAgent, setShowTestAgent] = useState(false);
  const [registeredAgent, setRegisteredAgent] = useState<{ endpoint: string; apiKey: string } | null>(null);

  // Sync tab with URL
  useEffect(() => {
    const handlePopState = () => setActiveTab(getTabFromURL());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const switchTab = (tab: BenchmarkTab) => {
    setActiveTab(tab);
    const url = tab === "summary" ? "/benchmark" : "/benchmark?tab=artifact-based";
    window.history.pushState({}, "", url);
  };

  return (
    <div className="pt-24 pb-16">
      <div className="max-w-7xl mx-auto px-6">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="data-label text-cyan-400 mb-4">Sales Agent Benchmark</div>
          <h1 className="text-4xl font-bold mb-4">Model Leaderboard</h1>
          <p className="text-slate-400 max-w-2xl mx-auto">
            How do top LLMs perform at sales deal analysis? Compare models across
            summary-based and artifact-based evaluations.
          </p>
        </div>

        {/* Tab Toggle */}
        <div className="flex justify-center mb-10">
          <div className="inline-flex rounded-xl bg-navy-900/60 border border-white/5 p-1">
            <button
              onClick={() => switchTab("summary")}
              className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === "summary"
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-lg shadow-cyan-500/10"
                  : "text-slate-400 hover:text-white hover:bg-white/5 border border-transparent"
              }`}
            >
              Summary Benchmark
            </button>
            <button
              onClick={() => switchTab("artifact-based")}
              className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === "artifact-based"
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-lg shadow-cyan-500/10"
                  : "text-slate-400 hover:text-white hover:bg-white/5 border border-transparent"
              }`}
            >
              Artifact-Based Benchmark
            </button>
          </div>
        </div>

        {/* Active Tab Content */}
        <div className="mb-12">
          {activeTab === "summary" ? <Leaderboard /> : <V2Leaderboard />}
        </div>

        {/* Test Your Agent Section */}
        <div className="border-t border-white/5 pt-12">
          <button
            onClick={() => setShowTestAgent(!showTestAgent)}
            className="w-full flex items-center justify-between p-6 bg-navy-900/40 rounded-2xl border border-white/5 hover:bg-navy-900/60 transition-colors group"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-emerald-500/20 flex items-center justify-center">
                <svg className="w-6 h-6 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="text-left">
                <h3 className="text-lg font-semibold">Test Your Own Agent</h3>
                <p className="text-sm text-slate-500">Connect your API endpoint and run the benchmark</p>
              </div>
            </div>
            <svg
              className={`w-6 h-6 text-slate-400 transition-transform ${showTestAgent ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showTestAgent && (
            <div className="mt-6 max-w-xl animate-fade-up">
              <AgentRegistration
                onAgentRegistered={(agent) =>
                  setRegisteredAgent({ endpoint: agent.endpoint, apiKey: agent.apiKey || "" })
                }
              />
              {registeredAgent && (
                <div className="mt-4 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                  <div className="flex items-center gap-2 text-emerald-400">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="font-medium">Agent registered!</span>
                  </div>
                  <p className="text-sm text-slate-400 mt-1">
                    Your agent will be included in the next benchmark run.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default UnifiedBenchmarkPage;
