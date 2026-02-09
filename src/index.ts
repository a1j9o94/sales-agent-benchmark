import { serve } from "bun";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

// In development, use HMR with direct HTML import
// In production, serve built files from dist/
const isDev = process.env.NODE_ENV !== "production";

// For development: import HTML directly for HMR
// For production: we'll serve from dist/ directory
const devIndex = isDev ? (await import("./index.html")).default : null;

// Import benchmark API handlers
import { handleAgentEndpoint } from "../api/agent";
import {
  handleRegisterEndpoint,
  handleUnregisterEndpoint,
  handleTestEndpoint,
} from "../api/register";
import { handleRunBenchmarkEndpoint, handleDealsEndpoint } from "../api/run-benchmark";
import { handleEvaluateResponseEndpoint } from "../api/evaluate-response";
import {
  handleGetLeaderboard,
  handleGetAllRuns,
  handleSaveResult,
  handleInitDatabase,
} from "../api/results";
import { handleBenchmarkStream } from "../api/benchmark-stream";
import { handleBenchmarkStreamArtifact, handleArtifactDealsEndpoint } from "../api/benchmark-stream-artifact";
import { handleAgentResults, handleReferenceAgentResults } from "../api/agent-results";
import { handleReferenceAgent } from "../api/reference-agent";
import { handleGetArtifactLeaderboard, handleGetArtifactRunDetails } from "../api/results";
import { handleEvaluateArtifactEndpoint } from "../api/evaluate-response-artifact";

const SALES_AGENT_CONTEXT = `You are an expert sales analyst and strategist. Your role is to help with:

- Deal preparation and account research
- Competitive positioning and objection handling
- Outreach and follow-up messaging
- MEDDPICC qualification analysis
- ROI calculations and value propositions

When given a sales scenario, provide actionable, specific guidance. Be concise but thorough.
Focus on what will actually help close the deal, not generic advice.

Always consider:
- Who is the economic buyer and how do we reach them?
- What is the specific pain driving urgency?
- Who is our competition and how do we differentiate?
- What are the likely objections and how do we address them?
- What is the next concrete action?`;

const JUDGE_RUBRIC = `You are evaluating a sales AI agent's output for quality and effectiveness.

## Scoring Dimensions (0-2 each)
- 0: Not addressed or wrong
- 1: Mentioned but shallow or generic
- 2: Specific, actionable, shows sales intelligence

## Dimensions to Evaluate

**specificity**: Does the output address the specific situation, not generic advice?
**actionability**: Are there clear next steps someone could actually take?
**sales_iq**: Does it show understanding of sales dynamics (power, urgency, competition)?
**completeness**: Does it cover the key aspects of the task?
**conciseness**: Is it appropriately scoped, not padded or rambling?

## Output Format
Return ONLY valid JSON with this structure:
{
  "scores": {
    "specificity": 0-2,
    "actionability": 0-2,
    "sales_iq": 0-2,
    "completeness": 0-2,
    "conciseness": 0-2
  },
  "total": sum of scores,
  "maxScore": 10,
  "passed": true if total >= 7,
  "reasoning": "2-3 sentences explaining the evaluation"
}`;

async function handleEvaluate(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { scenario } = body;

    if (!scenario || typeof scenario !== "string") {
      return Response.json({ error: "Scenario is required" }, { status: 400 });
    }

    // Step 1: Run the sales agent
    const agentResult = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      system: SALES_AGENT_CONTEXT,
      prompt: scenario,
    });

    const agentOutput = agentResult.text;

    // Step 2: Judge the output
    const judgeResult = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      system: JUDGE_RUBRIC,
      prompt: `## Scenario\n${scenario}\n\n## Agent Output\n${agentOutput}`,
    });

    // Parse the judge's evaluation
    let evaluation;
    try {
      const jsonMatch = judgeResult.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in judge response");
      }
      evaluation = JSON.parse(jsonMatch[0]);
    } catch {
      evaluation = {
        scores: {
          specificity: 1,
          actionability: 1,
          sales_iq: 1,
          completeness: 1,
          conciseness: 1,
        },
        total: 5,
        maxScore: 10,
        passed: false,
        reasoning: "Could not parse evaluation. Raw response: " + judgeResult.text.slice(0, 200),
      };
    }

    return Response.json({
      agentOutput,
      evaluation,
    });
  } catch (error) {
    console.error("Evaluation error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Evaluation failed" },
      { status: 500 }
    );
  }
}

const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;

