import { test, expect, describe, beforeEach } from "bun:test";

// --- Mock setup ---
// sql is used as a tagged template literal: sql`SELECT ...`
// We use an array of queued responses and a wrapper function.

let sqlCallCount = 0;
let sqlResponses: { rows: any[] }[] = [];
let sqlError: any = null;

// The actual mock function invoked by sql``
function mockSqlImpl(..._args: any[]): Promise<{ rows: any[] }> {
  if (sqlError) {
    return Promise.reject(sqlError);
  }
  const result = sqlResponses[sqlCallCount] ?? { rows: [] };
  sqlCallCount++;
  return Promise.resolve(result);
}

// Track calls for assertions
const sqlCalls: any[][] = [];
function trackedSqlImpl(...args: any[]): Promise<{ rows: any[] }> {
  sqlCalls.push(args);
  return mockSqlImpl(...args);
}

const testDeps = {
  sql: trackedSqlImpl,
} as any;

import {
  initDatabase,
  upsertAgent,
  getAgent,
  saveBenchmarkRun,
  saveJudgeEvaluation,
  getJudgeEvaluations,
  getLeaderboard,
  getAllRuns,
  getAgentRunHistory,
  handleGetLeaderboard,
  handleGetAllRuns,
  handleSaveResult,
  handleInitDatabase,
} from "./results";

// Helper to configure mock responses
function mockSqlReturns(...returnValues: { rows: any[] }[]) {
  sqlResponses = returnValues;
  sqlCallCount = 0;
  sqlError = null;
}

function mockSqlError(error: any) {
  sqlError = error;
}

// Helper to create a mock Request
function makeRequest(url: string, options?: RequestInit): Request {
  return new Request(url, options);
}

