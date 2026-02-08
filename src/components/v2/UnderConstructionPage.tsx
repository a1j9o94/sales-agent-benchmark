export function UnderConstructionPage() {
  return (
    <div className="pt-16">
      {/* Hero */}
      <section className="relative min-h-[60vh] flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 mesh-gradient" />
        <div className="absolute inset-0 grid-bg opacity-50" />
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/20 rounded-full blur-[128px]" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-[128px]" />

        <div className="relative z-10 max-w-4xl mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-sm text-slate-400 mb-8">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            Under Construction
          </div>

          <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-6">
            <span className="bg-gradient-to-r from-cyan-400 via-emerald-400 to-cyan-400 bg-clip-text text-transparent text-glow-cyan">
              V2 Benchmark
            </span>
            <br />
            <span className="text-white">Coming Soon</span>
          </h1>

          <p className="text-xl text-slate-400 max-w-2xl mx-auto mb-12 leading-relaxed">
            Real-world evaluation with actual deal artifacts — call transcripts, email threads, CRM data.
          </p>

          <a
            href="/benchmark"
            onClick={(e) => {
              e.preventDefault();
              window.history.pushState({}, "", "/benchmark");
              window.dispatchEvent(new PopStateEvent("popstate"));
            }}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white/5 border border-white/10 text-slate-300 font-medium hover:bg-white/10 transition-colors"
          >
            View current benchmark results
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </a>
        </div>
      </section>

      {/* Progress */}
      <section className="py-16 border-t border-white/5">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-12">
            <div className="data-label text-cyan-400 mb-4">Build Progress</div>
            <h2 className="text-3xl font-bold">Workstreams</h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                title: "Data Pipeline",
                description: "Processing real deal artifacts",
                status: "In Progress",
                statusColor: "text-amber-400 bg-amber-500/10",
                progress: 70,
                progressColor: "from-amber-500 to-amber-400",
              },
              {
                title: "Evaluation System",
                description: "Task-specific multi-judge scoring",
                status: "Up Next",
                statusColor: "text-slate-400 bg-white/5",
                progress: 15,
                progressColor: "from-slate-500 to-slate-400",
              },
              {
                title: "Frontend",
                description: "You're looking at it",
                status: "In Progress",
                statusColor: "text-cyan-400 bg-cyan-500/10",
                progress: 25,
                progressColor: "from-cyan-500 to-cyan-400",
              },
            ].map((ws) => (
              <div key={ws.title} className="card-hover bg-navy-900/40 rounded-2xl border border-white/5 p-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold">{ws.title}</h3>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${ws.statusColor}`}>
                    {ws.status}
                  </span>
                </div>
                <p className="text-sm text-slate-400 mb-4">{ws.description}</p>
                <div className="h-1.5 bg-navy-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full bg-gradient-to-r ${ws.progressColor} rounded-full transition-all duration-1000`}
                    style={{ width: `${ws.progress}%` }}
                  />
                </div>
                <div className="text-xs text-slate-600 mt-2 text-right">{ws.progress}%</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What's New in V2 */}
      <section className="py-16 bg-navy-900/30">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-12">
            <div className="data-label text-emerald-400 mb-4">Improvements</div>
            <h2 className="text-3xl font-bold">What's New in V2</h2>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {/* 8 Scoring Dimensions */}
            <div className="bg-navy-900/40 rounded-2xl border border-white/5 p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center">
                  <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold">8 Scoring Dimensions</h3>
                  <p className="text-xs text-slate-500">Up from 4 in v1</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  "Risk Identification",
                  "Next Steps",
                  "Prioritization",
                  "Outcome Alignment",
                  "Stakeholder Mapping",
                  "Deal Qualification",
                  "Info Synthesis",
                  "Communication Quality",
                ].map((dim, i) => (
                  <div
                    key={dim}
                    className={`px-3 py-2 rounded-lg text-sm ${
                      i < 4
                        ? "bg-white/5 text-slate-400"
                        : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    }`}
                  >
                    {dim}
                    {i >= 4 && <span className="text-[10px] ml-1 text-emerald-500">NEW</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* Multi-turn + Artifact-based */}
            <div className="space-y-6">
              <div className="bg-navy-900/40 rounded-2xl border border-white/5 p-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                    <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <h3 className="font-semibold">Multi-Turn Evaluation</h3>
                </div>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Agents can request more context before answering. Just like a real sales rep
                  would ask clarifying questions before making a recommendation.
                </p>
              </div>

              <div className="bg-navy-900/40 rounded-2xl border border-white/5 p-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                    <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <h3 className="font-semibold">Artifact-Based</h3>
                </div>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Real transcripts, emails, and CRM data instead of summaries. Agents work with
                  the same raw materials a human rep would see.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats comparison */}
      <section className="border-t border-white/5 bg-navy-900/50">
        <div className="max-w-4xl mx-auto px-6 py-8 grid grid-cols-2 md:grid-cols-4 gap-8">
          {[
            { value: "14", label: "Real Deals", sub: "from 15" },
            { value: "38", label: "Checkpoints", sub: "from 36" },
            { value: "8", label: "Scoring Dimensions", sub: "from 4" },
            { value: "92", label: "Eval Tasks", sub: "new" },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-3xl font-bold text-white tabular-nums">{stat.value}</div>
              <div className="text-sm text-slate-500 mt-1">{stat.label}</div>
              <div className="text-xs text-emerald-500 mt-0.5">{stat.sub}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default UnderConstructionPage;
