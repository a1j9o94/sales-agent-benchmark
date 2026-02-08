/**
 * Benchmark Runner API
 *
 * Orchestrates running the benchmark against a registered agent.
 */

import type {
  Deal,
  Checkpoint,
  AgentRequest,
  AgentResponse,
  BenchmarkResult,
  CheckpointEvaluation,
} from "../src/types/benchmark";
import { getRegisteredAgent, getAgentById } from "./register";
import { evaluateResponse } from "./evaluate-response";

// Import checkpoint data directly (bundled at build time)
// Public deals
import streamcoreMedia from "../data/checkpoints/public/streamcore-media.json";
import chillspaceTech from "../data/checkpoints/public/chillspace-tech.json";
import noteflowAi from "../data/checkpoints/public/noteflow-ai.json";
import velocitySystems from "../data/checkpoints/public/velocity-systems.json";
import summitLearning from "../data/checkpoints/public/summit-learning.json";

const PUBLIC_DEALS: Deal[] = [streamcoreMedia, chillspaceTech, noteflowAi, velocitySystems, summitLearning] as Deal[];

// Private deals - these would be imported similarly but kept secret
// For now, we'll use an empty array for private (can be populated later)
const PRIVATE_DEALS: Deal[] = [];

// Load all deals for a given mode
async function loadDeals(mode: "public" | "private"): Promise<Deal[]> {
  if (mode === "public") {
    return PUBLIC_DEALS;
  }
  return PRIVATE_DEALS;
}

// Send request to agent and get response
async function queryAgent(endpoint: string, checkpoint: Checkpoint): Promise<AgentResponse | null> {
  const request: AgentRequest = {
    checkpointId: checkpoint.id,
    dealContext: checkpoint.context,
    question: "What are the top risks and recommended next steps for this deal?",
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        checkpoint_id: request.checkpointId,
        deal_context: {
          company: request.dealContext.company,
          stage: request.dealContext.stage,
          amount: request.dealContext.amount,
          close_date: request.dealContext.closeDate,
          last_interaction: request.dealContext.lastInteraction,
          pain_points: request.dealContext.painPoints,
          stakeholders: request.dealContext.stakeholders,
          timeline: request.dealContext.timeline,
          hypothesis: request.dealContext.hypothesis,
          meddpicc: request.dealContext.meddpicc,
          competitive_landscape: request.dealContext.competitiveLandscape,
          tech_stack: request.dealContext.techStack,
          use_cases: request.dealContext.useCases,
          history: request.dealContext.history,
        },
        question: request.question,
      }),
    });

    if (!response.ok) {
      console.error(`Agent returned status ${response.status}`);
      return null;
    }

    const data = await response.json();

    // Normalize response format
    return {
      risks: data.risks || [],
      nextSteps: data.next_steps || data.nextSteps || [],
      confidence: data.confidence || 0,
      reasoning: data.reasoning || "",
    };
  } catch (error) {
    console.error("Failed to query agent:", error);
    return null;
  }
}

// Run benchmark for a single deal
async function runDealBenchmark(
  deal: Deal,
  endpoint: string,
  mode: "public" | "private"
): Promise<{ dealId: string; checkpointEvaluations: CheckpointEvaluation[]; dealScore: number }> {
  const evaluations: CheckpointEvaluation[] = [];
  let totalScore = 0;

  for (const checkpoint of deal.checkpoints) {
    // Query the agent
    const agentResponse = await queryAgent(endpoint, checkpoint);

    if (!agentResponse) {
      // Agent failed to respond - score 0
      evaluations.push({
        checkpointId: checkpoint.id,
        scores: {
          riskIdentification: 0,
          nextStepQuality: 0,
          prioritization: 0,
          outcomeAlignment: 0,
        },
        totalScore: 0,
        maxScore: 40,
        feedback: "Agent failed to respond to checkpoint",
      });
      continue;
    }

    // Evaluate the response
    const evaluation = await evaluateResponse(checkpoint, agentResponse, mode);
    evaluations.push(evaluation);
    totalScore += evaluation.totalScore;
  }

  return {
    dealId: deal.id,
    checkpointEvaluations: evaluations,
    dealScore: totalScore,
  };
}

