/**
 * SSE Benchmark Streaming Endpoint
 *
 * Streams benchmark progress to the client as Server-Sent Events.
 * POST /api/benchmark/stream
 * Body: { "endpoint": "https://my-agent.example.com/api", "agentName": "My Agent" }
 *
 * SSE Events:
 * - { "type": "checkpoint", "checkpointId": "...", "score": 32, "maxScore": 40, "feedback": "..." | null, "progress": { "completed": 5, "total": 36 } }
 * - { "type": "complete", "runId": 123, "finalScore": 1114, "maxScore": 1440 }
 * - { "type": "error", "message": "..." }
 */

import type {
  Deal,
  Checkpoint,
  AgentRequest,
  AgentResponse,
  EvaluationScores,
} from "../src/types/benchmark";
import { evaluateResponse } from "./evaluate-response";
import { saveBenchmarkRun } from "./results";

// Load deals from a directory (same pattern as scripts/benchmark-models.ts)
async function loadDealsFromDir(dirPath: string): Promise<Deal[]> {
  const deals: Deal[] = [];
  try {
    const dir = await Bun.$`ls ${dirPath}/*.json`.text();
    const files = dir.trim().split("\n").filter(Boolean);
    for (const filePath of files) {
      try {
        const file = Bun.file(filePath.trim());
        const content = await file.json();
        deals.push(content as Deal);
      } catch (error) {
        console.error(`Failed to load ${filePath}:`, error);
      }
    }
  } catch (error) {
    console.error(`Failed to list deals in ${dirPath}:`, error);
  }
  return deals;
}

// Sales agent system prompt (same as scripts/benchmark-models.ts)
const SALES_AGENT_QUESTION = "What are the top risks and recommended next steps for this deal?";

// Build the request to send to the user's agent endpoint
function buildAgentRequest(checkpoint: Checkpoint): AgentRequest {
  return {
    checkpointId: checkpoint.id,
    dealContext: checkpoint.context,
    question: SALES_AGENT_QUESTION,
  };
}

// Call the user's agent endpoint
async function callAgentEndpoint(
  endpoint: string,
  request: AgentRequest
): Promise<AgentResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Agent returned ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();

    // Normalize response
    return {
      risks: (data.risks || []).map((r: Record<string, unknown>) => ({
        description: String(r.description || "Unknown risk"),
        severity: ["high", "medium", "low"].includes(r.severity as string)
          ? (r.severity as "high" | "medium" | "low")
          : "medium",
      })),
      nextSteps: (data.nextSteps || data.next_steps || []).map(
        (s: Record<string, unknown>, idx: number) => ({
          action: String(s.action || "No action specified"),
          priority: typeof s.priority === "number" ? s.priority : idx + 1,
          rationale: s.rationale as string | undefined,
        })
      ),
      confidence:
        typeof data.confidence === "number"
          ? Math.min(1, Math.max(0, data.confidence))
          : 0.5,
      reasoning: String(data.reasoning || "No reasoning provided"),
    };
  } finally {
    clearTimeout(timeout);
  }
}

// Generate a simple agent ID from the endpoint URL
function agentIdFromEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return `agent_${url.hostname.replace(/\./g, "_")}`;
  } catch {
    return `agent_${Date.now()}`;
  }
}

