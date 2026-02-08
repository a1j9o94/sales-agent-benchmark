/**
 * V2 SSE Benchmark Streaming Endpoint
 *
 * Streams V2 benchmark progress to the client as Server-Sent Events.
 * POST /api/v2/benchmark/stream
 * Body: { "endpoint": "https://my-agent.example.com/api", "agentName": "My Agent" }
 *
 * SSE Events:
 * - { "type": "task", "taskId": "...", "checkpointId": "...", "dealId": "...", "taskType": "...",
 *     "turnsUsed": 2, "score": {...}, "feedback": "..." | null, "progress": {...} }
 * - { "type": "checkpoint", "checkpointId": "...", "dealId": "...", "tasks": [...], "progress": {...} }
 * - { "type": "complete", "runId": 123, "finalScore": {...}, "maxScore": {...} }
 * - { "type": "error", "message": "..." }
 */

import type {
  V2Deal,
  V2Checkpoint,
  V2AgentRequest,
  V2AgentResponse,
  EvaluationTask,
  Artifact,
  V2ScoringDimensions,
  V2TaskEvaluation,
  ScoringDimensionKey,
} from "../src/types/benchmark-v2";
import { MultiTurnOrchestrator } from "./evaluate-tasks/multi-turn";
import { evaluateV2Task } from "./evaluate-response-v2";
import { saveBenchmarkRun, saveV2TaskEvaluation, saveV2DimensionScores } from "./results";

export interface BenchmarkStreamV2Deps {
  evaluateV2Task: typeof evaluateV2Task;
  saveBenchmarkRun: typeof saveBenchmarkRun;
  saveV2TaskEvaluation: typeof saveV2TaskEvaluation;
  saveV2DimensionScores: typeof saveV2DimensionScores;
}

const defaultDeps: BenchmarkStreamV2Deps = {
  evaluateV2Task,
  saveBenchmarkRun,
  saveV2TaskEvaluation,
  saveV2DimensionScores,
};

// Load V2 deals from a directory
async function loadV2DealsFromDir(dirPath: string): Promise<V2Deal[]> {
  const deals: V2Deal[] = [];
  try {
    const dir = await Bun.$`ls ${dirPath}/*.json`.text();
    const files = dir.trim().split("\n").filter(Boolean);
    for (const filePath of files) {
      try {
        const file = Bun.file(filePath.trim());
        const content = await file.json();
        if (content.version === 2) {
          deals.push(content as V2Deal);
        }
      } catch (error) {
        console.error(`Failed to load V2 deal ${filePath}:`, error);
      }
    }
  } catch (error) {
    console.error(`Failed to list V2 deals in ${dirPath}:`, error);
  }
  return deals;
}

// Call the user's agent endpoint with a V2 request
async function callV2AgentEndpoint(
  endpoint: string,
  request: V2AgentRequest
): Promise<V2AgentResponse> {
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

    // Normalize V2 response
    return {
      version: 2,
      reasoning: String(data.reasoning || ""),
      answer: typeof data.answer === "object" && data.answer !== null
        ? JSON.stringify(data.answer, null, 2)
        : String(data.answer || ""),
      artifactRequests: Array.isArray(data.artifactRequests) ? data.artifactRequests : [],
      isComplete: data.isComplete !== false,
      risks: Array.isArray(data.risks) ? data.risks.map((r: Record<string, unknown>) => ({
        description: String(r.description || ""),
        severity: ["high", "medium", "low"].includes(r.severity as string)
          ? (r.severity as "high" | "medium" | "low")
          : "medium",
      })) : [],
      nextSteps: Array.isArray(data.nextSteps || data.next_steps)
        ? (data.nextSteps || data.next_steps).map((s: Record<string, unknown>, i: number) => ({
            action: String(s.action || ""),
            priority: typeof s.priority === "number" ? s.priority : i + 1,
            rationale: s.rationale as string | undefined,
          }))
        : [],
      confidence: typeof data.confidence === "number" ? Math.min(1, Math.max(0, data.confidence)) : 0.5,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function agentIdFromEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return `v2_agent_${url.hostname.replace(/\./g, "_")}`;
  } catch {
    return `v2_agent_${Date.now()}`;
  }
}

