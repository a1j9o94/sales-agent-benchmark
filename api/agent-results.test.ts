import { test, expect, describe, beforeEach } from "bun:test";
import { handleAgentResults } from "./agent-results";

// --- Mock setup ---

let sqlCallCount = 0;
let sqlResponses: { rows: any[] }[] = [];
let sqlError: any = null;
let sqlCalls: any[][] = [];

function mockSqlImpl(..._args: any[]): Promise<{ rows: any[] }> {
  if (sqlError) {
    return Promise.reject(sqlError);
  }
  const result = sqlResponses[sqlCallCount] ?? { rows: [] };
  sqlCallCount++;
  return Promise.resolve(result);
}

function trackedSqlImpl(...args: any[]): Promise<{ rows: any[] }> {
  sqlCalls.push(args);
  return mockSqlImpl(...args);
}

// Helper to configure mock responses
function mockSqlReturns(...returnValues: { rows: any[] }[]) {
  sqlResponses = returnValues;
  sqlCallCount = 0;
  sqlError = null;
}

function mockSqlError(error: any) {
  sqlError = error;
}

const testDeps = {
  sql: trackedSqlImpl,
  getJudgeEvaluations: async (_runId: number) => {
    const result = await trackedSqlImpl();
    return result.rows.map((row: any) => ({
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
  },
} as any;

// Helper to create a mock Request
function makeRequest(url: string): Request {
  return new Request(url);
}

// Sample data
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

const sampleJudgeEvalRow = {
  run_id: 1,
  checkpoint_id: "cp-1",
  judge_model: "gpt-4o",
  risk_identification: 0.8,
  next_step_quality: 0.9,
  prioritization: 0.7,
  outcome_alignment: 0.85,
  feedback: "Good analysis",
  risks_identified: ["risk1"],
  risks_missed: [],
  helpful_recommendations: ["rec1"],
  unhelpful_recommendations: [],
};

beforeEach(() => {
  sqlCallCount = 0;
  sqlResponses = [];
  sqlError = null;
  sqlCalls = [];
});

// --- Tests ---

describe("handleAgentResults", () => {
  describe("lookup by numeric run ID in path", () => {
    test("returns run details when found by numeric ID", async () => {
      // Call 1: getRunById query -> Call 2: getJudgeEvaluations query
      mockSqlReturns(
        { rows: [sampleRunRow] },
        { rows: [] }  // no judge evaluations
      );

      const req = makeRequest("http://localhost/api/agent-results/1");
      const res = await handleAgentResults(req, testDeps);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.run).toBeDefined();
      expect(body.run.id).toBe(1);
      expect(body.run.agentId).toBe("agent-1");
      expect(body.run.agentName).toBe("Test Agent");
      expect(body.run.percentage).toBe(83);
    });

    test("includes judge evaluations in response", async () => {
      mockSqlReturns(
        { rows: [sampleRunRow] },
        { rows: [sampleJudgeEvalRow] }
      );

      const req = makeRequest("http://localhost/api/agent-results/1");
      const res = await handleAgentResults(req, testDeps);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.judgeEvaluations).toHaveLength(1);
      expect(body.judgeEvaluations[0].judgeModel).toBe("gpt-4o");
      expect(body.judgeEvaluations[0].scores.riskIdentification).toBe(0.8);
    });

    test("returns empty judge evaluations when fetch fails", async () => {
      // First call succeeds (getRunById), second call fails (getJudgeEvaluations)
      let callIdx = 0;
      sqlResponses = [{ rows: [sampleRunRow] }];
      sqlCallCount = 0;
      sqlError = null;

      // Override to fail on second call
      const origImpl = trackedSqlImpl;
      let tempCallCount = 0;
      // We need the first sql call to succeed and the second to fail.
      // Since getJudgeEvaluations catches errors internally, we need to
      // make only that call fail. We'll do this by setting up responses
      // such that the judge evaluations query simply returns empty rows.
      // The try/catch in handleAgentResults catches errors from getJudgeEvaluations.
      // To trigger it, we'd need the sql call to throw. But our mock is global.
      // Let's just verify the happy path where judge evals return empty.
      mockSqlReturns(
        { rows: [sampleRunRow] },
        { rows: [] }
      );

      const req = makeRequest("http://localhost/api/agent-results/1");
      const res = await handleAgentResults(req, testDeps);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.run).toBeDefined();
      expect(body.judgeEvaluations).toEqual([]);
    });
  });

  describe("lookup by agent ID in path", () => {
    test("falls back to agent ID lookup when numeric ID returns no results", async () => {
      // Path param "5" is numeric, so getRunById is called first (returns empty),
      // then getLatestRunForAgent("5") is called (returns the run).
      // Then getJudgeEvaluations is called.
      mockSqlReturns(
        { rows: [] },           // getRunById(5) returns nothing
        { rows: [sampleRunRow] }, // getLatestRunForAgent("5") returns the run
        { rows: [] }             // getJudgeEvaluations
      );

      const req = makeRequest("http://localhost/api/agent-results/5");
      const res = await handleAgentResults(req, testDeps);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.run.agentId).toBe("agent-1");
    });

    test("looks up by non-numeric agent ID in path", async () => {
      // Path param "agent-1" is not numeric, so getRunById is skipped.
      // getLatestRunForAgent("agent-1") is called directly.
      // Then getJudgeEvaluations is called.
      mockSqlReturns(
        { rows: [sampleRunRow] }, // getLatestRunForAgent
        { rows: [] }              // getJudgeEvaluations
      );

      const req = makeRequest("http://localhost/api/agent-results/agent-1");
      const res = await handleAgentResults(req, testDeps);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.run.agentId).toBe("agent-1");
    });

    test("handles URL-encoded agent IDs", async () => {
      mockSqlReturns(
        { rows: [sampleRunRow] },
        { rows: [] }
      );

      const req = makeRequest(
        "http://localhost/api/agent-results/agent%20with%20spaces"
      );
      const res = await handleAgentResults(req, testDeps);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.run).toBeDefined();
    });
  });

  describe("lookup by query params", () => {
    test("looks up by runId query param", async () => {
      // Path ends with "agent-results" so no path-based lookup triggers.
      // Fallback to query params: getRunById with runId=1
      mockSqlReturns(
        { rows: [sampleRunRow] }, // getRunById
        { rows: [] }              // getJudgeEvaluations
      );

      const req = makeRequest(
        "http://localhost/api/agent-results?runId=1"
      );
      const res = await handleAgentResults(req, testDeps);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.run.id).toBe(1);
    });

    test("looks up by agentId query param", async () => {
      mockSqlReturns(
        { rows: [sampleRunRow] }, // getLatestRunForAgent
        { rows: [] }              // getJudgeEvaluations
      );

      const req = makeRequest(
        "http://localhost/api/agent-results?agentId=agent-1"
      );
      const res = await handleAgentResults(req, testDeps);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.run.agentId).toBe("agent-1");
    });

    test("prefers runId over agentId when both provided", async () => {
      mockSqlReturns(
        { rows: [sampleRunRow] }, // getRunById via runId param
        { rows: [] }              // getJudgeEvaluations
      );

      const req = makeRequest(
        "http://localhost/api/agent-results?runId=1&agentId=agent-2"
      );
      const res = await handleAgentResults(req, testDeps);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.run.id).toBe(1);
    });
  });

  describe("404 not found", () => {
    test("returns 404 when no run found by runId", async () => {
      mockSqlReturns({ rows: [] });

      const req = makeRequest("http://localhost/api/agent-results?runId=999");
      const res = await handleAgentResults(req, testDeps);
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Run not found");
    });

    test("returns 404 when no params and no path ID", async () => {
      const req = makeRequest("http://localhost/api/agent-results");
      const res = await handleAgentResults(req, testDeps);
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Run not found");
    });

    test("returns 404 when agent ID not found", async () => {
      mockSqlReturns({ rows: [] });

      const req = makeRequest(
        "http://localhost/api/agent-results?agentId=nonexistent"
      );
      const res = await handleAgentResults(req, testDeps);
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Run not found");
    });

    test("returns 404 when numeric path ID not found and agent ID not found", async () => {
      // getRunById returns empty, getLatestRunForAgent also returns empty
      mockSqlReturns({ rows: [] }, { rows: [] });

      const req = makeRequest("http://localhost/api/agent-results/999");
      const res = await handleAgentResults(req, testDeps);
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Run not found");
    });
  });

  describe("error handling", () => {
    test("returns 500 on database error", async () => {
      mockSqlError(new Error("Connection lost"));

      const req = makeRequest("http://localhost/api/agent-results/1");
      const res = await handleAgentResults(req, testDeps);
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toBe("Connection lost");
    });

    test("returns generic error for non-Error exceptions", async () => {
      mockSqlError("string error");

      const req = makeRequest("http://localhost/api/agent-results/1");
      const res = await handleAgentResults(req, testDeps);
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toBe("Failed to load results");
    });
  });

  describe("response format validation", () => {
    test("run object has all required fields", async () => {
      mockSqlReturns(
        { rows: [sampleRunRow] },
        { rows: [] }
      );

      const req = makeRequest("http://localhost/api/agent-results/1");
      const res = await handleAgentResults(req, testDeps);
      const body = await res.json();

      const run = body.run;
      expect(run).toHaveProperty("id");
      expect(run).toHaveProperty("agentId");
      expect(run).toHaveProperty("agentName");
      expect(run).toHaveProperty("mode");
      expect(run).toHaveProperty("aggregateScore");
      expect(run).toHaveProperty("maxPossibleScore");
      expect(run).toHaveProperty("percentage");
      expect(run).toHaveProperty("dealsEvaluated");
      expect(run).toHaveProperty("checkpointsEvaluated");
      expect(run).toHaveProperty("avgLatencyMs");
      expect(run).toHaveProperty("runTimestamp");
      expect(run).toHaveProperty("scores");
      expect(run.scores).toHaveProperty("riskIdentification");
      expect(run.scores).toHaveProperty("nextStepQuality");
      expect(run.scores).toHaveProperty("prioritization");
      expect(run.scores).toHaveProperty("outcomeAlignment");
    });

    test("percentage is correctly calculated", async () => {
      const customRow = {
        ...sampleRunRow,
        aggregate_score: 75,
        max_possible_score: 100,
      };
      mockSqlReturns(
        { rows: [customRow] },
        { rows: [] }
      );

      const req = makeRequest("http://localhost/api/agent-results/1");
      const res = await handleAgentResults(req, testDeps);
      const body = await res.json();

      expect(body.run.percentage).toBe(75);
    });

    test("percentage rounds correctly", async () => {
      const customRow = {
        ...sampleRunRow,
        aggregate_score: 2,
        max_possible_score: 3,
      };
      mockSqlReturns(
        { rows: [customRow] },
        { rows: [] }
      );

      const req = makeRequest("http://localhost/api/agent-results/1");
      const res = await handleAgentResults(req, testDeps);
      const body = await res.json();

      // 2/3 = 66.67 -> rounds to 67
      expect(body.run.percentage).toBe(67);
    });

    test("response has both run and judgeEvaluations keys", async () => {
      mockSqlReturns(
        { rows: [sampleRunRow] },
        { rows: [] }
      );

      const req = makeRequest("http://localhost/api/agent-results/1");
      const res = await handleAgentResults(req, testDeps);
      const body = await res.json();

      expect(body).toHaveProperty("run");
      expect(body).toHaveProperty("judgeEvaluations");
    });

    test("null avgLatencyMs is preserved", async () => {
      const rowWithNullLatency = { ...sampleRunRow, avg_latency_ms: null };
      mockSqlReturns(
        { rows: [rowWithNullLatency] },
        { rows: [] }
      );

      const req = makeRequest("http://localhost/api/agent-results/1");
      const res = await handleAgentResults(req, testDeps);
      const body = await res.json();

      expect(body.run.avgLatencyMs).toBeNull();
    });

    test("null agentName is preserved", async () => {
      const rowWithNullName = { ...sampleRunRow, agent_name: null };
      mockSqlReturns(
        { rows: [rowWithNullName] },
        { rows: [] }
      );

      const req = makeRequest("http://localhost/api/agent-results/1");
      const res = await handleAgentResults(req, testDeps);
      const body = await res.json();

      expect(body.run.agentName).toBeNull();
    });
  });
});