export async function handleRunBenchmarkEndpoint(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await req.json();

    // Get mode (public or private)
    const mode: "public" | "private" = body.mode === "private" ? "private" : "public";

    // Get agent - either by API key, agent ID, or direct endpoint
    let endpoint: string;
    let agentId: string;

    const apiKey = req.headers.get("Authorization")?.replace("Bearer ", "");

    if (apiKey) {
      const agent = getRegisteredAgent(apiKey);
      if (!agent) {
        return Response.json({ error: "Invalid API key" }, { status: 401 });
      }
      endpoint = agent.endpoint;
      agentId = agent.id;
    } else if (body.agentId) {
      const agent = getAgentById(body.agentId);
      if (!agent) {
        return Response.json({ error: "Agent not found" }, { status: 404 });
      }
      endpoint = agent.endpoint;
      agentId = agent.id;
    } else if (body.endpoint) {
      // Allow direct endpoint for testing
      endpoint = body.endpoint;
      agentId = "direct_" + Date.now();
    } else {
      return Response.json(
        { error: "Either API key, agentId, or endpoint is required" },
        { status: 400 }
      );
    }

    // Load deals
    const deals = await loadDeals(mode);

    if (deals.length === 0) {
      return Response.json(
        { error: `No ${mode} deals found. Run the checkpoint extraction script first.` },
        { status: 404 }
      );
    }

    // Filter to specific deals if requested
    let dealsToRun = deals;
    if (body.dealIds && Array.isArray(body.dealIds)) {
      dealsToRun = deals.filter((d) => body.dealIds.includes(d.id));
      if (dealsToRun.length === 0) {
        return Response.json({ error: "No matching deals found" }, { status: 404 });
      }
    }

    // Limit number of deals if requested
    if (body.limit && typeof body.limit === "number") {
      dealsToRun = dealsToRun.slice(0, body.limit);
    }

    console.log(`Running ${mode} benchmark with ${dealsToRun.length} deals against ${endpoint}`);

    // Run benchmark for each deal
    const dealResults: BenchmarkResult["dealResults"] = [];
    let aggregateScore = 0;
    let maxPossibleScore = 0;

    for (const deal of dealsToRun) {
      console.log(`  Processing deal: ${deal.id} (${deal.checkpoints.length} checkpoints)`);
      const result = await runDealBenchmark(deal, endpoint, mode);
      dealResults.push(result);
      aggregateScore += result.dealScore;
      maxPossibleScore += deal.checkpoints.length * 40; // 4 dimensions * 10 points each
    }

    const benchmarkResult: BenchmarkResult = {
      agentId,
      agentEndpoint: endpoint,
      mode,
      runTimestamp: new Date().toISOString(),
      dealResults,
      aggregateScore,
      maxPossibleScore,
    };

    // For private mode, strip detailed ground truth comparisons
    if (mode === "private") {
      for (const dealResult of benchmarkResult.dealResults) {
        for (const eval_ of dealResult.checkpointEvaluations) {
          // Remove detailed comparison to prevent leaking ground truth
          delete eval_.groundTruthComparison;
          // Simplify feedback
          eval_.feedback = `Score: ${eval_.totalScore}/${eval_.maxScore}`;
        }
      }
    }

    return Response.json(benchmarkResult);
  } catch (error) {
    console.error("Benchmark error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Benchmark failed" },
      { status: 500 }
    );
  }
}

// Get available deals (without ground truth for private)
export async function handleDealsEndpoint(req: Request): Promise<Response> {
  if (req.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") === "private" ? "private" : "public";

  const deals = await loadDeals(mode);

  // For private mode, don't expose ground truth OR checkpoint contexts
  // This prevents users from studying the private test set
  const sanitizedDeals = deals.map((deal) => ({
    id: deal.id,
    name: deal.name,
    industry: deal.industry,
    checkpointCount: deal.checkpoints.length,
    // Public: include full checkpoints with context
    // Private: only include checkpoint ID and timestamp (no context - that's only sent during actual benchmark run)
    checkpoints:
      mode === "public"
        ? deal.checkpoints
        : deal.checkpoints.map((cp) => ({
            id: cp.id,
            timestamp: cp.timestamp,
            // context intentionally omitted for private mode
            // groundTruth intentionally omitted for private mode
          })),
    finalOutcome: mode === "public" ? deal.finalOutcome : undefined,
  }));

  return Response.json({
    mode,
    count: deals.length,
    deals: sanitizedDeals,
  });
}