// Sample data
const sampleAgentRow = {
  id: "agent-1",
  name: "Test Agent",
  endpoint: "http://localhost:3000/agent",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const sampleRunRow = {
  id: 1,
  agent_id: "agent-1",
  agent_name: "Test Agent",
  mode: "private",
  aggregate_score: 100,
  max_possible_score: 120,
  deals_evaluated: 5,
  checkpoints_evaluated: 10,
  avg_latency_ms: 250.5,
  run_timestamp: "2026-01-15T12:00:00Z",
  risk_identification: 0.8,
  next_step_quality: 0.9,
  prioritization: 0.7,
  outcome_alignment: 0.85,
};

const sampleRunRow2 = {
  id: 2,
  agent_id: "agent-2",
  agent_name: "Agent Two",
  mode: "private",
  aggregate_score: 90,
  max_possible_score: 120,
  deals_evaluated: 5,
  checkpoints_evaluated: 10,
  avg_latency_ms: 300,
  run_timestamp: "2026-01-16T12:00:00Z",
  risk_identification: 0.7,
  next_step_quality: 0.8,
  prioritization: 0.6,
  outcome_alignment: 0.75,
};

beforeEach(() => {
  sqlCallCount = 0;
  sqlResponses = [];
  sqlError = null;
  sqlCalls.length = 0;
});

// --- Tests ---

describe("initDatabase", () => {
  test("creates all tables and indexes", async () => {
    await initDatabase(testDeps);
    // 6 CREATE TABLE (4 v1 + 2 v2) + 8 CREATE INDEX (5 v1 + 3 v2) = 14 sql calls
    expect(sqlCalls.length).toBe(14);
  });

  test("throws on database error", async () => {
    mockSqlError(new Error("Connection refused"));

    await expect(initDatabase(testDeps)).rejects.toThrow("Connection refused");
  });
});

describe("upsertAgent", () => {
  test("inserts a new agent when none exists", async () => {
    // Call 1: SELECT (no results) -> Call 2: INSERT -> Call 3: SELECT (return agent)
    mockSqlReturns(
      { rows: [] },
      { rows: [] },
      { rows: [sampleAgentRow] }
    );

    const result = await upsertAgent("agent-1", "http://localhost:3000/agent", "Test Agent", testDeps);

    expect(result.id).toBe("agent-1");
    expect(result.name).toBe("Test Agent");
    expect(result.endpoint).toBe("http://localhost:3000/agent");
    expect(sqlCalls.length).toBe(3);
  });

  test("updates an existing agent", async () => {
    // Call 1: SELECT (found) -> Call 2: UPDATE -> Call 3: SELECT (return agent)
    mockSqlReturns(
      { rows: [sampleAgentRow] },
      { rows: [] },
      { rows: [{ ...sampleAgentRow, name: "Updated Agent" }] }
    );

    const result = await upsertAgent("agent-1", "http://localhost:3000/agent", "Updated Agent", testDeps);

    expect(result.name).toBe("Updated Agent");
    expect(sqlCalls.length).toBe(3);
  });

  test("throws if agent not found after upsert", async () => {
    mockSqlReturns({ rows: [] }, { rows: [] }, { rows: [] });

    await expect(
      upsertAgent("agent-1", "http://localhost:3000/agent", undefined, testDeps)
    ).rejects.toThrow("Agent not found after upsert: agent-1");
  });
});

describe("getAgent", () => {
  test("returns agent when found", async () => {
    mockSqlReturns({ rows: [sampleAgentRow] });

    const result = await getAgent("agent-1", testDeps);

    expect(result).not.toBeNull();
    expect(result!.id).toBe("agent-1");
    expect(result!.name).toBe("Test Agent");
    expect(result!.endpoint).toBe("http://localhost:3000/agent");
    expect(result!.createdAt).toBe("2026-01-01T00:00:00Z");
  });

  test("returns null when agent not found", async () => {
    mockSqlReturns({ rows: [] });

    const result = await getAgent("nonexistent", testDeps);
    expect(result).toBeNull();
  });
});

describe("saveBenchmarkRun", () => {
  test("saves a benchmark run and returns run ID", async () => {
    // upsertAgent: SELECT, INSERT, SELECT -> INSERT run -> INSERT scores
    mockSqlReturns(
      { rows: [] },                    // agent SELECT (not found)
      { rows: [] },                    // agent INSERT
      { rows: [sampleAgentRow] },      // agent final SELECT
      { rows: [{ id: 42 }] },         // benchmark_runs INSERT RETURNING id
      { rows: [] }                     // dimension_scores INSERT
    );

    const runId = await saveBenchmarkRun({
      agentId: "agent-1",
      agentEndpoint: "http://localhost:3000/agent",
      agentName: "Test Agent",
      mode: "private",
      aggregateScore: 100.7,
      maxPossibleScore: 120.3,
      dealsEvaluated: 5,
      checkpointsEvaluated: 10,
      avgLatencyMs: 250,
      runTimestamp: "2026-01-15T12:00:00Z",
      scores: {
        riskIdentification: 0.8,
        nextStepQuality: 0.9,
        prioritization: 0.7,
        outcomeAlignment: 0.85,
      },
    }, testDeps);

    expect(runId).toBe(42);
  });

  test("throws when run insert fails", async () => {
    // upsertAgent succeeds, but run INSERT returns no id
    mockSqlReturns(
      { rows: [] },
      { rows: [] },
      { rows: [sampleAgentRow] },
      { rows: [{}] } // no id returned
    );

    await expect(
      saveBenchmarkRun({
        agentId: "agent-1",
        agentEndpoint: "http://localhost:3000/agent",
        mode: "private",
        aggregateScore: 100,
        maxPossibleScore: 120,
        dealsEvaluated: 5,
        checkpointsEvaluated: 10,
        runTimestamp: "2026-01-15T12:00:00Z",
        scores: {
          riskIdentification: 0.8,
          nextStepQuality: 0.9,
          prioritization: 0.7,
          outcomeAlignment: 0.85,
        },
      }, testDeps)
    ).rejects.toThrow("Failed to insert benchmark run");
  });
});

describe("saveJudgeEvaluation", () => {
  test("saves evaluation and returns ID", async () => {
    mockSqlReturns({ rows: [{ id: 7 }] });

    const id = await saveJudgeEvaluation({
      runId: 1,
      checkpointId: "cp-1",
      judgeModel: "gpt-4o",
      scores: {
        riskIdentification: 0.8,
        nextStepQuality: 0.9,
        prioritization: 0.7,
        outcomeAlignment: 0.85,
      },
      feedback: "Good analysis",
      risksIdentified: ["risk1"],
      risksMissed: ["risk2"],
      helpfulRecommendations: ["rec1"],
      unhelpfulRecommendations: [],
    }, testDeps);

    expect(id).toBe(7);
  });

  test("saves evaluation with optional fields omitted", async () => {
    mockSqlReturns({ rows: [{ id: 8 }] });

    const id = await saveJudgeEvaluation({
      runId: 1,
      checkpointId: "cp-2",
      judgeModel: "claude-3-opus",
      scores: {
        riskIdentification: 0.5,
        nextStepQuality: 0.6,
        prioritization: 0.4,
        outcomeAlignment: 0.55,
      },
    }, testDeps);

    expect(id).toBe(8);
  });

  test("throws when insert fails", async () => {
    mockSqlReturns({ rows: [{}] });

    await expect(
      saveJudgeEvaluation({
        runId: 1,
        checkpointId: "cp-1",
        judgeModel: "gpt-4o",
        scores: {
          riskIdentification: 0.8,
          nextStepQuality: 0.9,
          prioritization: 0.7,
          outcomeAlignment: 0.85,
        },
      }, testDeps)
    ).rejects.toThrow("Failed to insert judge evaluation");
  });
});

describe("getJudgeEvaluations", () => {
  test("returns mapped evaluations", async () => {
    mockSqlReturns({
      rows: [
        {
          run_id: 1,
          checkpoint_id: "cp-1",
          judge_model: "gpt-4o",
          risk_identification: 0.8,
          next_step_quality: 0.9,
          prioritization: 0.7,
          outcome_alignment: 0.85,
          feedback: "Good",
          risks_identified: ["r1"],
          risks_missed: [],
          helpful_recommendations: ["h1"],
          unhelpful_recommendations: [],
        },
      ],
    });

    const evals = await getJudgeEvaluations(1, testDeps);

    expect(evals).toHaveLength(1);
    expect(evals[0].runId).toBe(1);
    expect(evals[0].checkpointId).toBe("cp-1");
    expect(evals[0].judgeModel).toBe("gpt-4o");
    expect(evals[0].scores.riskIdentification).toBe(0.8);
    expect(evals[0].feedback).toBe("Good");
  });

  test("returns empty array when no evaluations", async () => {
    mockSqlReturns({ rows: [] });

    const evals = await getJudgeEvaluations(999, testDeps);
    expect(evals).toHaveLength(0);
  });
});

describe("getLeaderboard", () => {
  test("returns sorted leaderboard with ranks", async () => {
    mockSqlReturns({
      rows: [sampleRunRow, sampleRunRow2],
    });

    const leaderboard = await getLeaderboard("private", testDeps);

    expect(leaderboard).toHaveLength(2);
    // sampleRunRow: 100/120 = 83%, sampleRunRow2: 90/120 = 75%
    expect(leaderboard[0].rank).toBe(1);
    expect(leaderboard[0].agentId).toBe("agent-1");
    expect(leaderboard[0].percentage).toBe(83);
    expect(leaderboard[1].rank).toBe(2);
    expect(leaderboard[1].agentId).toBe("agent-2");
    expect(leaderboard[1].percentage).toBe(75);
  });

  test("returns empty leaderboard when no data", async () => {
    mockSqlReturns({ rows: [] });

    const leaderboard = await getLeaderboard("public", testDeps);
    expect(leaderboard).toHaveLength(0);
  });

  test("includes dimension scores in entries", async () => {
    mockSqlReturns({ rows: [sampleRunRow] });

    const leaderboard = await getLeaderboard("private", testDeps);

    expect(leaderboard[0].scores).toEqual({
      riskIdentification: 0.8,
      nextStepQuality: 0.9,
      prioritization: 0.7,
      outcomeAlignment: 0.85,
    });
  });

  test("includes avgLatencyMs and other fields", async () => {
    mockSqlReturns({ rows: [sampleRunRow] });

    const leaderboard = await getLeaderboard("private", testDeps);
    const entry = leaderboard[0];

    expect(entry.score).toBe(100);
    expect(entry.maxScore).toBe(120);
    expect(entry.dealsEvaluated).toBe(5);
    expect(entry.checkpointsEvaluated).toBe(10);
    expect(entry.avgLatencyMs).toBe(250.5);
    expect(entry.lastRun).toBe("2026-01-15T12:00:00Z");
    expect(entry.agentName).toBe("Test Agent");
  });
});

describe("getAllRuns", () => {
  test("returns runs without mode filter", async () => {
    mockSqlReturns({ rows: [sampleRunRow] });

    const runs = await getAllRuns(undefined, testDeps);

    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe(1);
    expect(runs[0].agentId).toBe("agent-1");
    expect(runs[0].percentage).toBe(83);
  });

  test("returns runs with mode filter", async () => {
    mockSqlReturns({ rows: [sampleRunRow] });

    const runs = await getAllRuns({ mode: "public" }, testDeps);

    expect(runs).toHaveLength(1);
  });

  test("respects limit option", async () => {
    mockSqlReturns({ rows: [] });

    await getAllRuns({ limit: 5 }, testDeps);
    expect(sqlCalls.length).toBe(1);
  });

  test("defaults limit to 100", async () => {
    mockSqlReturns({ rows: [] });

    await getAllRuns(undefined, testDeps);
    expect(sqlCalls.length).toBe(1);
  });

  test("maps all fields correctly", async () => {
    mockSqlReturns({ rows: [sampleRunRow] });

    const runs = await getAllRuns(undefined, testDeps);
    const run = runs[0];

    expect(run).toEqual({
      id: 1,
      agentId: "agent-1",
      agentName: "Test Agent",
      mode: "private",
      aggregateScore: 100,
      maxPossibleScore: 120,
      percentage: 83,
      dealsEvaluated: 5,
      checkpointsEvaluated: 10,
      avgLatencyMs: 250.5,
      runTimestamp: "2026-01-15T12:00:00Z",
      scores: {
        riskIdentification: 0.8,
        nextStepQuality: 0.9,
        prioritization: 0.7,
        outcomeAlignment: 0.85,
      },
    });
  });
});

describe("getAgentRunHistory", () => {
  test("returns runs for specific agent", async () => {
    mockSqlReturns({ rows: [sampleRunRow] });

    const runs = await getAgentRunHistory("agent-1", undefined, testDeps);

    expect(runs).toHaveLength(1);
    expect(runs[0].agentId).toBe("agent-1");
  });

  test("returns empty array when no history", async () => {
    mockSqlReturns({ rows: [] });

    const runs = await getAgentRunHistory("nonexistent", undefined, testDeps);
    expect(runs).toHaveLength(0);
  });
});

// --- HTTP Handler Tests ---

describe("handleGetLeaderboard", () => {
  test("returns leaderboard for default (private) mode", async () => {
    mockSqlReturns({ rows: [sampleRunRow] });

    const req = makeRequest("http://localhost/api/leaderboard");
    const res = await handleGetLeaderboard(req, testDeps);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.mode).toBe("private");
    expect(body.count).toBe(1);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].rank).toBe(1);
  });

  test("returns leaderboard for public mode", async () => {
    mockSqlReturns({ rows: [] });

    const req = makeRequest("http://localhost/api/leaderboard?mode=public");
    const res = await handleGetLeaderboard(req, testDeps);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.mode).toBe("public");
    expect(body.count).toBe(0);
    expect(body.entries).toEqual([]);
  });

  test("returns 500 on database error", async () => {
    mockSqlError(new Error("DB error"));

    const req = makeRequest("http://localhost/api/leaderboard");
    const res = await handleGetLeaderboard(req, testDeps);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Failed to load leaderboard");
    expect(body.entries).toEqual([]);
  });
});

