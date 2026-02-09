/**
 * Benchmark Results Persistence
 *
 * Postgres-based storage for benchmark results (Vercel Postgres / Neon)
 * Enables:
 * - Persistent leaderboard across deployments
 * - Historical run data
 * - Agent comparison over time
 */

import { sql } from "@vercel/postgres";

export interface ResultsDeps {
  sql: typeof sql;
}

const defaultResultsDeps: ResultsDeps = { sql };

// Types
export interface StoredAgent {
  id: string;
  name: string | null;
  endpoint: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredRun {
  id: number;
  agentId: string;
  agentName: string | null;
  mode: "public" | "private";
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

export interface LeaderboardEntry {
  rank: number;
  agentId: string;
  agentName: string | null;
  score: number;
  maxScore: number;
  percentage: number;
  dealsEvaluated: number;
  checkpointsEvaluated: number;
  avgLatencyMs: number | null;
  lastRun: string;
  scores: {
    riskIdentification: number;
    nextStepQuality: number;
    prioritization: number;
    outcomeAlignment: number;
  };
}

// Initialize database tables
export async function initDatabase(deps: ResultsDeps = defaultResultsDeps): Promise<void> {
  try {
    await deps.sql`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT,
        endpoint TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;

    await deps.sql`
      CREATE TABLE IF NOT EXISTS benchmark_runs (
        id SERIAL PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id),
        mode TEXT NOT NULL CHECK (mode IN ('public', 'private')),
        aggregate_score INTEGER NOT NULL,
        max_possible_score INTEGER NOT NULL,
        deals_evaluated INTEGER NOT NULL,
        checkpoints_evaluated INTEGER NOT NULL,
        avg_latency_ms REAL,
        run_timestamp TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    await deps.sql`
      CREATE TABLE IF NOT EXISTS dimension_scores (
        id SERIAL PRIMARY KEY,
        run_id INTEGER NOT NULL REFERENCES benchmark_runs(id) ON DELETE CASCADE,
        risk_identification REAL NOT NULL,
        next_step_quality REAL NOT NULL,
        prioritization REAL NOT NULL,
        outcome_alignment REAL NOT NULL,
        stakeholder_mapping REAL,
        deal_qualification REAL,
        information_synthesis REAL,
        communication_quality REAL
      )
    `;

    // Create judge_evaluations table for multi-judge scoring
    await deps.sql`
      CREATE TABLE IF NOT EXISTS judge_evaluations (
        id SERIAL PRIMARY KEY,
        run_id INTEGER NOT NULL REFERENCES benchmark_runs(id) ON DELETE CASCADE,
        checkpoint_id TEXT NOT NULL,
        judge_model TEXT NOT NULL,
        risk_identification REAL NOT NULL,
        next_step_quality REAL NOT NULL,
        prioritization REAL NOT NULL,
        outcome_alignment REAL NOT NULL,
        feedback TEXT,
        risks_identified JSONB,
        risks_missed JSONB,
        helpful_recommendations JSONB,
        unhelpful_recommendations JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // Artifact-based dimension scores (4 nullable columns added to dimension_scores above)

    // Artifact-based task evaluations (per-checkpoint, per-task scoring with multi-turn support)
    await deps.sql`
      CREATE TABLE IF NOT EXISTS task_evaluations (
        id SERIAL PRIMARY KEY,
        run_id INTEGER NOT NULL REFERENCES benchmark_runs(id) ON DELETE CASCADE,
        checkpoint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        task_type TEXT NOT NULL,
        turns_used INTEGER NOT NULL DEFAULT 1,
        scores JSONB NOT NULL,
        feedback TEXT,
        artifacts_requested JSONB,
        judge_model TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // Create indexes
    await deps.sql`CREATE INDEX IF NOT EXISTS idx_runs_agent ON benchmark_runs(agent_id)`;
    await deps.sql`CREATE INDEX IF NOT EXISTS idx_runs_mode ON benchmark_runs(mode)`;
    await deps.sql`CREATE INDEX IF NOT EXISTS idx_runs_timestamp ON benchmark_runs(run_timestamp DESC)`;
    await deps.sql`CREATE INDEX IF NOT EXISTS idx_judge_evals_run ON judge_evaluations(run_id)`;
    await deps.sql`CREATE INDEX IF NOT EXISTS idx_judge_evals_checkpoint ON judge_evaluations(checkpoint_id)`;
    await deps.sql`CREATE INDEX IF NOT EXISTS idx_task_evals_run ON task_evaluations(run_id)`;
    await deps.sql`CREATE INDEX IF NOT EXISTS idx_task_evals_checkpoint ON task_evaluations(checkpoint_id)`;

    console.log("Database tables initialized");
  } catch (error) {
    console.error("Failed to initialize database:", error);
    throw error;
  }
}

// Agent operations
export async function upsertAgent(id: string, endpoint: string, name?: string, deps: ResultsDeps = defaultResultsDeps): Promise<StoredAgent> {
  const existing = await deps.sql`SELECT * FROM agents WHERE id = ${id}`;

  if (existing.rows.length > 0) {
    await deps.sql`
      UPDATE agents
      SET name = COALESCE(${name ?? null}, name), endpoint = ${endpoint}, updated_at = NOW()
      WHERE id = ${id}
    `;
  } else {
    await deps.sql`
      INSERT INTO agents (id, name, endpoint)
      VALUES (${id}, ${name ?? null}, ${endpoint})
    `;
  }

  const result = await deps.sql`SELECT * FROM agents WHERE id = ${id}`;
  const agent = result.rows[0];

  if (!agent) {
    throw new Error(`Agent not found after upsert: ${id}`);
  }

  return {
    id: agent.id as string,
    name: agent.name as string | null,
    endpoint: agent.endpoint as string,
    createdAt: agent.created_at as string,
    updatedAt: agent.updated_at as string,
  };
}

export async function getAgent(id: string, deps: ResultsDeps = defaultResultsDeps): Promise<StoredAgent | null> {
  const result = await deps.sql`SELECT * FROM agents WHERE id = ${id}`;

  if (result.rows.length === 0) return null;

  const agent = result.rows[0];
  if (!agent) return null;

  return {
    id: agent.id as string,
    name: agent.name as string | null,
    endpoint: agent.endpoint as string,
    createdAt: agent.created_at as string,
    updatedAt: agent.updated_at as string,
  };
}

// Benchmark run operations
export async function saveBenchmarkRun(result: {
  agentId: string;
  agentEndpoint: string;
  agentName?: string;
  mode: "public" | "private";
  aggregateScore: number;
  maxPossibleScore: number;
  dealsEvaluated: number;
  checkpointsEvaluated: number;
  avgLatencyMs?: number;
  runTimestamp: string;
  scores: {
    riskIdentification: number;
    nextStepQuality: number;
    prioritization: number;
    outcomeAlignment: number;
  };
}, deps: ResultsDeps = defaultResultsDeps): Promise<number> {
  // Ensure agent exists
  await upsertAgent(result.agentId, result.agentEndpoint, result.agentName, deps);

  // Insert benchmark run (round scores to integers for database)
  const aggregateScoreInt = Math.round(result.aggregateScore);
  const maxPossibleScoreInt = Math.round(result.maxPossibleScore);

  const runResult = await deps.sql`
    INSERT INTO benchmark_runs
    (agent_id, mode, aggregate_score, max_possible_score, deals_evaluated, checkpoints_evaluated, avg_latency_ms, run_timestamp)
    VALUES (${result.agentId}, ${result.mode}, ${aggregateScoreInt}, ${maxPossibleScoreInt},
            ${result.dealsEvaluated}, ${result.checkpointsEvaluated}, ${result.avgLatencyMs ?? null}, ${result.runTimestamp})
    RETURNING id
  `;

  const runId = runResult.rows[0]?.id;
  if (!runId) {
    throw new Error("Failed to insert benchmark run");
  }

  // Insert dimension scores
  await deps.sql`
    INSERT INTO dimension_scores (run_id, risk_identification, next_step_quality, prioritization, outcome_alignment)
    VALUES (${runId}, ${result.scores.riskIdentification}, ${result.scores.nextStepQuality},
            ${result.scores.prioritization}, ${result.scores.outcomeAlignment})
  `;

  return runId;
}

// Judge evaluation type for multi-judge scoring
export interface JudgeEvaluationData {
  runId: number;
  checkpointId: string;
  judgeModel: string;
  scores: {
    riskIdentification: number;
    nextStepQuality: number;
    prioritization: number;
    outcomeAlignment: number;
  };
  feedback?: string;
  risksIdentified?: string[];
  risksMissed?: string[];
  helpfulRecommendations?: string[];
  unhelpfulRecommendations?: string[];
}

// Save individual judge evaluation
export async function saveJudgeEvaluation(evaluation: JudgeEvaluationData, deps: ResultsDeps = defaultResultsDeps): Promise<number> {
  const result = await deps.sql`
    INSERT INTO judge_evaluations
    (run_id, checkpoint_id, judge_model, risk_identification, next_step_quality, prioritization, outcome_alignment, feedback, risks_identified, risks_missed, helpful_recommendations, unhelpful_recommendations)
    VALUES (
      ${evaluation.runId},
      ${evaluation.checkpointId},
      ${evaluation.judgeModel},
      ${evaluation.scores.riskIdentification},
      ${evaluation.scores.nextStepQuality},
      ${evaluation.scores.prioritization},
      ${evaluation.scores.outcomeAlignment},
      ${evaluation.feedback ?? null},
      ${JSON.stringify(evaluation.risksIdentified ?? [])},
      ${JSON.stringify(evaluation.risksMissed ?? [])},
      ${JSON.stringify(evaluation.helpfulRecommendations ?? [])},
      ${JSON.stringify(evaluation.unhelpfulRecommendations ?? [])}
    )
    RETURNING id
  `;

  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error("Failed to insert judge evaluation");
  }
  return id;
}

// Get judge evaluations for a run
export async function getJudgeEvaluations(runId: number, deps: ResultsDeps = defaultResultsDeps): Promise<JudgeEvaluationData[]> {
  const results = await deps.sql`
    SELECT * FROM judge_evaluations WHERE run_id = ${runId}
  `;

  return results.rows.map((row) => ({
    runId: row.run_id,
    checkpointId: row.checkpoint_id,
    judgeModel: row.judge_model,
    scores: {
      riskIdentification: row.risk_identification,
      nextStepQuality: row.next_step_quality,
      prioritization: row.prioritization,
      outcomeAlignment: row.outcome_alignment,
    },
    feedback: row.feedback,
    risksIdentified: row.risks_identified,
    risksMissed: row.risks_missed,
    helpfulRecommendations: row.helpful_recommendations,
    unhelpfulRecommendations: row.unhelpful_recommendations,
  }));
}

// Get leaderboard (best score per agent for a given mode)
export async function getLeaderboard(mode: "public" | "private" = "private", deps: ResultsDeps = defaultResultsDeps): Promise<LeaderboardEntry[]> {
  const results = await deps.sql`
    SELECT DISTINCT ON (br.agent_id)
      br.agent_id,
      a.name as agent_name,
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
    WHERE br.mode = ${mode}
      AND br.agent_id NOT LIKE 'artifact_%'
    ORDER BY br.agent_id, br.aggregate_score DESC
  `;

  // Sort by percentage and assign ranks
  const sorted = results.rows
    .map((row) => ({
      agentId: row.agent_id,
      agentName: row.agent_name,
      score: row.aggregate_score,
      maxScore: row.max_possible_score,
      percentage: Math.round((row.aggregate_score / row.max_possible_score) * 100),
      dealsEvaluated: row.deals_evaluated,
      checkpointsEvaluated: row.checkpoints_evaluated,
      avgLatencyMs: row.avg_latency_ms,
      lastRun: row.run_timestamp,
      scores: {
        riskIdentification: row.risk_identification,
        nextStepQuality: row.next_step_quality,
        prioritization: row.prioritization,
        outcomeAlignment: row.outcome_alignment,
      },
    }))
    .sort((a, b) => b.percentage - a.percentage);

  return sorted.map((entry, index) => ({
    rank: index + 1,
    ...entry,
  }));
}

// Get all runs for scatter plot
export async function getAllRuns(options?: { mode?: "public" | "private"; limit?: number }, deps: ResultsDeps = defaultResultsDeps): Promise<StoredRun[]> {
  const limit = options?.limit ?? 100;

  let results;
  if (options?.mode) {
    results = await deps.sql`
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
      WHERE br.mode = ${options.mode}
        AND br.agent_id NOT LIKE 'artifact_%'
      ORDER BY br.run_timestamp DESC
      LIMIT ${limit}
    `;
  } else {
    results = await deps.sql`
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
      WHERE br.agent_id NOT LIKE 'artifact_%'
      ORDER BY br.run_timestamp DESC
      LIMIT ${limit}
    `;
  }

  return results.rows.map((row) => ({
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
  }));
}

// Get run history for a specific agent
export async function getAgentRunHistory(agentId: string, limit = 10, deps: ResultsDeps = defaultResultsDeps): Promise<StoredRun[]> {
  const results = await deps.sql`
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
    ORDER BY br.run_timestamp DESC
    LIMIT ${limit}
  `;

  return results.rows.map((row) => ({
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
  }));
}

// API Handlers
export async function handleGetLeaderboard(req: Request, deps: ResultsDeps = defaultResultsDeps): Promise<Response> {
  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") === "public" ? "public" : "private";

    const leaderboard = await getLeaderboard(mode, deps);

    return Response.json({
      mode,
      count: leaderboard.length,
      entries: leaderboard,
    });
  } catch (error) {
    console.error("Failed to get leaderboard:", error);
    return Response.json({ error: "Failed to load leaderboard", entries: [] }, { status: 500 });
  }
}

export async function handleGetAllRuns(req: Request, deps: ResultsDeps = defaultResultsDeps): Promise<Response> {
  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") as "public" | "private" | null;
    const limit = url.searchParams.get("limit");

    const runs = await getAllRuns({
      mode: mode || undefined,
      limit: limit ? parseInt(limit, 10) : 100,
    }, deps);

    return Response.json({
      count: runs.length,
      runs,
    });
  } catch (error) {
    console.error("Failed to get runs:", error);
    return Response.json({ error: "Failed to load runs", runs: [] }, { status: 500 });
  }
}

