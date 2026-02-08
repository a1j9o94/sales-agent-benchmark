/**
 * Agent Results API
 *
 * GET /api/agent-results/:runId - Get detailed results for a benchmark run
 * GET /api/agent-results?agentId=... - Get latest run for an agent
 */

import { sql } from "@vercel/postgres";
import { getJudgeEvaluations, type JudgeEvaluationData } from "./results";

interface RunDetails {
  id: number;
  agentId: string;
  agentName: string | null;
  mode: string;
  aggregateScore: number;
  maxPossibleScore: number;
  percentage: number;
  dealsEvaluated: number;
  checkpointsEvaluated: number;
  avgLatencyMs: number | null;
  runTimestamp: string;
  scores: {
    riskIdentification: number;
    nextStepQuality: number;
    prioritization: number;
    outcomeAlignment: number;
  };
}

async function getRunById(runId: number): Promise<RunDetails | null> {
  const result = await sql`
    SELECT
      br.id,
      br.agent_id,
      a.name as agent_name,
      br.mode,
      br.aggregate_score,
      br.max_possible_score,
      br.deals_evaluated,
      br.checkpoints_evaluated,
      br.avg_latency_ms,
      br.run_timestamp,
      ds.risk_identification,
      ds.next_step_quality,
      ds.prioritization,
      ds.outcome_alignment
    FROM benchmark_runs br
    JOIN agents a ON br.agent_id = a.id
    JOIN dimension_scores ds ON br.id = ds.run_id
    WHERE br.id = ${runId}
  `;

  if (result.rows.length === 0) return null;

  const row = result.rows[0]!;
  return {
    id: row.id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    mode: row.mode,
    aggregateScore: row.aggregate_score,
    maxPossibleScore: row.max_possible_score,
    percentage: Math.round((row.aggregate_score / row.max_possible_score) * 100),
    dealsEvaluated: row.deals_evaluated,
    checkpointsEvaluated: row.checkpoints_evaluated,
    avgLatencyMs: row.avg_latency_ms,
    runTimestamp: row.run_timestamp,
    scores: {
      riskIdentification: row.risk_identification,
      nextStepQuality: row.next_step_quality,
      prioritization: row.prioritization,
      outcomeAlignment: row.outcome_alignment,
    },
  };
}

async function getLatestRunForAgent(agentId: string): Promise<RunDetails | null> {
  const result = await sql`
    SELECT
      br.id,
      br.agent_id,
      a.name as agent_name,
      br.mode,
      br.aggregate_score,
      br.max_possible_score,
      br.deals_evaluated,
      br.checkpoints_evaluated,
      br.avg_latency_ms,
      br.run_timestamp,
      ds.risk_identification,
      ds.next_step_quality,
      ds.prioritization,
      ds.outcome_alignment
    FROM benchmark_runs br
    JOIN agents a ON br.agent_id = a.id
    JOIN dimension_scores ds ON br.id = ds.run_id
    WHERE br.agent_id = ${agentId}
    ORDER BY br.aggregate_score DESC
    LIMIT 1
  `;

  if (result.rows.length === 0) return null;

  const row = result.rows[0]!;
  return {
    id: row.id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    mode: row.mode,
    aggregateScore: row.aggregate_score,
    maxPossibleScore: row.max_possible_score,
    percentage: Math.round((row.aggregate_score / row.max_possible_score) * 100),
    dealsEvaluated: row.deals_evaluated,
    checkpointsEvaluated: row.checkpoints_evaluated,
    avgLatencyMs: row.avg_latency_ms,
    runTimestamp: row.run_timestamp,
    scores: {
      riskIdentification: row.risk_identification,
      nextStepQuality: row.next_step_quality,
      prioritization: row.prioritization,
      outcomeAlignment: row.outcome_alignment,
    },
  };
}

export async function handleAgentResults(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    // Pattern: /api/agent-results/:id
    const idParam = pathParts[pathParts.length - 1];

    let run: RunDetails | null = null;
    let judgeEvaluations: JudgeEvaluationData[] = [];

    if (idParam && idParam !== "agent-results") {
      // Try as numeric runId first
      const numericId = parseInt(idParam, 10);
      if (!isNaN(numericId)) {
        run = await getRunById(numericId);
      }

      // If not found, try as agentId
      if (!run) {
        run = await getLatestRunForAgent(decodeURIComponent(idParam));
      }
    }

    // Fallback: check query params
    if (!run) {
      const agentId = url.searchParams.get("agentId");
      const runId = url.searchParams.get("runId");

      if (runId) {
        run = await getRunById(parseInt(runId, 10));
      } else if (agentId) {
        run = await getLatestRunForAgent(agentId);
      }
    }

    if (!run) {
      return Response.json({ error: "Run not found" }, { status: 404 });
    }

    // Get judge evaluations for this run
    try {
      judgeEvaluations = await getJudgeEvaluations(run.id);
    } catch {
      // Judge evaluations may not exist for all runs
      judgeEvaluations = [];
    }

    return Response.json({ run, judgeEvaluations });
  } catch (error) {
    console.error("Failed to get agent results:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to load results" },
      { status: 500 }
    );
  }
}
