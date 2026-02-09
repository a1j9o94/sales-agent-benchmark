import { useState } from "react";

interface RegisteredAgent {
  id: string;
  endpoint: string;
  name?: string;
  registeredAt: string;
  apiKey?: string;
}

interface AgentRegistrationProps {
  onAgentRegistered?: (agent: RegisteredAgent) => void;
}

export function AgentRegistration({ onAgentRegistered }: AgentRegistrationProps) {
  const [endpoint, setEndpoint] = useState("");
  const [name, setName] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    latency?: number;
    error?: string;
    validationErrors?: string[];
  } | null>(null);
  const [registeredAgent, setRegisteredAgent] = useState<RegisteredAgent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const testEndpoint = async () => {
    if (!endpoint) return;

    setIsTesting(true);
    setTestResult(null);
    setError(null);

    try {
      const res = await fetch("/api/test-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      });

      const data = await res.json();
      setTestResult(data);
    } catch (e) {
      setTestResult({
        success: false,
        error: e instanceof Error ? e.message : "Test failed",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const registerAgent = async () => {
    if (!endpoint) return;

    setIsRegistering(true);
    setError(null);

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint, name: name || undefined }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Registration failed");
      }

      setRegisteredAgent(data.agent);
      onAgentRegistered?.(data.agent);

      // Navigate to the benchmark progress page to start running
      const progressUrl = `/run/new?endpoint=${encodeURIComponent(data.agent.endpoint)}&name=${encodeURIComponent(data.agent.name || name || "My Agent")}`;
      window.history.pushState({}, "", progressUrl);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed");
    } finally {
      setIsRegistering(false);
    }
  };

  const useReferenceAgent = () => {
    window.open("https://github.com/a1j9o94/sales-agent-benchmark/blob/main/api/reference-agent.ts", "_blank");
  };

  if (registeredAgent) {
    return (
      <div className="bg-navy-900/40 rounded-2xl border border-emerald-500/30 overflow-hidden">
        <div className="p-5 border-b border-white/5 bg-emerald-500/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <div className="font-semibold text-emerald-400">Agent Registered</div>
              <div className="text-xs text-slate-500">Save your API key - it won't be shown again</div>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="space-y-3">
            <div>
              <div className="data-label mb-1">Agent ID</div>
              <div className="font-mono text-sm bg-navy-800/50 rounded-lg px-3 py-2 break-all">
                {registeredAgent.id}
              </div>
            </div>
            <div>
              <div className="data-label mb-1">Endpoint</div>
              <div className="font-mono text-sm bg-navy-800/50 rounded-lg px-3 py-2 break-all text-slate-400">
                {registeredAgent.endpoint}
              </div>
            </div>
            {registeredAgent.apiKey && (
              <div>
                <div className="data-label mb-1 text-emerald-400">API Key</div>
                <div className="font-mono text-sm bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 break-all text-emerald-300">
                  {registeredAgent.apiKey}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => setRegisteredAgent(null)}
            className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-slate-300 font-medium
              hover:bg-white/10 transition-colors text-sm"
          >
            Register Another Agent
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-navy-900/40 rounded-2xl border border-white/5 overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center">
            <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          </div>
          <div>
            <div className="font-semibold">Connect Your Agent</div>
            <div className="text-xs text-slate-500">Provide your API endpoint to participate</div>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Endpoint Input */}
        <div>
          <label className="data-label mb-2 block">Agent Endpoint URL</label>
          <input
            type="url"
            placeholder="https://your-agent.com/api/sales"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-navy-800/50 border border-white/10 text-white placeholder-slate-600
              focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-colors font-mono text-sm"
          />
          <p className="text-xs text-slate-600 mt-2">
            Must accept POST requests and return structured response
          </p>
        </div>

        {/* Name Input */}
        <div>
          <label className="data-label mb-2 block">Agent Name <span className="text-slate-600">(optional)</span></label>
          <input
            placeholder="My Sales Agent v1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-navy-800/50 border border-white/10 text-white placeholder-slate-600
              focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-colors text-sm"
          />
        </div>

        {/* Quick Actions */}
        <div className="flex gap-2">
          <button
            onClick={useReferenceAgent}
            className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-300 text-sm font-medium
              hover:bg-white/10 transition-colors"
          >
            View Reference Agent
          </button>
          <button
            onClick={testEndpoint}
            disabled={!endpoint || isTesting}
            className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-300 text-sm font-medium
              hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isTesting ? "Testing..." : "Test Endpoint"}
          </button>
        </div>

        {/* Test Result */}
        {testResult && (
          <div
            className={`rounded-xl p-4 text-sm ${
              testResult.success
                ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"
                : "bg-red-500/10 border border-red-500/20 text-red-300"
            }`}
          >
            {testResult.success ? (
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Test passed ({testResult.latency}ms latency)
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Test failed: {testResult.error}
                </div>
                {testResult.validationErrors && (
                  <ul className="mt-2 space-y-1 pl-6">
                    {testResult.validationErrors.map((e, i) => (
                      <li key={i} className="text-xs">• {e}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-xl p-4 text-sm bg-red-500/10 border border-red-500/20 text-red-300">
            {error}
          </div>
        )}

        {/* Register Button */}
        <button
          onClick={registerAgent}
          disabled={!endpoint || isRegistering}
          className="w-full px-4 py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 text-white font-semibold
            hover:shadow-lg hover:shadow-cyan-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
        >
          {isRegistering ? "Registering..." : "Register Agent"}
        </button>
      </div>
    </div>
  );
}

export default AgentRegistration;