interface SaveResultBody {
  agentId: string;
  agentEndpoint: string;
  agentName?: string;
  mode: "public" | "private";
  aggregateScore: number;
  maxPossibleScore: number;
  dealsEvaluated?: number;
  checkpointsEvaluated?: number;
  avgLatencyMs?: number;
  runTimestamp: string;
  scores?: {
    riskIdentification: number;
    nextStepQuality: number;
    prioritization: number;
    outcomeAlignment: number;
  };
  dealResults?: {
    dealId: string;
    checkpointEvaluations: {
      scores: {
        riskIdentification: number;
        nextStepQuality: number;
        prioritization: number;
        outcomeAlignment: number;
      };
    }[];
  }[];
}

export async function handleSaveResult(req: Request, deps: ResultsDeps = defaultResultsDeps): Promise<Response> {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = (await req.json()) as SaveResultBody;

    // Calculate dimension averages from deal results
    let scores = body.scores;
    if (!scores && body.dealResults) {
      const totals = { riskIdentification: 0, nextStepQuality: 0, prioritization: 0, outcomeAlignment: 0 };
      let count = 0;
      for (const deal of body.dealResults) {
        for (const cp of deal.checkpointEvaluations) {
          totals.riskIdentification += cp.scores.riskIdentification;
          totals.nextStepQuality += cp.scores.nextStepQuality;
          totals.prioritization += cp.scores.prioritization;
          totals.outcomeAlignment += cp.scores.outcomeAlignment;
          count++;
        }
      }
      if (count > 0) {
        scores = {
          riskIdentification: totals.riskIdentification / count,
          nextStepQuality: totals.nextStepQuality / count,
          prioritization: totals.prioritization / count,
          outcomeAlignment: totals.outcomeAlignment / count,
        };
      }
    }

    // Count checkpoints
    let checkpointsEvaluated = body.checkpointsEvaluated || 0;
    if (!checkpointsEvaluated && body.dealResults) {
      checkpointsEvaluated = body.dealResults.reduce(
        (sum: number, deal: { checkpointEvaluations: unknown[] }) => sum + deal.checkpointEvaluations.length,
        0
      );
    }

    const runId = await saveBenchmarkRun({
      agentId: body.agentId,
      agentEndpoint: body.agentEndpoint,
      agentName: body.agentName,
      mode: body.mode,
      aggregateScore: body.aggregateScore,
      maxPossibleScore: body.maxPossibleScore,
      dealsEvaluated: body.dealResults?.length ?? body.dealsEvaluated ?? 0,
      checkpointsEvaluated,
      avgLatencyMs: body.avgLatencyMs,
      runTimestamp: body.runTimestamp,
      scores: scores || {
        riskIdentification: 0,
        nextStepQuality: 0,
        prioritization: 0,
        outcomeAlignment: 0,
      },
    }, deps);

    return Response.json({ success: true, runId });
  } catch (error) {
    console.error("Failed to save result:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to save result" },
      { status: 500 }
    );
  }
}

