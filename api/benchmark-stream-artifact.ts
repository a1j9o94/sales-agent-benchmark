/**
 * Artifact-Based SSE Benchmark Streaming Endpoint
 *
 * Streams artifact-based benchmark progress to the client as Server-Sent Events.
 * POST /api/artifact/benchmark/stream
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
  ArtifactDeal,
  ArtifactCheckpoint,
  ArtifactAgentRequest,
  ArtifactAgentResponse,
  EvaluationTask,
  Artifact,
  ArtifactScoringDimensions,
  ArtifactTaskEvaluation,
  ScoringDimensionKey,
} from "../src/types/benchmark-artifact";
import { MultiTurnOrchestrator } from "./evaluate-tasks/multi-turn";
import { evaluateArtifactTask } from "./evaluate-response-artifact";
import { saveBenchmarkRun, saveArtifactTaskEvaluation, saveArtifactDimensionScores } from "./results";

export interface BenchmarkStreamArtifactDeps {
  evaluateArtifactTask: typeof evaluateArtifactTask;
  saveBenchmarkRun: typeof saveBenchmarkRun;
  saveArtifactTaskEvaluation: typeof saveArtifactTaskEvaluation;
  saveArtifactDimensionScores: typeof saveArtifactDimensionScores;
}

const defaultDeps: BenchmarkStreamArtifactDeps = {
  evaluateArtifactTask,
  saveBenchmarkRun,
  saveArtifactTaskEvaluation,
  saveArtifactDimensionScores,
};

// Load artifact-based deals from a directory
async function loadArtifactDealsFromDir(dirPath: string): Promise<ArtifactDeal[]> {
  const deals: ArtifactDeal[] = [];
  try {
    const dir = await Bun.$`ls ${dirPath}/*.json`.text();
    const files = dir.trim().split("\n").filter(Boolean);
    for (const filePath of files) {
      try {
        const file = Bun.file(filePath.trim());
        const content = await file.json();
        if (content.version === 2) {
          deals.push(content as ArtifactDeal);
        }
      } catch (error) {
        console.error(`Failed to load artifact-based deal ${filePath}:`, error);
      }
    }
  } catch (error) {
    console.error(`Failed to list artifact-based deals in ${dirPath}:`, error);
  }
  return deals;
}

// Call the user's agent endpoint with an artifact-based request
async function callArtifactAgentEndpoint(
  endpoint: string,
  request: ArtifactAgentRequest
): Promise<ArtifactAgentResponse> {
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

    // Normalize artifact-based response
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
    return `artifact_agent_${url.hostname.replace(/\./g, "_")}`;
  } catch {
    return `artifact_agent_${Date.now()}`;
  }
}

// Count total tasks across all deals and checkpoints
function countTotalTasks(deals: ArtifactDeal[]): number {
  let total = 0;
  for (const deal of deals) {
    for (const cp of deal.checkpoints) {
      total += cp.tasks.length;
    }
  }
  return total;
}

export async function handleBenchmarkStreamArtifact(
  req: Request,
  deps: BenchmarkStreamArtifactDeps = defaultDeps
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

  // Load artifact-based deals
  const [publicDeals, privateDeals] = await Promise.all([
    loadArtifactDealsFromDir("data/artifact/checkpoints/public"),
    loadArtifactDealsFromDir("data/artifact/checkpoints/private"),
  ]);

  const allDeals = [...publicDeals, ...privateDeals];
  const totalTasks = countTotalTasks(allDeals);

  if (totalTasks === 0) {
    return Response.json({ error: "No artifact-based deals found" }, { status: 500 });
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

      // Accumulated dimension scores for summary compatibility
      const summaryScores = {
        riskIdentification: 0,
        nextStepQuality: 0,
        prioritization: 0,
        outcomeAlignment: 0,
      };

      // Artifact-based dimension accumulators
      const artifactScores = {
        stakeholderMapping: 0,
        dealQualification: 0,
        informationSynthesis: 0,
        communicationQuality: 0,
      };
      const artifactScoreCounts = {
        stakeholderMapping: 0,
        dealQualification: 0,
        informationSynthesis: 0,
        communicationQuality: 0,
      };

      // Stored task evaluations for DB save
      const storedTaskEvals: Array<{
        checkpointId: string;
        mode: "public" | "private";
        evaluation: ArtifactTaskEvaluation;
      }> = [];

      const processDeal = async (deal: ArtifactDeal, mode: "public" | "private") => {
        for (const checkpoint of deal.checkpoints) {
          const taskResults: ArtifactTaskEvaluation[] = [];

          for (const task of checkpoint.tasks) {
            try {
              const startTime = Date.now();

              // Run multi-turn orchestration
              const orchestrator = new MultiTurnOrchestrator(
                checkpoint,
                task,
                deal.artifacts,
                {
                  callAgent: (request) => callArtifactAgentEndpoint(endpoint, request),
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
              const evaluation = await deps.evaluateArtifactTask(
                task,
                multiTurnResult.finalResponse,
                checkpoint.groundTruth,
                resolvedArtifacts,
                multiTurnResult.turnsUsed,
                multiTurnResult.artifactsRequested
              );

              taskResults.push(evaluation);
              storedTaskEvals.push({ checkpointId: checkpoint.id, mode, evaluation });

              // Accumulate summary dimension scores
              summaryScores.riskIdentification += evaluation.scores.riskIdentification ?? 0;
              summaryScores.nextStepQuality += evaluation.scores.nextStepQuality ?? 0;
              summaryScores.prioritization += evaluation.scores.prioritization ?? 0;
              summaryScores.outcomeAlignment += evaluation.scores.outcomeAlignment ?? 0;

              // Accumulate artifact-based dimension scores (only when present)
              if (evaluation.scores.stakeholderMapping !== undefined) {
                artifactScores.stakeholderMapping += evaluation.scores.stakeholderMapping;
                artifactScoreCounts.stakeholderMapping++;
              }
              if (evaluation.scores.dealQualification !== undefined) {
                artifactScores.dealQualification += evaluation.scores.dealQualification;
                artifactScoreCounts.dealQualification++;
              }
              if (evaluation.scores.informationSynthesis !== undefined) {
                artifactScores.informationSynthesis += evaluation.scores.informationSynthesis;
                artifactScoreCounts.informationSynthesis++;
              }
              if (evaluation.scores.communicationQuality !== undefined) {
                artifactScores.communicationQuality += evaluation.scores.communicationQuality;
                artifactScoreCounts.communicationQuality++;
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

        // Calculate averages for summary dimensions
        if (completedTasks > 0) {
          summaryScores.riskIdentification /= completedTasks;
          summaryScores.nextStepQuality /= completedTasks;
          summaryScores.prioritization /= completedTasks;
          summaryScores.outcomeAlignment /= completedTasks;
        }

        // Calculate aggregate score: sum of all summary dimension scores across tasks
        const aggregateScore = storedTaskEvals.reduce((sum, e) => {
          const s = e.evaluation.scores;
          return sum + (s.riskIdentification ?? 0) + (s.nextStepQuality ?? 0)
            + (s.prioritization ?? 0) + (s.outcomeAlignment ?? 0);
        }, 0);
        const maxPossibleScore = completedTasks * 40; // 4 summary dims * 10 each

        // Calculate artifact-based dimension averages
        const avgArtifactScores = {
          stakeholderMapping: artifactScoreCounts.stakeholderMapping > 0
            ? Math.round((artifactScores.stakeholderMapping / artifactScoreCounts.stakeholderMapping) * 10) / 10
            : undefined,
          dealQualification: artifactScoreCounts.dealQualification > 0
            ? Math.round((artifactScores.dealQualification / artifactScoreCounts.dealQualification) * 10) / 10
            : undefined,
          informationSynthesis: artifactScoreCounts.informationSynthesis > 0
            ? Math.round((artifactScores.informationSynthesis / artifactScoreCounts.informationSynthesis) * 10) / 10
            : undefined,
          communicationQuality: artifactScoreCounts.communicationQuality > 0
            ? Math.round((artifactScores.communicationQuality / artifactScoreCounts.communicationQuality) * 10) / 10
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
              riskIdentification: Math.round(summaryScores.riskIdentification * 10) / 10,
              nextStepQuality: Math.round(summaryScores.nextStepQuality * 10) / 10,
              prioritization: Math.round(summaryScores.prioritization * 10) / 10,
              outcomeAlignment: Math.round(summaryScores.outcomeAlignment * 10) / 10,
            },
          });

          // Save artifact-based dimension scores
          if (runId) {
            await deps.saveArtifactDimensionScores(runId, {
              stakeholderMapping: avgArtifactScores.stakeholderMapping,
              dealQualification: avgArtifactScores.dealQualification,
              informationSynthesis: avgArtifactScores.informationSynthesis,
              communicationQuality: avgArtifactScores.communicationQuality,
            });

            // Save individual task evaluations
            for (const stored of storedTaskEvals) {
              await deps.saveArtifactTaskEvaluation({
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
          console.error("Failed to save artifact-based benchmark run:", dbError);
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
            riskIdentification: Math.round(summaryScores.riskIdentification * 10) / 10,
            nextStepQuality: Math.round(summaryScores.nextStepQuality * 10) / 10,
            prioritization: Math.round(summaryScores.prioritization * 10) / 10,
            outcomeAlignment: Math.round(summaryScores.outcomeAlignment * 10) / 10,
            ...(avgArtifactScores.stakeholderMapping !== undefined ? { stakeholderMapping: avgArtifactScores.stakeholderMapping } : {}),
            ...(avgArtifactScores.dealQualification !== undefined ? { dealQualification: avgArtifactScores.dealQualification } : {}),
            ...(avgArtifactScores.informationSynthesis !== undefined ? { informationSynthesis: avgArtifactScores.informationSynthesis } : {}),
            ...(avgArtifactScores.communicationQuality !== undefined ? { communicationQuality: avgArtifactScores.communicationQuality } : {}),
          },
        });
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : "Artifact-based benchmark failed",
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

// GET /api/artifact/benchmark/deals — List available artifact-based deals
export async function handleArtifactDealsEndpoint(_req: Request): Promise<Response> {
  try {
    const [publicDeals, privateDeals] = await Promise.all([
      loadArtifactDealsFromDir("data/artifact/checkpoints/public"),
      loadArtifactDealsFromDir("data/artifact/checkpoints/private"),
    ]);

    const formatDeal = (deal: ArtifactDeal) => ({
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
    console.error("Failed to list artifact-based deals:", error);
    return Response.json({ error: "Failed to list deals" }, { status: 500 });
  }
}