export async function handleBenchmarkStream(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  let body: { endpoint?: string; agentName?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { endpoint, agentName } = body;
  if (!endpoint) {
    return Response.json({ error: "endpoint is required" }, { status: 400 });
  }

  // Load all deals
  const [publicDeals, privateDeals] = await Promise.all([
    loadDealsFromDir("data/checkpoints/public"),
    loadDealsFromDir("data/checkpoints/private"),
  ]);

  // Count total checkpoints
  const totalCheckpoints =
    publicDeals.reduce((sum, d) => sum + d.checkpoints.length, 0) +
    privateDeals.reduce((sum, d) => sum + d.checkpoints.length, 0);

  if (totalCheckpoints === 0) {
    return Response.json({ error: "No deals found" }, { status: 500 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      let completed = 0;
      let totalScore = 0;
      let totalMaxScore = 0;
      let totalLatencyMs = 0;
      let dealsEvaluated = 0;
      const aggregatedScores: EvaluationScores = {
        riskIdentification: 0,
        nextStepQuality: 0,
        prioritization: 0,
        outcomeAlignment: 0,
      };

      const processDeal = async (deal: Deal, mode: "public" | "private") => {
        for (const checkpoint of deal.checkpoints) {
          try {
            const request = buildAgentRequest(checkpoint);
            const startTime = Date.now();
            const response = await callAgentEndpoint(endpoint, request);
            const latencyMs = Date.now() - startTime;
            totalLatencyMs += latencyMs;

            // Evaluate with single judge (Claude Sonnet) for speed
            const evaluation = await evaluateResponse(checkpoint, response, mode);

            totalScore += evaluation.totalScore;
            totalMaxScore += evaluation.maxScore;
            completed++;

            aggregatedScores.riskIdentification += evaluation.scores.riskIdentification;
            aggregatedScores.nextStepQuality += evaluation.scores.nextStepQuality;
            aggregatedScores.prioritization += evaluation.scores.prioritization;
            aggregatedScores.outcomeAlignment += evaluation.scores.outcomeAlignment;

            send({
              type: "checkpoint",
              checkpointId: checkpoint.id,
              dealId: deal.id,
              dealName: deal.name,
              mode,
              score: evaluation.totalScore,
              maxScore: evaluation.maxScore,
              feedback: mode === "public" ? evaluation.feedback : null,
              scores: evaluation.scores,
              progress: { completed, total: totalCheckpoints },
            });
          } catch (error) {
            completed++;
            totalMaxScore += 40;
            send({
              type: "checkpoint",
              checkpointId: checkpoint.id,
              dealId: deal.id,
              dealName: deal.name,
              mode,
              score: 0,
              maxScore: 40,
              feedback: mode === "public"
                ? `Error: ${error instanceof Error ? error.message : "Unknown error"}`
                : null,
              scores: { riskIdentification: 0, nextStepQuality: 0, prioritization: 0, outcomeAlignment: 0 },
              progress: { completed, total: totalCheckpoints },
              error: true,
            });
          }
        }
        dealsEvaluated++;
      };

      try {
        // Process public deals first (show feedback)
        for (const deal of publicDeals) {
          await processDeal(deal, "public");
        }

        // Process private deals (score only)
        for (const deal of privateDeals) {
          await processDeal(deal, "private");
        }

        // Calculate averages
        if (completed > 0) {
          aggregatedScores.riskIdentification /= completed;
          aggregatedScores.nextStepQuality /= completed;
          aggregatedScores.prioritization /= completed;
          aggregatedScores.outcomeAlignment /= completed;
        }
        const avgLatencyMs = completed > 0 ? Math.round(totalLatencyMs / completed) : 0;

        // Save to database
        const agentId = agentIdFromEndpoint(endpoint);
        let runId: number | null = null;
        try {
          runId = await saveBenchmarkRun({
            agentId,
            agentEndpoint: endpoint,
            agentName: agentName || undefined,
            mode: "public", // Appears on main leaderboard
            aggregateScore: totalScore,
            maxPossibleScore: totalMaxScore,
            dealsEvaluated,
            checkpointsEvaluated: completed,
            avgLatencyMs,
            runTimestamp: new Date().toISOString(),
            scores: {
              riskIdentification: Math.round(aggregatedScores.riskIdentification * 10) / 10,
              nextStepQuality: Math.round(aggregatedScores.nextStepQuality * 10) / 10,
              prioritization: Math.round(aggregatedScores.prioritization * 10) / 10,
              outcomeAlignment: Math.round(aggregatedScores.outcomeAlignment * 10) / 10,
            },
          });
        } catch (dbError) {
          console.error("Failed to save benchmark run:", dbError);
        }

        send({
          type: "complete",
          runId,
          finalScore: totalScore,
          maxScore: totalMaxScore,
          percentage: totalMaxScore > 0 ? Math.round((totalScore / totalMaxScore) * 100) : 0,
          avgLatencyMs,
          scores: {
            riskIdentification: Math.round(aggregatedScores.riskIdentification * 10) / 10,
            nextStepQuality: Math.round(aggregatedScores.nextStepQuality * 10) / 10,
            prioritization: Math.round(aggregatedScores.prioritization * 10) / 10,
            outcomeAlignment: Math.round(aggregatedScores.outcomeAlignment * 10) / 10,
          },
        });
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : "Benchmark failed",
        });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