export async function handleInitDatabase(req: Request, deps: ResultsDeps = defaultResultsDeps): Promise<Response> {
  try {
    await initDatabase(deps);
    return Response.json({ success: true, message: "Database initialized" });
  } catch (error) {
    console.error("Failed to initialize database:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to initialize database" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// Artifact-Based Operations
// ---------------------------------------------------------------------------

export interface ArtifactTaskEvaluationData {
  runId: number;
  checkpointId: string;
  taskId: string;
  taskType: string;
  turnsUsed: number;
  scores: Record<string, number>;
  feedback?: string;
  artifactsRequested?: string[];
  judgeModel?: string;
}

export async function saveArtifactDimensionScores(
  runId: number,
  scores: {
    stakeholderMapping?: number;
    dealQualification?: number;
    informationSynthesis?: number;
    communicationQuality?: number;
  },
  deps: ResultsDeps = defaultResultsDeps
): Promise<void> {
  await deps.sql`
    UPDATE dimension_scores
    SET stakeholder_mapping = ${scores.stakeholderMapping ?? null},
        deal_qualification = ${scores.dealQualification ?? null},
        information_synthesis = ${scores.informationSynthesis ?? null},
        communication_quality = ${scores.communicationQuality ?? null}
    WHERE run_id = ${runId}
  `;
}

export async function saveArtifactTaskEvaluation(
  evaluation: ArtifactTaskEvaluationData,
  deps: ResultsDeps = defaultResultsDeps
): Promise<number> {
  const result = await deps.sql`
    INSERT INTO task_evaluations
    (run_id, checkpoint_id, task_id, task_type, turns_used, scores, feedback, artifacts_requested, judge_model)
    VALUES (
      ${evaluation.runId},
      ${evaluation.checkpointId},
      ${evaluation.taskId},
      ${evaluation.taskType},
      ${evaluation.turnsUsed},
      ${JSON.stringify(evaluation.scores)},
      ${evaluation.feedback ?? null},
      ${JSON.stringify(evaluation.artifactsRequested ?? [])},
      ${evaluation.judgeModel ?? null}
    )
    RETURNING id
  `;

  const id = result.rows[0]?.id;
  if (!id) throw new Error("Failed to insert artifact-based task evaluation");
  return id;
}

export async function getArtifactTaskEvaluations(
  runId: number,
  deps: ResultsDeps = defaultResultsDeps
): Promise<ArtifactTaskEvaluationData[]> {
  const results = await deps.sql`
    SELECT * FROM task_evaluations WHERE run_id = ${runId}
  `;

  return results.rows.map((row) => ({
    runId: row.run_id,
    checkpointId: row.checkpoint_id,
    taskId: row.task_id,
    taskType: row.task_type,
    turnsUsed: row.turns_used,
    scores: row.scores as Record<string, number>,
    feedback: row.feedback,
    artifactsRequested: row.artifacts_requested as string[],
    judgeModel: row.judge_model,
  }));
}

// ---------------------------------------------------------------------------
// Artifact-Based Leaderboard & Run Details
// ---------------------------------------------------------------------------

export interface ArtifactLeaderboardEntry {
  rank: number;
  agentId: string;
  agentName: string | null;
  score: number;
  maxScore: number;
  percentage: number;
  dealsEvaluated: number;
  checkpointsEvaluated: number;
  avgLatencyMs: number | null;
  lastRun: string;
  dimensions: Record<string, number>;
}

export async function getArtifactLeaderboard(
  deps: ResultsDeps = defaultResultsDeps
): Promise<ArtifactLeaderboardEntry[]> {
  const results = await deps.sql`
    SELECT DISTINCT ON (br.agent_id)
      br.agent_id,
      a.name as agent_name,
      br.aggregate_score,
      br.max_possible_score,
      br.deals_evaluated,
      br.checkpoints_evaluated,
      br.avg_latency_ms,
      br.run_timestamp,
      ds.risk_identification,
      ds.next_step_quality,
      ds.prioritization,
      ds.outcome_alignment,
      ds.stakeholder_mapping,
      ds.deal_qualification,
      ds.information_synthesis,
      ds.communication_quality
    FROM benchmark_runs br
    JOIN agents a ON br.agent_id = a.id
    JOIN dimension_scores ds ON br.id = ds.run_id
    WHERE br.mode = 'public'
      AND ds.stakeholder_mapping IS NOT NULL
    ORDER BY br.agent_id, br.aggregate_score DESC
  `;

  const sorted = results.rows
    .map((row) => ({
      agentId: row.agent_id,
      agentName: row.agent_name,
      score: row.aggregate_score,
      maxScore: row.max_possible_score,
      percentage: row.max_possible_score > 0
        ? Math.round((row.aggregate_score / row.max_possible_score) * 100)
        : 0,
      dealsEvaluated: row.deals_evaluated,
      checkpointsEvaluated: row.checkpoints_evaluated,
      avgLatencyMs: row.avg_latency_ms,
      lastRun: row.run_timestamp,
      dimensions: {
        riskIdentification: row.risk_identification ?? 0,
        nextStepQuality: row.next_step_quality ?? 0,
        prioritization: row.prioritization ?? 0,
        outcomeAlignment: row.outcome_alignment ?? 0,
        ...(row.stakeholder_mapping != null ? { stakeholderMapping: row.stakeholder_mapping } : {}),
        ...(row.deal_qualification != null ? { dealQualification: row.deal_qualification } : {}),
        ...(row.information_synthesis != null ? { informationSynthesis: row.information_synthesis } : {}),
        ...(row.communication_quality != null ? { communicationQuality: row.communication_quality } : {}),
      },
    }))
    .sort((a, b) => b.percentage - a.percentage);

  return sorted.map((entry, index) => ({
    rank: index + 1,
    ...entry,
  }));
}

export interface ArtifactRunDetails {
  run: {
    id: number;
    agentId: string;
    agentName: string | null;
    aggregateScore: number;
    maxPossibleScore: number;
    percentage: number;
    dealsEvaluated: number;
    checkpointsEvaluated: number;
    avgLatencyMs: number | null;
    runTimestamp: string;
    dimensions: Record<string, number>;
  };
  taskEvaluations: ArtifactTaskEvaluationData[];
}

export async function getArtifactRunDetails(
  runId: number,
  deps: ResultsDeps = defaultResultsDeps
): Promise<ArtifactRunDetails | null> {
  const result = await deps.sql`
    SELECT
      br.id,
      br.agent_id,
      a.name as agent_name,
      br.aggregate_score,
      br.max_possible_score,
      br.deals_evaluated,
      br.checkpoints_evaluated,
      br.avg_latency_ms,
      br.run_timestamp,
      ds.risk_identification,
      ds.next_step_quality,
      ds.prioritization,
      ds.outcome_alignment,
      ds.stakeholder_mapping,
      ds.deal_qualification,
      ds.information_synthesis,
      ds.communication_quality
    FROM benchmark_runs br
    JOIN agents a ON br.agent_id = a.id
    JOIN dimension_scores ds ON br.id = ds.run_id
    WHERE br.id = ${runId}
  `;

  if (result.rows.length === 0) return null;

  const row = result.rows[0]!;

  const taskEvaluations = await getArtifactTaskEvaluations(runId, deps);

  return {
    run: {
      id: row.id,
      agentId: row.agent_id,
      agentName: row.agent_name,
      aggregateScore: row.aggregate_score,
      maxPossibleScore: row.max_possible_score,
      percentage: row.max_possible_score > 0
        ? Math.round((row.aggregate_score / row.max_possible_score) * 100)
        : 0,
      dealsEvaluated: row.deals_evaluated,
      checkpointsEvaluated: row.checkpoints_evaluated,
      avgLatencyMs: row.avg_latency_ms,
      runTimestamp: row.run_timestamp,
      dimensions: {
        riskIdentification: row.risk_identification ?? 0,
        nextStepQuality: row.next_step_quality ?? 0,
        prioritization: row.prioritization ?? 0,
        outcomeAlignment: row.outcome_alignment ?? 0,
        ...(row.stakeholder_mapping != null ? { stakeholderMapping: row.stakeholder_mapping } : {}),
        ...(row.deal_qualification != null ? { dealQualification: row.deal_qualification } : {}),
        ...(row.information_synthesis != null ? { informationSynthesis: row.information_synthesis } : {}),
        ...(row.communication_quality != null ? { communicationQuality: row.communication_quality } : {}),
      },
    },
    taskEvaluations,
  };
}

export async function getArtifactRunDetailsByAgentId(
  agentId: string,
  deps: ResultsDeps = defaultResultsDeps
): Promise<ArtifactRunDetails | null> {
  // Find the latest run for this agent that has artifact-based dimension scores
  const runResult = await deps.sql`
    SELECT br.id
    FROM benchmark_runs br
    JOIN dimension_scores ds ON br.id = ds.run_id
    WHERE br.agent_id = ${agentId}
      AND ds.stakeholder_mapping IS NOT NULL
    ORDER BY br.aggregate_score DESC
    LIMIT 1
  `;

  if (runResult.rows.length === 0) return null;

  return getArtifactRunDetails(runResult.rows[0]!.id, deps);
}

// HTTP Handlers for Artifact-Based endpoints
export async function handleGetArtifactLeaderboard(
  _req: Request,
  deps: ResultsDeps = defaultResultsDeps
): Promise<Response> {
  try {
    const leaderboard = await getArtifactLeaderboard(deps);
    return Response.json({
      version: 2,
      count: leaderboard.length,
      entries: leaderboard,
    });
  } catch (error) {
    console.error("Failed to get artifact-based leaderboard:", error);
    return Response.json({ error: "Failed to load artifact-based leaderboard", entries: [] }, { status: 500 });
  }
}

export async function handleGetArtifactRunDetails(
  req: Request,
  deps: ResultsDeps = defaultResultsDeps
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const idParam = pathParts[pathParts.length - 1];

    if (!idParam) {
      return Response.json({ error: "Run ID or agent ID is required" }, { status: 400 });
    }

    let details: ArtifactRunDetails | null = null;
    const runId = parseInt(idParam, 10);
    if (!isNaN(runId)) {
      details = await getArtifactRunDetails(runId, deps);
    } else {
      // Look up the latest run for this agent ID
      details = await getArtifactRunDetailsByAgentId(idParam, deps);
    }
    if (!details) {
      return Response.json({ error: "Run not found" }, { status: 404 });
    }

    return Response.json(details);
  } catch (error) {
    console.error("Failed to get artifact-based run details:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to load run details" },
      { status: 500 }
    );
  }
}

// Vercel default export (for POST /api/results)
export const config = { runtime: "edge" };
export default handleSaveResult;
