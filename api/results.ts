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
export async function initDatabase(): Promise<void> {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT,
        endpoint TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;

    await sql`
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

    await sql`
      CREATE TABLE IF NOT EXISTS dimension_scores (
        id SERIAL PRIMARY KEY,
        run_id INTEGER NOT NULL REFERENCES benchmark_runs(id) ON DELETE CASCADE,
        risk_identification REAL NOT NULL,
        next_step_quality REAL NOT NULL,
        prioritization REAL NOT NULL,
        outcome_alignment REAL NOT NULL
      )
    `;

    // Create indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_runs_agent ON benchmark_runs(agent_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_runs_mode ON benchmark_runs(mode)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_runs_timestamp ON benchmark_runs(run_timestamp DESC)`;

    console.log("Database tables initialized");
  } catch (error) {
    console.error("Failed to initialize database:", error);
    throw error;
  }
}

// Agent operations
export async function upsertAgent(id: string, endpoint: string, name?: string): Promise<StoredAgent> {
  const existing = await sql`SELECT * FROM agents WHERE id = ${id}`;

  if (existing.rows.length > 0) {
    await sql`
      UPDATE agents
      SET name = COALESCE(${name ?? null}, name), endpoint = ${endpoint}, updated_at = NOW()
      WHERE id = ${id}
    `;
  } else {
    await sql`
      INSERT INTO agents (id, name, endpoint)
      VALUES (${id}, ${name ?? null}, ${endpoint})
    `;
  }

  const result = await sql`SELECT * FROM agents WHERE id = ${id}`;
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

export async function getAgent(id: string): Promise<StoredAgent | null> {
  const result = await sql`SELECT * FROM agents WHERE id = ${id}`;

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
}): Promise<number> {
  // Ensure agent exists
  await upsertAgent(result.agentId, result.agentEndpoint, result.agentName);

  // Insert benchmark run
  const runResult = await sql`
    INSERT INTO benchmark_runs
    (agent_id, mode, aggregate_score, max_possible_score, deals_evaluated, checkpoints_evaluated, avg_latency_ms, run_timestamp)
    VALUES (${result.agentId}, ${result.mode}, ${result.aggregateScore}, ${result.maxPossibleScore},
            ${result.dealsEvaluated}, ${result.checkpointsEvaluated}, ${result.avgLatencyMs ?? null}, ${result.runTimestamp})
    RETURNING id
  `;

  const runId = runResult.rows[0]?.id;
  if (!runId) {
    throw new Error("Failed to insert benchmark run");
  }

  // Insert dimension scores
  await sql`
    INSERT INTO dimension_scores (run_id, risk_identification, next_step_quality, prioritization, outcome_alignment)
    VALUES (${runId}, ${result.scores.riskIdentification}, ${result.scores.nextStepQuality},
            ${result.scores.prioritization}, ${result.scores.outcomeAlignment})
  `;

  return runId;
}

// Get leaderboard (best score per agent for a given mode)
export async function getLeaderboard(mode: "public" | "private" = "private"): Promise<LeaderboardEntry[]> {
  const results = await sql`
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
export async function getAllRuns(options?: { mode?: "public" | "private"; limit?: number }): Promise<StoredRun[]> {
  const limit = options?.limit ?? 100;

  let results;
  if (options?.mode) {
    results = await sql`
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
      ORDER BY br.run_timestamp DESC
      LIMIT ${limit}
    `;
  } else {
    results = await sql`
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
export async function getAgentRunHistory(agentId: string, limit = 10): Promise<StoredRun[]> {
  const results = await sql`
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
export async function handleGetLeaderboard(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") === "public" ? "public" : "private";

    const leaderboard = await getLeaderboard(mode);

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

export async function handleGetAllRuns(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") as "public" | "private" | null;
    const limit = url.searchParams.get("limit");

    const runs = await getAllRuns({
      mode: mode || undefined,
      limit: limit ? parseInt(limit, 10) : 100,
    });

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

export async function handleSaveResult(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body: SaveResultBody = await req.json();

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
      dealsEvaluated: body.dealResults?.length || body.dealsEvaluated,
      checkpointsEvaluated,
      avgLatencyMs: body.avgLatencyMs,
      runTimestamp: body.runTimestamp,
      scores: scores || {
        riskIdentification: 0,
        nextStepQuality: 0,
        prioritization: 0,
        outcomeAlignment: 0,
      },
    });

    return Response.json({ success: true, runId });
  } catch (error) {
    console.error("Failed to save result:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to save result" },
      { status: 500 }
    );
  }
}

export async function handleInitDatabase(req: Request): Promise<Response> {
  try {
    await initDatabase();
    return Response.json({ success: true, message: "Database initialized" });
  } catch (error) {
    console.error("Failed to initialize database:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to initialize database" },
      { status: 500 }
    );
  }
}

// Vercel default export (for POST /api/results)
export const config = { runtime: "edge" };
export default handleSaveResult;