const server = serve({
  port,
  routes: {
    // Original evaluation API
    "/api/evaluate": {
      POST: handleEvaluate,
    },

    // Reference agent API - implements the benchmark contract
    "/api/agent": {
      POST: (req) => handleAgentEndpoint(req),
    },

    // Agent registration APIs
    "/api/register": {
      GET: handleRegisterEndpoint,
      POST: handleRegisterEndpoint,
      DELETE: handleUnregisterEndpoint,
    },

    // Test an agent endpoint before registering
    "/api/test-agent": {
      POST: handleTestEndpoint,
    },

    // Benchmark runner APIs
    "/api/benchmark/run": {
      POST: handleRunBenchmarkEndpoint,
    },

    "/api/benchmark/deals": {
      GET: handleDealsEndpoint,
    },

    // SSE streaming benchmark progress
    "/api/benchmark/stream": {
      POST: (req) => handleBenchmarkStream(req),
    },

    // Evaluate a single response (for debugging)
    "/api/benchmark/evaluate-response": {
      POST: (req) => handleEvaluateResponseEndpoint(req),
    },

    // Agent detailed results
    "/api/agent-results/:id": {
      GET: (req) => handleAgentResults(req),
    },

    // Reference agent results lookup
    "/api/reference-agent-results": {
      GET: (req) => handleReferenceAgentResults(req),
    },

    // Reference agent via OpenRouter (any model)
    "/api/reference-agent/:modelId": {
      POST: (req) => handleReferenceAgent(req),
    },

    // Results persistence APIs
    "/api/leaderboard": {
      GET: (req) => handleGetLeaderboard(req),
    },

    "/api/runs": {
      GET: (req) => handleGetAllRuns(req),
    },

    "/api/results": {
      POST: (req) => handleSaveResult(req),
    },

    "/api/init-db": {
      POST: (req) => handleInitDatabase(req),
    },

    // Artifact-Based API routes
    "/api/artifact/benchmark/stream": {
      POST: (req) => handleBenchmarkStreamArtifact(req),
    },

    "/api/artifact/benchmark/deals": {
      GET: (req) => handleArtifactDealsEndpoint(req),
    },

    "/api/artifact/benchmark/evaluate": {
      POST: (req) => handleEvaluateArtifactEndpoint(req),
    },

    "/api/artifact/leaderboard": {
      GET: (req) => handleGetArtifactLeaderboard(req),
    },

    "/api/artifact/agent-results/:id": {
      GET: (req) => handleGetArtifactRunDetails(req),
    },

    "/api/artifact/reference-agent/:modelId": {
      POST: (req) => handleReferenceAgent(req),
    },

    // Keep the hello endpoints for testing
    "/api/hello": {
      async GET() {
        return Response.json({
          message: "Hello, world!",
          method: "GET",
        });
      },
      async PUT() {
        return Response.json({
          message: "Hello, world!",
          method: "PUT",
        });
      },
    },

    "/api/hello/:name": async (req) => {
      const name = req.params.name;
      return Response.json({
        message: `Hello, ${name}!`,
      });
    },

    // Serve static files in production, or use HMR in development
    "/*": isDev && devIndex
      ? devIndex
      : async (req: Request) => {
          const url = new URL(req.url);
          let path = url.pathname;

          // Try to serve the exact file from dist/
          let file = Bun.file(`dist${path}`);
          if (await file.exists()) {
            return new Response(file);
          }

          // For SPA routing, serve index.html for non-file paths
          file = Bun.file("dist/index.html");
          if (await file.exists()) {
            return new Response(file, {
              headers: { "Content-Type": "text/html" },
            });
          }

          return new Response("Not found", { status: 404 });
        },
  },

  development: isDev && {
    hmr: true,
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
console.log(`
Benchmark API Endpoints:

  V1:
  POST /api/agent                        - Reference sales agent
  POST /api/register                     - Register your agent endpoint
  POST /api/benchmark/stream             - Stream benchmark progress (SSE)
  GET  /api/benchmark/deals              - Get available deals
  GET  /api/leaderboard                  - Get leaderboard rankings
  GET  /api/runs                         - Get all benchmark runs
  POST /api/results                      - Save benchmark results
  GET  /api/agent-results/:id            - Get detailed results for a run
  POST /api/reference-agent/:modelId     - Reference agent via OpenRouter
  POST /api/init-db                      - Initialize database tables

  Artifact-Based:
  POST /api/artifact/benchmark/stream          - Stream artifact-based benchmark progress (SSE)
  GET  /api/artifact/benchmark/deals           - Get available artifact-based deals
  POST /api/artifact/benchmark/evaluate        - Evaluate an artifact-based task
  GET  /api/artifact/leaderboard               - Get artifact-based leaderboard rankings
  GET  /api/artifact/agent-results/:id         - Get artifact-based run details
  POST /api/artifact/reference-agent/:modelId  - Artifact-based reference agent via OpenRouter
`);
