import { useState } from "react";
import { AgentRegistration } from "@/components/AgentRegistration";
import { BenchmarkRunner } from "@/components/BenchmarkRunner";
import { ResultsTimeline } from "@/components/ResultsTimeline";
import { Leaderboard, addToLeaderboard } from "@/components/Leaderboard";
import "./index.css";

type Page = "home" | "benchmark" | "docs" | "faq";

type BenchmarkResult = {
  agentId: string;
  agentEndpoint: string;
  mode: string;
  runTimestamp: string;
  dealResults: any[];
  aggregateScore: number;
  maxPossibleScore: number;
};

// Navigation Component
function Nav({ activePage, setPage }: { activePage: Page; setPage: (p: Page) => void }) {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-navy-950/80 backdrop-blur-xl border-b border-white/5">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <button onClick={() => setPage("home")} className="flex items-center gap-3 group">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-emerald-500 flex items-center justify-center
            group-hover:shadow-lg group-hover:shadow-cyan-500/25 transition-shadow">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <span className="font-semibold tracking-tight">Sales Agent Benchmark</span>
        </button>

        <div className="flex items-center gap-1">
          {[
            { key: "home", label: "Home" },
            { key: "benchmark", label: "Benchmark" },
            { key: "docs", label: "Docs" },
            { key: "faq", label: "FAQ" },
          ].map((item) => (
            <button
              key={item.key}
              onClick={() => setPage(item.key as Page)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors
                ${activePage === item.key
                  ? "bg-white/10 text-white"
                  : "text-slate-400 hover:text-white hover:bg-white/5"}`}
            >
              {item.label}
            </button>
          ))}
          <a
            href="https://github.com/a1j9o94/sales-agent-benchmark"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-2 px-4 py-2 rounded-lg text-sm font-medium bg-white/5 text-slate-300 hover:bg-white/10 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
            </svg>
            GitHub
          </a>
        </div>
      </div>
    </nav>
  );
}

// Landing Page
function HomePage({ onGetStarted }: { onGetStarted: () => void }) {
  return (
    <div className="pt-16">
      {/* Hero */}
      <section className="relative min-h-[80vh] flex items-center justify-center overflow-hidden">
        {/* Background effects */}
        <div className="absolute inset-0 mesh-gradient" />
        <div className="absolute inset-0 grid-bg opacity-50" />
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/20 rounded-full blur-[128px]" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-[128px]" />

        <div className="relative z-10 max-w-5xl mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-sm text-slate-400 mb-8">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Now benchmarking 36 real deal checkpoints
          </div>

          <h1 className="text-6xl md:text-7xl font-bold tracking-tight mb-6">
            <span className="text-white">The Standard for</span>
            <br />
            <span className="bg-gradient-to-r from-cyan-400 via-emerald-400 to-cyan-400 bg-clip-text text-transparent text-glow-cyan">
              Sales AI Agents
            </span>
          </h1>

          <p className="text-xl text-slate-400 max-w-2xl mx-auto mb-12 leading-relaxed">
            SWE-Bench tests coding agents. BrowseComp tests research agents.
            <br />
            <strong className="text-slate-300">Sales Agent Benchmark</strong> tests what matters for revenue:
            risk identification, deal strategy, and accurate recommendations.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={onGetStarted}
              className="px-8 py-4 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 text-white font-semibold
                hover:shadow-lg hover:shadow-cyan-500/25 transition-all hover:scale-105"
            >
              Run the Benchmark
            </button>
            <a
              href="#how-it-works"
              className="px-8 py-4 rounded-xl bg-white/5 border border-white/10 text-slate-300 font-medium
                hover:bg-white/10 transition-colors"
            >
              See How It Works
            </a>
          </div>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="border-y border-white/5 bg-navy-900/50">
        <div className="max-w-5xl mx-auto px-6 py-8 grid grid-cols-2 md:grid-cols-4 gap-8">
          {[
            { value: "15", label: "Real Deals" },
            { value: "36", label: "Checkpoints" },
            { value: "4", label: "Scoring Dimensions" },
            { value: "Open", label: "Source" },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-3xl font-bold text-white tabular-nums">{stat.value}</div>
              <div className="text-sm text-slate-500 mt-1">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-24">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-16">
            <div className="data-label text-cyan-400 mb-4">How It Works</div>
            <h2 className="text-4xl font-bold">Bring Your Own Agent</h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: "01",
                title: "Register Your Endpoint",
                description: "Provide your agent's API URL. We'll send deal checkpoints, you return structured recommendations.",
                icon: (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                ),
              },
              {
                step: "02",
                title: "We Send Deal Context",
                description: "Real anonymized deal snapshots at key checkpoints. Your agent analyzes risks and recommends next steps.",
                icon: (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                ),
              },
              {
                step: "03",
                title: "Judge Against Ground Truth",
                description: "We compare your agent's recommendations against what actually happened. Did you spot the real risks?",
                icon: (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                ),
              },
            ].map((item) => (
              <div key={item.step} className="card-hover bg-navy-900/40 rounded-2xl border border-white/5 p-8">
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-12 h-12 rounded-xl bg-cyan-500/10 flex items-center justify-center">
                    <svg className="w-6 h-6 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      {item.icon}
                    </svg>
                  </div>
                  <span className="text-5xl font-bold text-navy-700">{item.step}</span>
                </div>
                <h3 className="text-xl font-semibold mb-3">{item.title}</h3>
                <p className="text-slate-400 leading-relaxed">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Scoring Dimensions */}
      <section className="py-24 bg-navy-900/30">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-16">
            <div className="data-label text-emerald-400 mb-4">Evaluation Criteria</div>
            <h2 className="text-4xl font-bold">Four Dimensions of Sales Intelligence</h2>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {[
              {
                title: "Risk Identification",
                score: "0-10",
                description: "Did the agent identify the actual risks that materialized? Missing a key blocker tanks the score.",
                color: "cyan",
              },
              {
                title: "Next Step Quality",
                score: "0-10",
                description: "Were the recommended actions actually helpful? We compare against what worked in the real deal.",
                color: "emerald",
              },
              {
                title: "Prioritization",
                score: "0-10",
                description: "Did the agent focus on what mattered most? Getting distracted by minor issues loses points.",
                color: "amber",
              },
              {
                title: "Outcome Alignment",
                score: "0-10",
                description: "Would following this advice have helped win the deal? Holistic assessment of strategic value.",
                color: "purple",
              },
            ].map((dim) => (
              <div key={dim.title} className="card-hover bg-navy-900/40 rounded-2xl border border-white/5 p-6 flex gap-6">
                <div className={`w-16 h-16 rounded-xl bg-${dim.color}-500/10 flex items-center justify-center flex-shrink-0`}>
                  <span className={`text-2xl font-bold text-${dim.color}-400`}>{dim.score}</span>
                </div>
                <div>
                  <h3 className="text-lg font-semibold mb-2">{dim.title}</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">{dim.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-4xl font-bold mb-6">Ready to Test Your Agent?</h2>
          <p className="text-xl text-slate-400 mb-8">
            Start with our public benchmark (5 deals, full feedback) or go straight to the private evaluation.
          </p>
          <button
            onClick={onGetStarted}
            className="px-8 py-4 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 text-white font-semibold
              hover:shadow-lg hover:shadow-cyan-500/25 transition-all hover:scale-105"
          >
            Start Benchmarking
          </button>
        </div>
      </section>
    </div>
  );
}

// Benchmark Page
function BenchmarkPage() {
  const [registeredAgent, setRegisteredAgent] = useState<{ endpoint: string; apiKey: string } | null>(null);
  const [benchmarkResults, setBenchmarkResults] = useState<BenchmarkResult | null>(null);

  const handleBenchmarkResults = (results: BenchmarkResult) => {
    setBenchmarkResults(results);
    addToLeaderboard(results);
  };

  return (
    <div className="pt-24 pb-16">
      <div className="max-w-7xl mx-auto px-6">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="data-label text-cyan-400 mb-4">Deal Progression Benchmark</div>
          <h1 className="text-4xl font-bold mb-4">Test Your Sales Agent</h1>
          <p className="text-slate-400 max-w-2xl mx-auto">
            We send real deal checkpoints to your agent. You return risk analysis and recommendations.
            Our judge evaluates against ground truth.
          </p>
        </div>

        {/* Main Grid */}
        <div className="grid lg:grid-cols-[400px_1fr] gap-8">
          {/* Left Sidebar */}
          <div className="space-y-6">
            <AgentRegistration
              onAgentRegistered={(agent) =>
                setRegisteredAgent({ endpoint: agent.endpoint, apiKey: agent.apiKey || "" })
              }
            />
            <BenchmarkRunner
              agentEndpoint={registeredAgent?.endpoint}
              apiKey={registeredAgent?.apiKey}
              onResultsReady={handleBenchmarkResults}
            />
          </div>

          {/* Results Area */}
          <div className="space-y-6">
            {benchmarkResults ? (
              <ResultsTimeline results={benchmarkResults} />
            ) : (
              <div className="bg-navy-900/40 rounded-2xl border border-white/5 p-12 text-center min-h-[400px] flex flex-col items-center justify-center">
                <div className="w-20 h-20 rounded-2xl bg-navy-800/50 flex items-center justify-center mb-6">
                  <svg className="w-10 h-10 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold mb-2">No Results Yet</h3>
                <p className="text-slate-500 max-w-md">
                  Register your agent endpoint or use our reference agent, select deals, and run the benchmark.
                </p>
              </div>
            )}
            <Leaderboard />
          </div>
        </div>
      </div>
    </div>
  );
}

// Docs Page
function DocsPage() {
  return (
    <div className="pt-24 pb-16">
      <div className="max-w-4xl mx-auto px-6">
        <div className="mb-12">
          <div className="data-label text-cyan-400 mb-4">Documentation</div>
          <h1 className="text-4xl font-bold mb-4">API Reference</h1>
          <p className="text-slate-400">Everything you need to integrate your sales agent with the benchmark.</p>
        </div>

        <div className="space-y-12">
          {/* API Contract */}
          <section>
            <h2 className="text-2xl font-bold mb-6 pb-4 border-b border-white/10">API Contract</h2>

            <div className="space-y-8">
              <div>
                <h3 className="text-lg font-semibold mb-4 text-cyan-400">Request (POST to your endpoint)</h3>
                <pre className="bg-navy-900 rounded-xl p-6 overflow-x-auto text-sm">
                  <code className="text-slate-300">{`{
  "checkpoint_id": "deal_001_checkpoint_2",
  "deal_context": {
    "company": "Acme Corp",
    "stage": "Discovery",
    "last_interaction": "Demo with VP Ops on Jan 16",
    "pain_points": ["Manual reporting taking 20hrs/week"],
    "stakeholders": [
      {"name": "John Smith", "role": "VP Operations", "sentiment": "positive"}
    ],
    "timeline": "Q1 budget decision",
    "history": "Initial call Jan 10, demo Jan 16..."
  },
  "question": "What are the top risks and recommended next steps?"
}`}</code>
                </pre>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-4 text-emerald-400">Expected Response</h3>
                <pre className="bg-navy-900 rounded-xl p-6 overflow-x-auto text-sm">
                  <code className="text-slate-300">{`{
  "risks": [
    {"description": "No technical champion identified", "severity": "high"},
    {"description": "Budget timeline unclear", "severity": "medium"}
  ],
  "next_steps": [
    {"action": "Schedule technical deep-dive with IT", "priority": 1},
    {"action": "Ask about Q1 budget process", "priority": 2}
  ],
  "confidence": 0.75,
  "reasoning": "The deal lacks technical validation..."
}`}</code>
                </pre>
              </div>
            </div>
          </section>

          {/* Data Format */}
          <section>
            <h2 className="text-2xl font-bold mb-6 pb-4 border-b border-white/10">Deal Context Fields</h2>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-white/10">
                    <th className="py-3 pr-4 font-medium text-slate-400">Field</th>
                    <th className="py-3 pr-4 font-medium text-slate-400">Type</th>
                    <th className="py-3 font-medium text-slate-400">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {[
                    ["company", "string", "Anonymized company name"],
                    ["stage", "string", "Current deal stage (Discovery, Evaluation, Negotiation, etc.)"],
                    ["last_interaction", "string", "Most recent activity with the prospect"],
                    ["pain_points", "string[]", "Identified customer pain points"],
                    ["stakeholders", "object[]", "Key people involved (name, role, sentiment)"],
                    ["timeline", "string", "Expected decision timeline"],
                    ["history", "string", "Summary of deal history to this point"],
                    ["meddpicc", "object", "MEDDPICC qualification status (optional)"],
                    ["hypothesis", "object", "Why they will/won't buy (optional)"],
                  ].map(([field, type, desc]) => (
                    <tr key={field}>
                      <td className="py-3 pr-4 font-mono text-cyan-400">{field}</td>
                      <td className="py-3 pr-4 text-slate-500">{type}</td>
                      <td className="py-3 text-slate-300">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Scoring */}
          <section>
            <h2 className="text-2xl font-bold mb-6 pb-4 border-b border-white/10">Scoring</h2>

            <p className="text-slate-400 mb-6">
              Each checkpoint is scored on 4 dimensions (0-10 each) for a maximum of 40 points per checkpoint.
            </p>

            <div className="grid md:grid-cols-2 gap-4">
              {[
                { name: "Risk Identification", desc: "Did you flag the risks that actually materialized?" },
                { name: "Next Step Quality", desc: "Were your recommendations actionable and correct?" },
                { name: "Prioritization", desc: "Did you focus on what mattered most?" },
                { name: "Outcome Alignment", desc: "Would this advice have helped win the deal?" },
              ].map((dim) => (
                <div key={dim.name} className="bg-navy-900/50 rounded-lg p-4">
                  <div className="font-medium mb-1">{dim.name}</div>
                  <div className="text-sm text-slate-500">{dim.desc}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// FAQ Page
function FAQPage() {
  const faqs = [
    {
      q: "What data do I need to provide?",
      a: "Just an API endpoint that accepts POST requests. We send you deal context, you return structured recommendations. See the Docs page for the exact format.",
    },
    {
      q: "Is my agent's output stored?",
      a: "During benchmark runs, outputs are processed in memory and not persisted. Only aggregate scores are stored for the leaderboard.",
    },
    {
      q: "What's the difference between public and private benchmarks?",
      a: "Public benchmarks (5 deals) show you full ground truth and detailed feedback—great for testing and debugging. Private benchmarks (10 deals) only show aggregate scores to prevent overfitting.",
    },
    {
      q: "How are the deal scenarios sourced?",
      a: "Real sales deal timelines, anonymized and stripped of identifying information. Each checkpoint represents a real moment in a deal's progression.",
    },
    {
      q: "Can I contribute my own deal scenarios?",
      a: "Yes! We're actively looking for design partners. If you have deal data you can anonymize, reach out—we'll credit founding contributors.",
    },
    {
      q: "What models power the judge?",
      a: "We use Claude Sonnet for evaluation. The judge compares your recommendations against what actually happened in the deal to score accuracy.",
    },
    {
      q: "How do I improve my score?",
      a: "Focus on specificity over generic advice. The best scores come from agents that identify concrete risks in the deal context and recommend targeted actions—not boilerplate sales methodology.",
    },
    {
      q: "Is this benchmark fair to different agent architectures?",
      a: "We aim to be architecture-agnostic. Whether you're using retrieval, fine-tuning, or prompt engineering, the API contract is the same. Let us know if you see bias.",
    },
  ];

  return (
    <div className="pt-24 pb-16">
      <div className="max-w-3xl mx-auto px-6">
        <div className="text-center mb-12">
          <div className="data-label text-cyan-400 mb-4">FAQ</div>
          <h1 className="text-4xl font-bold mb-4">Frequently Asked Questions</h1>
        </div>

        <div className="space-y-4">
          {faqs.map((faq, idx) => (
            <details
              key={idx}
              className="group card-hover bg-navy-900/40 rounded-xl border border-white/5 overflow-hidden"
            >
              <summary className="p-6 cursor-pointer list-none flex items-center justify-between">
                <span className="font-medium pr-8">{faq.q}</span>
                <svg
                  className="w-5 h-5 text-slate-500 transform transition-transform group-open:rotate-180"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>
              <div className="px-6 pb-6 text-slate-400 leading-relaxed">{faq.a}</div>
            </details>
          ))}
        </div>

        {/* Contribute CTA */}
        <div className="mt-16 bg-gradient-to-br from-cyan-500/10 to-emerald-500/10 rounded-2xl border border-cyan-500/20 p-8 text-center">
          <h3 className="text-2xl font-bold mb-4">Want to Contribute?</h3>
          <p className="text-slate-400 mb-6 max-w-lg mx-auto">
            We're looking for design partners with real sales data. Contribute anonymized deal scenarios
            and get credited as a founding contributor.
          </p>

          <div className="bg-navy-900/50 rounded-xl p-6 mb-6 text-left max-w-md mx-auto">
            <div className="font-medium mb-3">What we need:</div>
            <ul className="space-y-2 text-sm text-slate-400">
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 mt-1">✓</span>
                Deal context files with activity logs
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 mt-1">✓</span>
                Stakeholder info and timeline
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 mt-1">✓</span>
                Deal outcome (won/lost/stalled)
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 mt-1">✓</span>
                Ability to anonymize company/person names
              </li>
            </ul>
          </div>

          <a
            href="mailto:hello@example.com"
            className="inline-flex px-6 py-3 rounded-xl bg-white/10 text-white font-medium hover:bg-white/20 transition-colors"
          >
            Get in Touch
          </a>
        </div>
      </div>
    </div>
  );
}

// Footer
function Footer() {
  return (
    <footer className="border-t border-white/5 bg-navy-950/80">
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-emerald-500 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <span className="text-sm text-slate-500">Sales Agent Benchmark</span>
          </div>

          <div className="text-sm text-slate-500">
            Built with the Vercel AI SDK • Open source on{" "}
            <a href="https://github.com/a1j9o94/sales-agent-benchmark" className="text-slate-400 hover:text-white transition-colors">
              GitHub
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

// Main App
export function App() {
  const [page, setPage] = useState<Page>("home");

  return (
    <div className="min-h-screen bg-navy-950 text-white">
      <Nav activePage={page} setPage={setPage} />

      {page === "home" && <HomePage onGetStarted={() => setPage("benchmark")} />}
      {page === "benchmark" && <BenchmarkPage />}
      {page === "docs" && <DocsPage />}
      {page === "faq" && <FAQPage />}

      <Footer />
    </div>
  );
}

export default App;