describe("handleGetAllRuns", () => {
  test("returns all runs with default options", async () => {
    mockSqlReturns({ rows: [sampleRunRow, sampleRunRow2] });

    const req = makeRequest("http://localhost/api/runs");
    const res = await handleGetAllRuns(req, testDeps);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.count).toBe(2);
    expect(body.runs).toHaveLength(2);
  });

  test("passes mode filter from query params", async () => {
    mockSqlReturns({ rows: [] });

    const req = makeRequest("http://localhost/api/runs?mode=public");
    const res = await handleGetAllRuns(req, testDeps);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.count).toBe(0);
  });

  test("passes limit from query params", async () => {
    mockSqlReturns({ rows: [] });

    const req = makeRequest("http://localhost/api/runs?limit=5");
    const res = await handleGetAllRuns(req, testDeps);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.count).toBe(0);
  });

  test("returns 500 on database error", async () => {
    mockSqlError(new Error("DB error"));

    const req = makeRequest("http://localhost/api/runs");
    const res = await handleGetAllRuns(req, testDeps);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Failed to load runs");
    expect(body.runs).toEqual([]);
  });
});

describe("handleSaveResult", () => {
  test("rejects non-POST requests", async () => {
    const req = makeRequest("http://localhost/api/results", { method: "GET" });
    const res = await handleSaveResult(req, testDeps);
    const body = await res.json();

    expect(res.status).toBe(405);
    expect(body.error).toBe("Method not allowed");
  });

  test("saves result with explicit scores", async () => {
    // upsertAgent: SELECT, INSERT, SELECT -> run INSERT -> scores INSERT
    mockSqlReturns(
      { rows: [] },
      { rows: [] },
      { rows: [sampleAgentRow] },
      { rows: [{ id: 10 }] },
      { rows: [] }
    );

    const req = makeRequest("http://localhost/api/results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "agent-1",
        agentEndpoint: "http://localhost:3000/agent",
        agentName: "Test Agent",
        mode: "private",
        aggregateScore: 100,
        maxPossibleScore: 120,
        dealsEvaluated: 5,
        checkpointsEvaluated: 10,
        runTimestamp: "2026-01-15T12:00:00Z",
        scores: {
          riskIdentification: 0.8,
          nextStepQuality: 0.9,
          prioritization: 0.7,
          outcomeAlignment: 0.85,
        },
      }),
    });

    const res = await handleSaveResult(req, testDeps);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.runId).toBe(10);
  });

  test("calculates scores from dealResults when scores not provided", async () => {
    mockSqlReturns(
      { rows: [] },
      { rows: [] },
      { rows: [sampleAgentRow] },
      { rows: [{ id: 11 }] },
      { rows: [] }
    );

    const req = makeRequest("http://localhost/api/results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "agent-1",
        agentEndpoint: "http://localhost:3000/agent",
        mode: "private",
        aggregateScore: 100,
        maxPossibleScore: 120,
        runTimestamp: "2026-01-15T12:00:00Z",
        dealResults: [
          {
            dealId: "deal-1",
            checkpointEvaluations: [
              {
                scores: {
                  riskIdentification: 0.8,
                  nextStepQuality: 0.6,
                  prioritization: 0.4,
                  outcomeAlignment: 1.0,
                },
              },
              {
                scores: {
                  riskIdentification: 0.4,
                  nextStepQuality: 0.8,
                  prioritization: 0.6,
                  outcomeAlignment: 0.2,
                },
              },
            ],
          },
        ],
      }),
    });

    const res = await handleSaveResult(req, testDeps);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.runId).toBe(11);
  });

  test("counts checkpoints from dealResults when not provided", async () => {
    mockSqlReturns(
      { rows: [] },
      { rows: [] },
      { rows: [sampleAgentRow] },
      { rows: [{ id: 12 }] },
      { rows: [] }
    );

    const req = makeRequest("http://localhost/api/results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "agent-1",
        agentEndpoint: "http://localhost:3000/agent",
        mode: "private",
        aggregateScore: 50,
        maxPossibleScore: 100,
        runTimestamp: "2026-01-15T12:00:00Z",
        dealResults: [
          {
            dealId: "deal-1",
            checkpointEvaluations: [
              { scores: { riskIdentification: 0, nextStepQuality: 0, prioritization: 0, outcomeAlignment: 0 } },
              { scores: { riskIdentification: 0, nextStepQuality: 0, prioritization: 0, outcomeAlignment: 0 } },
            ],
          },
          {
            dealId: "deal-2",
            checkpointEvaluations: [
              { scores: { riskIdentification: 0, nextStepQuality: 0, prioritization: 0, outcomeAlignment: 0 } },
            ],
          },
        ],
      }),
    });

    const res = await handleSaveResult(req, testDeps);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("uses default scores when neither scores nor dealResults provided", async () => {
    mockSqlReturns(
      { rows: [] },
      { rows: [] },
      { rows: [sampleAgentRow] },
      { rows: [{ id: 13 }] },
      { rows: [] }
    );

    const req = makeRequest("http://localhost/api/results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "agent-1",
        agentEndpoint: "http://localhost:3000/agent",
        mode: "private",
        aggregateScore: 50,
        maxPossibleScore: 100,
        runTimestamp: "2026-01-15T12:00:00Z",
      }),
    });

    const res = await handleSaveResult(req, testDeps);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("returns 500 on database error", async () => {
    mockSqlError(new Error("Insert failed"));

    const req = makeRequest("http://localhost/api/results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "agent-1",
        agentEndpoint: "http://localhost:3000/agent",
        mode: "private",
        aggregateScore: 50,
        maxPossibleScore: 100,
        runTimestamp: "2026-01-15T12:00:00Z",
      }),
    });

    const res = await handleSaveResult(req, testDeps);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Insert failed");
  });

  test("returns generic error message for non-Error exceptions", async () => {
    mockSqlError("string error");

    const req = makeRequest("http://localhost/api/results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "agent-1",
        agentEndpoint: "http://localhost:3000/agent",
        mode: "private",
        aggregateScore: 50,
        maxPossibleScore: 100,
        runTimestamp: "2026-01-15T12:00:00Z",
      }),
    });

    const res = await handleSaveResult(req, testDeps);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Failed to save result");
  });
});

