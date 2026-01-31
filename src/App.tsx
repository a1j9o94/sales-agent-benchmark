import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import "./index.css";

const EXAMPLE_SCENARIOS = {
  deal_prep: `# Scenario: Enterprise expansion blocked by security review

## Context
- 500-person fintech company, current customer at $25K/year
- Champion is VP of Operations (original buyer)
- CISO is blocking expansion due to AI data handling concerns
- They also use a competitor for core integrations

## Task
Research and prepare a briefing for a call with the CISO.
The goal is to address security concerns and unblock the expansion.

## What good looks like
- Identifies specific CISO concerns (AI model data retention, SOC 2 scope, etc.)
- Proposes concrete answers (data residency options, security certifications)
- Gives the champion talking points they can use internally
- Acknowledges competitor relationship without threatening it`,

  outreach: `# Scenario: Re-engage a stalled deal

## Context
- Mid-market SaaS company, 200 employees
- Had a great demo 3 weeks ago, champion went quiet
- Last message was "let me circle back with the team"
- They mentioned budget timing concerns

## Task
Draft a follow-up email to re-engage the champion.

## What good looks like
- Short (under 150 words)
- Acknowledges the gap without being pushy
- Offers something of value (case study, ROI calc, quick call)
- Has a clear, low-friction CTA
- Addresses the likely budget objection indirectly`,

  competitive: `# Scenario: Competitive displacement opportunity

## Context
- Prospect currently uses Make.com for their automation
- 1000-person retail company, ops team of 15
- Pain: hitting limits on complex workflows, need better error handling
- Decision maker: Director of Operations

## Task
Prepare competitive positioning and discovery questions for the first call.

## What good looks like
- Understands Make's specific limitations without badmouthing
- Frames around their pain (complexity, reliability) not features
- Suggests discovery questions to surface switching costs
- Identifies what would make them actually move (not just evaluate)`,
};

type EvalResult = {
  agentOutput: string;
  evaluation: {
    scores: Record<string, number>;
    total: number;
    maxScore: number;
    reasoning: string;
    passed: boolean;
  };
};