// Count total tasks across all deals and checkpoints
function countTotalTasks(deals: V2Deal[]): number {
  let total = 0;
  for (const deal of deals) {
    for (const cp of deal.checkpoints) {
      total += cp.tasks.length;
    }
  }
  return total;
}

export async function handleBenchmarkStreamV2(
  req: Request,
  deps: BenchmarkStreamV2Deps = defaultDeps
): Promise<Response> {
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

  // Load V2 deals
  const [publicDeals, privateDeals] = await Promise.all([
    loadV2DealsFromDir("data/v2/checkpoints/public"),
    loadV2DealsFromDir("data/v2/checkpoints/private"),
  ]);

  const allDeals = [...publicDeals, ...privateDeals];
  const totalTasks = countTotalTasks(allDeals);

  if (totalTasks === 0) {
    return Response.json({ error: "No V2 deals found" }, { status: 500 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      let completedTasks = 0;
      let totalLatencyMs = 0;
      let dealsEvaluated = 0;
      let checkpointsEvaluated = 0;

      // Accumulated dimension scores for V1 compatibility
      const v1Scores = {
        riskIdentification: 0,
        nextStepQuality: 0,
        prioritization: 0,
        outcomeAlignment: 0,
      };

      // V2 dimension accumulators
      const v2Scores = {
        stakeholderMapping: 0,
        dealQualification: 0,
        informationSynthesis: 0,
        communicationQuality: 0,
      };
      const v2ScoreCounts = {
        stakeholderMapping: 0,
        dealQualification: 0,
        informationSynthesis: 0,
        communicationQuality: 0,
      };

      // Stored task evaluations for DB save
      const storedTaskEvals: Array<{
        checkpointId: string;
        mode: "public" | "private";
        evaluation: V2TaskEvaluation;
      }> = [];

      const processDeal = async (deal: V2Deal, mode: "public" | "private") => {
        for (const checkpoint of deal.checkpoints) {
          const taskResults: V2TaskEvaluation[] = [];

          for (const task of checkpoint.tasks) {
            try {
              const startTime = Date.now();

              // Run multi-turn orchestration
              const orchestrator = new MultiTurnOrchestrator(
                checkpoint,
                task,
                deal.artifacts,
                {
                  callAgent: (request) => callV2AgentEndpoint(endpoint, request),
                }
              );

              const multiTurnResult = await orchestrator.execute();
              const latencyMs = Date.now() - startTime;
              totalLatencyMs += latencyMs;

              // Resolve artifacts for evaluation context
              const resolvedArtifacts = task.requiredArtifacts
                .map((id) => deal.artifacts[id])
                .filter((a): a is Artifact => a !== undefined);

              // Evaluate the response
              const evaluation = await deps.evaluateV2Task(
                task,
                multiTurnResult.finalResponse,
                checkpoint.groundTruth,
                resolvedArtifacts,
                multiTurnResult.turnsUsed,
                multiTurnResult.artifactsRequested
              );

              taskResults.push(evaluation);
              storedTaskEvals.push({ checkpointId: checkpoint.id, mode, evaluation });

              // Accumulate V1 dimension scores
              v1Scores.riskIdentification += evaluation.scores.riskIdentification ?? 0;
              v1Scores.nextStepQuality += evaluation.scores.nextStepQuality ?? 0;
              v1Scores.prioritization += evaluation.scores.prioritization ?? 0;
              v1Scores.outcomeAlignment += evaluation.scores.outcomeAlignment ?? 0;

              // Accumulate V2 dimension scores (only when present)
              if (evaluation.scores.stakeholderMapping !== undefined) {
                v2Scores.stakeholderMapping += evaluation.scores.stakeholderMapping;
                v2ScoreCounts.stakeholderMapping++;
              }
              if (evaluation.scores.dealQualification !== undefined) {
                v2Scores.dealQualification += evaluation.scores.dealQualification;
                v2ScoreCounts.dealQualification++;
              }
              if (evaluation.scores.informationSynthesis !== undefined) {
                v2Scores.informationSynthesis += evaluation.scores.informationSynthesis;
                v2ScoreCounts.informationSynthesis++;
              }
              if (evaluation.scores.communicationQuality !== undefined) {
                v2Scores.communicationQuality += evaluation.scores.communicationQuality;
                v2ScoreCounts.communicationQuality++;
              }

              completedTasks++;

              send({
                type: "task",
                taskId: task.id,
                taskType: task.type,
                checkpointId: checkpoint.id,
                dealId: deal.id,
                dealName: deal.name,
                mode,
                turnsUsed: evaluation.turnsUsed,
                artifactsRequested: evaluation.artifactsRequested,
                scores: evaluation.scores,
                feedback: mode === "public" ? evaluation.feedback : null,
                latencyMs,
                progress: { completed: completedTasks, total: totalTasks },
              });
            } catch (error) {
              completedTasks++;

              send({
                type: "task",
                taskId: task.id,
                taskType: task.type,
                checkpointId: checkpoint.id,
                dealId: deal.id,
                dealName: deal.name,
                mode,
                turnsUsed: 0,
                scores: {},
                feedback: mode === "public"
                  ? `Error: ${error instanceof Error ? error.message : "Unknown error"}`
                  : null,
                error: true,
                progress: { completed: completedTasks, total: totalTasks },
              });
            }
          }

          checkpointsEvaluated++;

          send({
            type: "checkpoint",
            checkpointId: checkpoint.id,
            dealId: deal.id,
            dealName: deal.name,
            mode,
            tasksCompleted: taskResults.length,
            tasksSummary: taskResults.map((t) => ({
              taskId: t.taskId,
              taskType: t.taskType,
              turnsUsed: t.turnsUsed,
            })),
          });
        }

        dealsEvaluated++;
      };

      try {
        // Process public deals first (with feedback)
        for (const deal of publicDeals) {
          await processDeal(deal, "public");
        }

        // Process private deals (scores only)
        for (const deal of privateDeals) {
          await processDeal(deal, "private");
        }

        // Calculate averages for V1 dimensions
        if (completedTasks > 0) {
          v1Scores.riskIdentification /= completedTasks;
          v1Scores.nextStepQuality /= completedTasks;
          v1Scores.prioritization /= completedTasks;
          v1Scores.outcomeAlignment /= completedTasks;
        }

        // Calculate aggregate score: sum of all V1 dimension scores across tasks
        const aggregateScore = storedTaskEvals.reduce((sum, e) => {
          const s = e.evaluation.scores;
          return sum + (s.riskIdentification ?? 0) + (s.nextStepQuality ?? 0)
            + (s.prioritization ?? 0) + (s.outcomeAlignment ?? 0);
        }, 0);
        const maxPossibleScore = completedTasks * 40; // 4 V1 dims * 10 each

        // Calculate V2 dimension averages
        const avgV2Scores = {
          stakeholderMapping: v2ScoreCounts.stakeholderMapping > 0
            ? Math.round((v2Scores.stakeholderMapping / v2ScoreCounts.stakeholderMapping) * 10) / 10
            : undefined,
          dealQualification: v2ScoreCounts.dealQualification > 0
            ? Math.round((v2Scores.dealQualification / v2ScoreCounts.dealQualification) * 10) / 10
            : undefined,
          informationSynthesis: v2ScoreCounts.informationSynthesis > 0
            ? Math.round((v2Scores.informationSynthesis / v2ScoreCounts.informationSynthesis) * 10) / 10
            : undefined,
          communicationQuality: v2ScoreCounts.communicationQuality > 0
            ? Math.round((v2Scores.communicationQuality / v2ScoreCounts.communicationQuality) * 10) / 10
            : undefined,
        };

        const avgLatencyMs = completedTasks > 0 ? Math.round(totalLatencyMs / completedTasks) : 0;

        // Save to database
        const agentId = agentIdFromEndpoint(endpoint);
        let runId: number | null = null;
        try {
          runId = await deps.saveBenchmarkRun({
            agentId,
            agentEndpoint: endpoint,
            agentName: agentName || undefined,
            mode: "public",
            aggregateScore: Math.round(aggregateScore),
            maxPossibleScore,
            dealsEvaluated,
            checkpointsEvaluated,
            avgLatencyMs,
            runTimestamp: new Date().toISOString(),
            scores: {
              riskIdentification: Math.round(v1Scores.riskIdentification * 10) / 10,
              nextStepQuality: Math.round(v1Scores.nextStepQuality * 10) / 10,
              prioritization: Math.round(v1Scores.prioritization * 10) / 10,
              outcomeAlignment: Math.round(v1Scores.outcomeAlignment * 10) / 10,
            },
          });

          // Save V2 dimension scores
          if (runId) {
            await deps.saveV2DimensionScores(runId, {
              stakeholderMapping: avgV2Scores.stakeholderMapping,
              dealQualification: avgV2Scores.dealQualification,
              informationSynthesis: avgV2Scores.informationSynthesis,
              communicationQuality: avgV2Scores.communicationQuality,
            });

            // Save individual task evaluations
            for (const stored of storedTaskEvals) {
              await deps.saveV2TaskEvaluation({
                runId,
                checkpointId: stored.checkpointId,
                taskId: stored.evaluation.taskId,
                taskType: stored.evaluation.taskType,
                turnsUsed: stored.evaluation.turnsUsed,
                scores: stored.evaluation.scores as unknown as Record<string, number>,
                feedback: stored.evaluation.feedback,
                artifactsRequested: stored.evaluation.artifactsRequested,
                judgeModel: stored.evaluation.judgeModel,
              });
            }
          }
        } catch (dbError) {
          console.error("Failed to save V2 benchmark run:", dbError);
        }

        send({
          type: "complete",
          runId,
          version: 2,
          finalScore: Math.round(aggregateScore),
          maxScore: maxPossibleScore,
          percentage: maxPossibleScore > 0 ? Math.round((aggregateScore / maxPossibleScore) * 100) : 0,
          avgLatencyMs,
          tasksEvaluated: completedTasks,
          checkpointsEvaluated,
          dealsEvaluated,
          dimensions: {
            riskIdentification: Math.round(v1Scores.riskIdentification * 10) / 10,
            nextStepQuality: Math.round(v1Scores.nextStepQuality * 10) / 10,
            prioritization: Math.round(v1Scores.prioritization * 10) / 10,
            outcomeAlignment: Math.round(v1Scores.outcomeAlignment * 10) / 10,
            ...(avgV2Scores.stakeholderMapping !== undefined ? { stakeholderMapping: avgV2Scores.stakeholderMapping } : {}),
            ...(avgV2Scores.dealQualification !== undefined ? { dealQualification: avgV2Scores.dealQualification } : {}),
            ...(avgV2Scores.informationSynthesis !== undefined ? { informationSynthesis: avgV2Scores.informationSynthesis } : {}),
            ...(avgV2Scores.communicationQuality !== undefined ? { communicationQuality: avgV2Scores.communicationQuality } : {}),
          },
        });
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : "V2 Benchmark failed",
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

// GET /api/v2/benchmark/deals — List available V2 deals
export async function handleV2DealsEndpoint(_req: Request): Promise<Response> {
  try {
    const [publicDeals, privateDeals] = await Promise.all([
      loadV2DealsFromDir("data/v2/checkpoints/public"),
      loadV2DealsFromDir("data/v2/checkpoints/private"),
    ]);

    const formatDeal = (deal: V2Deal) => ({
      id: deal.id,
      name: deal.name,
      version: deal.version,
      industry: deal.industry,
      artifactCount: Object.keys(deal.artifacts).length,
      checkpointCount: deal.checkpoints.length,
      taskCount: deal.checkpoints.reduce((sum, cp) => sum + cp.tasks.length, 0),
      finalOutcome: deal.finalOutcome,
      dateRange: deal.metadata?.dateRange,
    });

    return Response.json({
      version: 2,
      public: publicDeals.map(formatDeal),
      private: {
        count: privateDeals.length,
        deals: privateDeals.map((d) => ({ id: d.id, name: d.name })),
      },
      totals: {
        deals: publicDeals.length + privateDeals.length,
        checkpoints: [...publicDeals, ...privateDeals].reduce(
          (sum, d) => sum + d.checkpoints.length, 0
        ),
        tasks: [...publicDeals, ...privateDeals].reduce(
          (sum, d) => sum + d.checkpoints.reduce((s, cp) => s + cp.tasks.length, 0), 0
        ),
        artifacts: [...publicDeals, ...privateDeals].reduce(
          (sum, d) => sum + Object.keys(d.artifacts).length, 0
        ),
      },
    });
  } catch (error) {
    console.error("Failed to list V2 deals:", error);
    return Response.json({ error: "Failed to list deals" }, { status: 500 });
  }
}