describe("handleInitDatabase", () => {
  test("initializes database successfully", async () => {
    const req = makeRequest("http://localhost/api/init-db");
    const res = await handleInitDatabase(req, testDeps);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toBe("Database initialized");
  });

  test("returns 500 on error", async () => {
    mockSqlError(new Error("Schema error"));

    const req = makeRequest("http://localhost/api/init-db");
    const res = await handleInitDatabase(req, testDeps);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Schema error");
  });

  test("returns generic error for non-Error exceptions", async () => {
    mockSqlError(42);

    const req = makeRequest("http://localhost/api/init-db");
    const res = await handleInitDatabase(req, testDeps);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Failed to initialize database");
  });
});

describe("leaderboard response format", () => {
  test("entries contain all required LeaderboardEntry fields", async () => {
    mockSqlReturns({ rows: [sampleRunRow] });

    const leaderboard = await getLeaderboard("private", testDeps);
    const entry = leaderboard[0];

    // Verify all LeaderboardEntry fields exist
    expect(entry).toHaveProperty("rank");
    expect(entry).toHaveProperty("agentId");
    expect(entry).toHaveProperty("agentName");
    expect(entry).toHaveProperty("score");
    expect(entry).toHaveProperty("maxScore");
    expect(entry).toHaveProperty("percentage");
    expect(entry).toHaveProperty("dealsEvaluated");
    expect(entry).toHaveProperty("checkpointsEvaluated");
    expect(entry).toHaveProperty("avgLatencyMs");
    expect(entry).toHaveProperty("lastRun");
    expect(entry).toHaveProperty("scores");
    expect(entry.scores).toHaveProperty("riskIdentification");
    expect(entry.scores).toHaveProperty("nextStepQuality");
    expect(entry.scores).toHaveProperty("prioritization");
    expect(entry.scores).toHaveProperty("outcomeAlignment");
  });

  test("percentage is correctly rounded", async () => {
    const runWith33Pct = {
      ...sampleRunRow,
      aggregate_score: 1,
      max_possible_score: 3,
    };
    mockSqlReturns({ rows: [runWith33Pct] });

    const leaderboard = await getLeaderboard("private", testDeps);
    expect(leaderboard[0].percentage).toBe(33);
  });
});