export function App() {
  const [scenario, setScenario] = useState(EXAMPLE_SCENARIOS.deal_prep);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<EvalResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runEval = async () => {
    setIsRunning(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Evaluation failed");
      }

      const data = await res.json();
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 text-white">
      {/* Hero */}
      <header className="container mx-auto px-6 py-16 text-center">
        <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
          Sales Agent Benchmark
        </h1>
        <p className="text-xl text-slate-400 max-w-2xl mx-auto mb-8">
          An open-source evaluation framework for sales AI agents.
          Test deal prep, outreach, competitive positioning, and more.
        </p>
        <div className="flex justify-center gap-4">
          <Button size="lg" onClick={() => document.getElementById("demo")?.scrollIntoView({ behavior: "smooth" })}>
            Try It
          </Button>
          <Button size="lg" variant="outline" asChild>
            <a href="https://github.com/a1j9o94/sales-agent-benchmark" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
          </Button>
        </div>
      </header>

      {/* Why This Exists */}
      <section className="container mx-auto px-6 py-12">
        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-lg">No Standard Exists</CardTitle>
            </CardHeader>
            <CardContent className="text-slate-400 text-sm">
              Coding agents have SWE-Bench. Research agents have BrowseComp.
              Sales agents have... nothing. Until now.
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-lg">Sales-Specific Rubrics</CardTitle>
            </CardHeader>
            <CardContent className="text-slate-400 text-sm">
              MEDDPICC coverage, email quality, ROI defensibility, competitive positioning.
              Grading criteria built by sales practitioners.
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-lg">Open & Extensible</CardTitle>
            </CardHeader>
            <CardContent className="text-slate-400 text-sm">
              Contribute scenarios from your own deal history (anonymized).
              Benchmark your agent against the community.
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Demo Section */}
      <section id="demo" className="container mx-auto px-6 py-12">
        <h2 className="text-3xl font-bold text-center mb-8">Try It</h2>

        <div className="max-w-4xl mx-auto grid gap-6">
          {/* Scenario Input */}
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle>Scenario</CardTitle>
              <CardDescription>
                Select an example or write your own sales scenario
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="example-select">Load Example</Label>
                <Select onValueChange={(v) => setScenario(EXAMPLE_SCENARIOS[v as keyof typeof EXAMPLE_SCENARIOS])}>
                  <SelectTrigger id="example-select" className="mt-1">
                    <SelectValue placeholder="Select an example scenario" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deal_prep">Deal Prep: Security Blocker</SelectItem>
                    <SelectItem value="outreach">Outreach: Re-engage Stalled Deal</SelectItem>
                    <SelectItem value="competitive">Competitive: Displacement Opportunity</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="scenario">Scenario (Markdown)</Label>
                <Textarea
                  id="scenario"
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value)}
                  className="mt-1 min-h-[300px] font-mono text-sm bg-slate-900 border-slate-600"
                  placeholder="Describe the sales scenario..."
                />
              </div>

              <Button
                onClick={runEval}
                disabled={isRunning || !scenario.trim()}
                className="w-full"
                size="lg"
              >
                {isRunning ? "Running Evaluation..." : "Run Evaluation"}
              </Button>
            </CardContent>
          </Card>

          {/* Error Display */}
          {error && (
            <Card className="bg-red-950/50 border-red-800">
              <CardContent className="pt-6">
                <p className="text-red-400">{error}</p>
              </CardContent>
            </Card>
          )}

          {/* Results */}
          {result && (
            <>
              {/* Agent Output */}
              <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader>
                  <CardTitle>Agent Output</CardTitle>
                  <CardDescription>What the sales agent generated</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="bg-slate-900 rounded-lg p-4 font-mono text-sm whitespace-pre-wrap max-h-[400px] overflow-y-auto">
                    {result.agentOutput}
                  </div>
                </CardContent>
              </Card>

              {/* Evaluation Results */}
              <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Evaluation</CardTitle>
                      <CardDescription>Graded by LLM judge using sales rubrics</CardDescription>
                    </div>
                    <div className={`text-2xl font-bold ${result.evaluation.passed ? "text-emerald-400" : "text-amber-400"}`}>
                      {result.evaluation.total}/{result.evaluation.maxScore}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Score Breakdown */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {Object.entries(result.evaluation.scores).map(([key, score]) => (
                      <div key={key} className="bg-slate-900 rounded-lg p-3 text-center">
                        <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">
                          {key.replace(/_/g, " ")}
                        </div>
                        <div className={`text-xl font-bold ${score >= 2 ? "text-emerald-400" : score >= 1 ? "text-amber-400" : "text-red-400"}`}>
                          {score}/2
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Reasoning */}
                  <div>
                    <Label className="text-slate-400">Judge Reasoning</Label>
                    <div className="mt-2 bg-slate-900 rounded-lg p-4 text-sm text-slate-300 whitespace-pre-wrap">
                      {result.evaluation.reasoning}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </section>

      {/* How to Contribute */}
      <section className="container mx-auto px-6 py-12">
        <h2 className="text-3xl font-bold text-center mb-8">Contribute</h2>
        <Card className="bg-slate-800/50 border-slate-700 max-w-2xl mx-auto">
          <CardContent className="pt-6 space-y-4 text-slate-300">
            <p>
              We're looking for <strong>design partners</strong> to help build the benchmark.
              Contribute anonymized scenarios from your sales history and get early access
              to benchmark your agents.
            </p>
            <div className="bg-slate-900 rounded-lg p-4 text-sm">
              <p className="font-medium mb-2">What we need:</p>
              <ul className="list-disc list-inside space-y-1 text-slate-400">
                <li>50-100 anonymized deal scenarios per company</li>
                <li>Diversity: different deal stages, blockers, industries</li>
                <li>Sales ops team to handle export/anonymization</li>
              </ul>
            </div>
            <div className="bg-slate-900 rounded-lg p-4 text-sm">
              <p className="font-medium mb-2">What you get:</p>
              <ul className="list-disc list-inside space-y-1 text-slate-400">
                <li>Benchmark your sales AI against a real standard</li>
                <li>Early access to the eval framework</li>
                <li>Credit as a founding contributor</li>
              </ul>
            </div>
            <Button variant="outline" className="w-full" asChild>
              <a href="mailto:hello@example.com">Get in Touch</a>
            </Button>
          </CardContent>
        </Card>
      </section>

      {/* Footer */}
      <footer className="container mx-auto px-6 py-8 text-center text-slate-500 text-sm border-t border-slate-800">
        <p>Built with the Vercel AI SDK. Open source on GitHub.</p>
      </footer>
    </div>
  );
}

export default App;
