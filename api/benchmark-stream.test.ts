/**
 * Unit tests for api/benchmark-stream.ts
 *
 * Tests the SSE benchmark streaming endpoint, including:
 * - Request validation (method, body, endpoint)
 * - Response normalization (severity, confidence clamping, field fallbacks)
 * - Agent ID generation from endpoint URLs
 * - SSE stream format and content type headers
 * - Error handling paths
 */

import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import type {
  Checkpoint,
  DealContext,
  GroundTruth,
  Deal,
  AgentResponse,
  EvaluationScores,
} from "../src/types/benchmark";
import { handleBenchmarkStream } from "./benchmark-stream";

// ============================================================
// Since buildAgentRequest, callAgentEndpoint, agentIdFromEndpoint,
// and loadDealsFromDir are NOT exported, we test them through
// the exported handleBenchmarkStream handler. We also duplicate
// the pure logic for direct unit testing below.
// ============================================================

// --- Helpers: duplicate pure logic from benchmark-stream.ts for direct unit tests ---

function buildAgentRequest(checkpoint: Checkpoint) {
  return {
    checkpointId: checkpoint.id,
    dealContext: checkpoint.context,
    question: "What are the top risks and recommended next steps for this deal?",
  };
}

function agentIdFromEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return `agent_${url.hostname.replace(/\./g, "_")}`;
  } catch {
    return `agent_${Date.now()}`;
  }
}

function normalizeResponse(data: Record<string, unknown>): AgentResponse {
  return {
    risks: ((data.risks as Record<string, unknown>[]) || []).map(
      (r: Record<string, unknown>) => ({
        description: String(r.description || "Unknown risk"),
        severity: ["high", "medium", "low"].includes(r.severity as string)
          ? (r.severity as "high" | "medium" | "low")
          : "medium",
      })
    ),
    nextSteps: (
      (data.nextSteps as Record<string, unknown>[]) ||
      (data.next_steps as Record<string, unknown>[]) ||
      []
    ).map((s: Record<string, unknown>, idx: number) => ({
      action: String(s.action || "No action specified"),
      priority: typeof s.priority === "number" ? s.priority : idx + 1,
      rationale: s.rationale as string | undefined,
    })),
    confidence:
      typeof data.confidence === "number"
        ? Math.min(1, Math.max(0, data.confidence))
        : 0.5,
    reasoning: String(data.reasoning || "No reasoning provided"),
  };
}

// --- Test fixtures ---

function makeContext(overrides?: Partial<DealContext>): DealContext {
  return {
    company: "TestCorp",
    stage: "Negotiation",
    lastInteraction: "2025-01-15",
    painPoints: ["slow onboarding"],
    stakeholders: [
      { name: "Alice", role: "VP Sales", sentiment: "positive" },
    ],
    history: "Demoed product last week",
    ...overrides,
  };
}

function makeGroundTruth(overrides?: Partial<GroundTruth>): GroundTruth {
  return {
    whatHappenedNext: "Deal moved forward after champion secured budget.",
    actualRisksThatMaterialized: ["Budget approval delayed"],
    outcomeAtThisPoint: "progressing",
    ...overrides,
  };
}

function makeCheckpoint(overrides?: Partial<Checkpoint>): Checkpoint {
  return {
    id: "cp-001",
    dealId: "deal-001",
    timestamp: "2025-01-15T10:00:00Z",
    context: makeContext(),
    groundTruth: makeGroundTruth(),
    ...overrides,
  };
}

function makeDeal(
  overrides?: Partial<Deal> & { checkpointCount?: number }
): Deal {
  const count = overrides?.checkpointCount ?? 2;
  const checkpoints =
    overrides?.checkpoints ??
    Array.from({ length: count }, (_, i) =>
      makeCheckpoint({ id: `cp-${i + 1}`, dealId: overrides?.id ?? "deal-001" })
    );
  return {
    id: "deal-001",
    name: "TestCorp Deal",
    checkpoints,
    finalOutcome: "won",
    ...overrides,
  };
}

// ============================================================
// SECTION 1: Pure function unit tests (duplicated logic)
// ============================================================

describe("buildAgentRequest", () => {
  test("builds request with checkpoint id, context, and question", () => {
    const checkpoint = makeCheckpoint({ id: "cp-42" });
    const req = buildAgentRequest(checkpoint);

    expect(req.checkpointId).toBe("cp-42");
    expect(req.dealContext).toBe(checkpoint.context);
    expect(req.question).toBe(
      "What are the top risks and recommended next steps for this deal?"
    );
  });

  test("includes full deal context from checkpoint", () => {
    const context = makeContext({ company: "Acme Inc", stage: "Discovery" });
    const checkpoint = makeCheckpoint({ context });
    const req = buildAgentRequest(checkpoint);

    expect(req.dealContext.company).toBe("Acme Inc");
    expect(req.dealContext.stage).toBe("Discovery");
    expect(req.dealContext.painPoints).toEqual(["slow onboarding"]);
  });
});

describe("agentIdFromEndpoint", () => {
  test("converts hostname dots to underscores", () => {
    expect(agentIdFromEndpoint("https://my-agent.example.com/api")).toBe(
      "agent_my-agent_example_com"
    );
  });

  test("handles simple hostname", () => {
    expect(agentIdFromEndpoint("https://localhost:3000/api")).toBe(
      "agent_localhost"
    );
  });

  test("handles subdomain-heavy URLs", () => {
    expect(agentIdFromEndpoint("https://a.b.c.d.com/path")).toBe(
      "agent_a_b_c_d_com"
    );
  });

  test("falls back to timestamp-based id for invalid URLs", () => {
    const before = Date.now();
    const id = agentIdFromEndpoint("not-a-url");
    const after = Date.now();

    expect(id).toMatch(/^agent_\d+$/);
    const ts = parseInt(id.replace("agent_", ""), 10);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  test("handles URL with port and path", () => {
    expect(agentIdFromEndpoint("http://api.service.io:8080/v2/analyze")).toBe(
      "agent_api_service_io"
    );
  });

  test("handles IP address endpoint", () => {
    expect(agentIdFromEndpoint("http://192.168.1.100:3000/api")).toBe(
      "agent_192_168_1_100"
    );
  });
});

describe("normalizeResponse (response normalization)", () => {
  describe("risks", () => {
    test("passes valid severity values through", () => {
      const result = normalizeResponse({
        risks: [
          { description: "Budget risk", severity: "high" },
          { description: "Timeline risk", severity: "medium" },
          { description: "Minor issue", severity: "low" },
        ],
      });

      expect(result.risks).toHaveLength(3);
      expect(result.risks[0]!.severity).toBe("high");
      expect(result.risks[1]!.severity).toBe("medium");
      expect(result.risks[2]!.severity).toBe("low");
    });

    test("defaults invalid severity to medium", () => {
      const result = normalizeResponse({
        risks: [
          { description: "Risk", severity: "critical" },
          { description: "Risk 2", severity: "HIGH" },
          { description: "Risk 3", severity: 42 },
          { description: "Risk 4" },
        ],
      });

      for (const risk of result.risks) {
        expect(risk.severity).toBe("medium");
      }
    });

    test("defaults missing description to 'Unknown risk'", () => {
      const result = normalizeResponse({
        risks: [{ severity: "high" }, {}],
      });

      expect(result.risks[0]!.description).toBe("Unknown risk");
      expect(result.risks[1]!.description).toBe("Unknown risk");
    });

    test("handles missing risks array gracefully", () => {
      const result = normalizeResponse({});
      expect(result.risks).toEqual([]);
    });

    test("handles null risks", () => {
      const result = normalizeResponse({ risks: null });
      expect(result.risks).toEqual([]);
    });
  });

  describe("nextSteps", () => {
    test("maps nextSteps with priority and action", () => {
      const result = normalizeResponse({
        nextSteps: [
          { action: "Schedule call", priority: 1, rationale: "Urgent" },
          { action: "Send proposal", priority: 2 },
        ],
      });

      expect(result.nextSteps).toHaveLength(2);
      expect(result.nextSteps[0]!.action).toBe("Schedule call");
      expect(result.nextSteps[0]!.priority).toBe(1);
      expect(result.nextSteps[0]!.rationale).toBe("Urgent");
      expect(result.nextSteps[1]!.priority).toBe(2);
    });

    test("defaults priority to index + 1 when not a number", () => {
      const result = normalizeResponse({
        nextSteps: [
          { action: "First" },
          { action: "Second" },
          { action: "Third", priority: "high" },
        ],
      });

      expect(result.nextSteps[0]!.priority).toBe(1);
      expect(result.nextSteps[1]!.priority).toBe(2);
      expect(result.nextSteps[2]!.priority).toBe(3);
    });

    test("defaults missing action to 'No action specified'", () => {
      const result = normalizeResponse({
        nextSteps: [{}],
      });
      expect(result.nextSteps[0]!.action).toBe("No action specified");
    });

    test("supports snake_case next_steps field", () => {
      const result = normalizeResponse({
        next_steps: [{ action: "Follow up", priority: 1 }],
      });

      expect(result.nextSteps).toHaveLength(1);
      expect(result.nextSteps[0]!.action).toBe("Follow up");
    });

    test("prefers camelCase nextSteps over snake_case next_steps", () => {
      const result = normalizeResponse({
        nextSteps: [{ action: "CamelCase action", priority: 1 }],
        next_steps: [{ action: "Snake action", priority: 2 }],
      });

      expect(result.nextSteps).toHaveLength(1);
      expect(result.nextSteps[0]!.action).toBe("CamelCase action");
    });

    test("handles missing nextSteps gracefully", () => {
      const result = normalizeResponse({});
      expect(result.nextSteps).toEqual([]);
    });
  });

  describe("confidence", () => {
    test("passes valid confidence values through", () => {
      expect(normalizeResponse({ confidence: 0.75 }).confidence).toBe(0.75);
      expect(normalizeResponse({ confidence: 0 }).confidence).toBe(0);
      expect(normalizeResponse({ confidence: 1 }).confidence).toBe(1);
    });

    test("clamps confidence above 1 to 1", () => {
      expect(normalizeResponse({ confidence: 1.5 }).confidence).toBe(1);
      expect(normalizeResponse({ confidence: 100 }).confidence).toBe(1);
    });

    test("clamps confidence below 0 to 0", () => {
      expect(normalizeResponse({ confidence: -0.5 }).confidence).toBe(0);
      expect(normalizeResponse({ confidence: -1 }).confidence).toBe(0);
    });

    test("defaults non-numeric confidence to 0.5", () => {
      expect(normalizeResponse({ confidence: "high" }).confidence).toBe(0.5);
      expect(normalizeResponse({ confidence: null }).confidence).toBe(0.5);
      expect(normalizeResponse({}).confidence).toBe(0.5);
    });
  });

  describe("reasoning", () => {
    test("passes valid reasoning through", () => {
      const result = normalizeResponse({ reasoning: "Because of X and Y" });
      expect(result.reasoning).toBe("Because of X and Y");
    });

    test("defaults missing reasoning", () => {
      expect(normalizeResponse({}).reasoning).toBe("No reasoning provided");
    });

    test("converts non-string reasoning to string", () => {
      expect(normalizeResponse({ reasoning: 42 }).reasoning).toBe("42");
    });
  });

  describe("full response normalization", () => {
    test("normalizes a well-formed response correctly", () => {
      const result = normalizeResponse({
        risks: [{ description: "Champion left", severity: "high" }],
        nextSteps: [
          {
            action: "Reach out to new contact",
            priority: 1,
            rationale: "Need new champion",
          },
        ],
        confidence: 0.8,
        reasoning: "Champion departure is a major risk",
      });

      expect(result.risks).toHaveLength(1);
      expect(result.risks[0]!.description).toBe("Champion left");
      expect(result.risks[0]!.severity).toBe("high");
      expect(result.nextSteps).toHaveLength(1);
      expect(result.nextSteps[0]!.action).toBe("Reach out to new contact");
      expect(result.confidence).toBe(0.8);
      expect(result.reasoning).toBe("Champion departure is a major risk");
    });

    test("handles completely empty response", () => {
      const result = normalizeResponse({});

      expect(result.risks).toEqual([]);
      expect(result.nextSteps).toEqual([]);
      expect(result.confidence).toBe(0.5);
      expect(result.reasoning).toBe("No reasoning provided");
    });
  });
});

// ============================================================
// SECTION 2: Integration tests via handleBenchmarkStream
// ============================================================

// We need to mock the dependencies: evaluateResponse, saveBenchmarkRun,
// and the file system (loadDealsFromDir). We do this by mocking modules.

// Mock modules before importing handleBenchmarkStream
const mockEvaluateResponseMultiJudge = mock(
  async (
    _checkpoint: Checkpoint,
    _response: AgentResponse,
    _mode: "public" | "private"
  ) => ({
    checkpointId: _checkpoint.id,
    scores: {
      riskIdentification: 8,
      nextStepQuality: 7,
      prioritization: 6,
      outcomeAlignment: 9,
    } as EvaluationScores,
    totalScore: 30,
    maxScore: 40,
    feedback: "Good analysis overall",
    judgeEvaluations: [
      {
        judgeModel: "claude-4.5-opus",
        judgeName: "Claude 4.5 Opus",
        scores: { riskIdentification: 8, nextStepQuality: 7, prioritization: 6, outcomeAlignment: 9 },
        totalScore: 30,
        feedback: "Good analysis",
        risksIdentified: ["Budget risk"],
        risksMissed: [],
        helpfulRecommendations: ["Follow up"],
        unhelpfulRecommendations: [],
      },
    ],
  })
);

const mockSaveBenchmarkRun = mock(async () => 42);
const mockSaveJudgeEvaluation = mock(async () => 1);

const testDeps = {
  evaluateResponseMultiJudge: mockEvaluateResponseMultiJudge,
  saveBenchmarkRun: mockSaveBenchmarkRun,
  saveJudgeEvaluation: mockSaveJudgeEvaluation,
} as any;

// We need to mock fetch globally for callAgentEndpoint
const originalFetch = globalThis.fetch;

// Helper to collect all SSE events from a stream response
async function collectSSEEvents(
  response: Response
): Promise<Record<string, unknown>[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const events: Record<string, unknown>[] = [];
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Parse SSE events from buffer
    const parts = buffer.split("\n\n");
    // Keep the last incomplete part in the buffer
    buffer = parts.pop() || "";

    for (const part of parts) {
      const line = part.trim();
      if (line.startsWith("data: ")) {
        try {
          events.push(JSON.parse(line.slice(6)));
        } catch {
          // skip unparseable
        }
      }
    }
  }

  // Process any remaining buffer
  if (buffer.trim().startsWith("data: ")) {
    try {
      events.push(JSON.parse(buffer.trim().slice(6)));
    } catch {
      // skip
    }
  }

  return events;
}

describe("handleBenchmarkStream", () => {
  beforeEach(() => {
    mockEvaluateResponseMultiJudge.mockClear();
    mockSaveBenchmarkRun.mockClear();
    mockSaveJudgeEvaluation.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("request validation", () => {
    test("rejects non-POST methods with 405", async () => {
      const req = new Request("http://localhost/api/benchmark/stream", {
        method: "GET",
      });
      const res = await handleBenchmarkStream(req, testDeps);

      expect(res.status).toBe(405);
      const body = await res.json();
      expect(body.error).toBe("Method not allowed");
    });

    test("rejects invalid JSON body with 400", async () => {
      const req = new Request("http://localhost/api/benchmark/stream", {
        method: "POST",
        body: "not json",
        headers: { "Content-Type": "application/json" },
      });
      const res = await handleBenchmarkStream(req, testDeps);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid JSON body");
    });

    test("rejects missing endpoint with 400", async () => {
      const req = new Request("http://localhost/api/benchmark/stream", {
        method: "POST",
        body: JSON.stringify({ agentName: "Test Agent" }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await handleBenchmarkStream(req, testDeps);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("endpoint is required");
    });

    test("rejects empty endpoint with 400", async () => {
      const req = new Request("http://localhost/api/benchmark/stream", {
        method: "POST",
        body: JSON.stringify({ endpoint: "", agentName: "Test Agent" }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await handleBenchmarkStream(req, testDeps);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("endpoint is required");
    });
  });

  describe("SSE response format", () => {
    test("returns correct SSE headers", async () => {
      // Mock fetch for the agent endpoint
      globalThis.fetch = mock(async () =>
        Response.json({
          risks: [{ description: "Risk", severity: "high" }],
          nextSteps: [{ action: "Act", priority: 1 }],
          confidence: 0.8,
          reasoning: "Test reasoning",
        })
      ) as typeof fetch;

      const req = new Request("http://localhost/api/benchmark/stream", {
        method: "POST",
        body: JSON.stringify({
          endpoint: "https://test-agent.example.com/api",
          agentName: "Test Agent",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await handleBenchmarkStream(req, testDeps);

      expect(res.headers.get("Content-Type")).toBe("text/event-stream");
      expect(res.headers.get("Cache-Control")).toBe("no-cache");
      expect(res.headers.get("Connection")).toBe("keep-alive");
    });

    test("returns a ReadableStream body", async () => {
      globalThis.fetch = mock(async () =>
        Response.json({
          risks: [],
          nextSteps: [],
          confidence: 0.5,
          reasoning: "ok",
        })
      ) as typeof fetch;

      const req = new Request("http://localhost/api/benchmark/stream", {
        method: "POST",
        body: JSON.stringify({
          endpoint: "https://test-agent.example.com/api",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await handleBenchmarkStream(req, testDeps);

      expect(res.body).toBeInstanceOf(ReadableStream);
    });

    test("SSE events are formatted as 'data: {...}\\n\\n'", async () => {
      globalThis.fetch = mock(async () =>
        Response.json({
          risks: [{ description: "Risk", severity: "high" }],
          nextSteps: [{ action: "Act", priority: 1 }],
          confidence: 0.9,
          reasoning: "Reasoning",
        })
      ) as typeof fetch;

      const req = new Request("http://localhost/api/benchmark/stream", {
        method: "POST",
        body: JSON.stringify({
          endpoint: "https://test-agent.example.com/api",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await handleBenchmarkStream(req, testDeps);
      const events = await collectSSEEvents(res);

      // Should have checkpoint events + a complete event
      expect(events.length).toBeGreaterThanOrEqual(1);

      // Last event should be "complete"
      const lastEvent = events[events.length - 1];
      expect(lastEvent!.type).toBe("complete");
    });

    test("checkpoint events include expected fields", async () => {
      globalThis.fetch = mock(async () =>
        Response.json({
          risks: [{ description: "Risk", severity: "high" }],
          nextSteps: [{ action: "Act", priority: 1 }],
          confidence: 0.9,
          reasoning: "Reasoning",
        })
      ) as typeof fetch;

      const req = new Request("http://localhost/api/benchmark/stream", {
        method: "POST",
        body: JSON.stringify({
          endpoint: "https://test-agent.example.com/api",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await handleBenchmarkStream(req, testDeps);
      const events = await collectSSEEvents(res);

      // Find a checkpoint event
      const checkpointEvent = events.find((e) => e.type === "checkpoint");
      if (checkpointEvent) {
        expect(checkpointEvent.type).toBe("checkpoint");
        expect(checkpointEvent).toHaveProperty("checkpointId");
        expect(checkpointEvent).toHaveProperty("dealId");
        expect(checkpointEvent).toHaveProperty("dealName");
        expect(checkpointEvent).toHaveProperty("mode");
        expect(checkpointEvent).toHaveProperty("score");
        expect(checkpointEvent).toHaveProperty("maxScore");
        expect(checkpointEvent).toHaveProperty("scores");
        expect(checkpointEvent).toHaveProperty("progress");

        const progress = checkpointEvent.progress as {
          completed: number;
          total: number;
        };
        expect(progress).toHaveProperty("completed");
        expect(progress).toHaveProperty("total");
      }
    });

    test("complete event includes final scores", async () => {
      globalThis.fetch = mock(async () =>
        Response.json({
          risks: [],
          nextSteps: [],
          confidence: 0.5,
          reasoning: "ok",
        })
      ) as typeof fetch;

      const req = new Request("http://localhost/api/benchmark/stream", {
        method: "POST",
        body: JSON.stringify({
          endpoint: "https://test-agent.example.com/api",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await handleBenchmarkStream(req, testDeps);
      const events = await collectSSEEvents(res);

      const completeEvent = events.find((e) => e.type === "complete");
      expect(completeEvent).toBeDefined();
      expect(completeEvent).toHaveProperty("finalScore");
      expect(completeEvent).toHaveProperty("maxScore");
      expect(completeEvent).toHaveProperty("percentage");
      expect(completeEvent).toHaveProperty("avgLatencyMs");
      expect(completeEvent).toHaveProperty("scores");
    });
  });

  describe("agent endpoint error handling", () => {
    test("handles agent returning non-ok status", async () => {
      globalThis.fetch = mock(
        async () => new Response("Internal Server Error", { status: 500 })
      ) as typeof fetch;

      const req = new Request("http://localhost/api/benchmark/stream", {
        method: "POST",
        body: JSON.stringify({
          endpoint: "https://test-agent.example.com/api",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await handleBenchmarkStream(req, testDeps);
      const events = await collectSSEEvents(res);

      // Should still get checkpoint events (with error) and complete
      const checkpointEvents = events.filter((e) => e.type === "checkpoint");
      for (const cp of checkpointEvents) {
        expect(cp.error).toBe(true);
        expect(cp.score).toBe(0);
      }

      const completeEvent = events.find((e) => e.type === "complete");
      expect(completeEvent).toBeDefined();
    });

    test("handles fetch throwing an error (network failure)", async () => {
      globalThis.fetch = mock(async () => {
        throw new Error("Network error: connection refused");
      }) as typeof fetch;

      const req = new Request("http://localhost/api/benchmark/stream", {
        method: "POST",
        body: JSON.stringify({
          endpoint: "https://unreachable.example.com/api",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await handleBenchmarkStream(req, testDeps);
      const events = await collectSSEEvents(res);

      const checkpointEvents = events.filter((e) => e.type === "checkpoint");
      for (const cp of checkpointEvents) {
        expect(cp.error).toBe(true);
        expect(cp.score).toBe(0);
        expect(cp.maxScore).toBe(40);
      }
    });

    test("public mode checkpoint errors include error message in feedback", async () => {
      globalThis.fetch = mock(async () => {
        throw new Error("Connection timed out");
      }) as typeof fetch;

      const req = new Request("http://localhost/api/benchmark/stream", {
        method: "POST",
        body: JSON.stringify({
          endpoint: "https://slow-agent.example.com/api",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await handleBenchmarkStream(req, testDeps);
      const events = await collectSSEEvents(res);

      // Public checkpoint events should have error feedback
      const publicCheckpoints = events.filter(
        (e) => e.type === "checkpoint" && e.mode === "public"
      );
      for (const cp of publicCheckpoints) {
        expect(cp.feedback).toContain("Error:");
        expect(cp.feedback).toContain("Connection timed out");
      }
    });

    test("private mode checkpoint errors have null feedback", async () => {
      globalThis.fetch = mock(async () => {
        throw new Error("Some error");
      }) as typeof fetch;

      const req = new Request("http://localhost/api/benchmark/stream", {
        method: "POST",
        body: JSON.stringify({
          endpoint: "https://test-agent.example.com/api",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await handleBenchmarkStream(req, testDeps);
      const events = await collectSSEEvents(res);

      const privateCheckpoints = events.filter(
        (e) => e.type === "checkpoint" && e.mode === "private"
      );
      for (const cp of privateCheckpoints) {
        expect(cp.feedback).toBeNull();
      }
    });
  });

  describe("public vs private mode", () => {
    test("public checkpoints include feedback, private do not", async () => {
      globalThis.fetch = mock(async () =>
        Response.json({
          risks: [{ description: "Risk", severity: "high" }],
          nextSteps: [{ action: "Act", priority: 1 }],
          confidence: 0.9,
          reasoning: "OK",
        })
      ) as typeof fetch;

      const req = new Request("http://localhost/api/benchmark/stream", {
        method: "POST",
        body: JSON.stringify({
          endpoint: "https://test-agent.example.com/api",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await handleBenchmarkStream(req, testDeps);
      const events = await collectSSEEvents(res);

      const publicCheckpoints = events.filter(
        (e) => e.type === "checkpoint" && e.mode === "public"
      );
      const privateCheckpoints = events.filter(
        (e) => e.type === "checkpoint" && e.mode === "private"
      );

      for (const cp of publicCheckpoints) {
        expect(cp.feedback).not.toBeNull();
      }
      for (const cp of privateCheckpoints) {
        expect(cp.feedback).toBeNull();
      }
    });
  });

  describe("progress tracking", () => {
    test("progress completed increments with each checkpoint", async () => {
      globalThis.fetch = mock(async () =>
        Response.json({
          risks: [],
          nextSteps: [],
          confidence: 0.5,
          reasoning: "ok",
        })
      ) as typeof fetch;

      const req = new Request("http://localhost/api/benchmark/stream", {
        method: "POST",
        body: JSON.stringify({
          endpoint: "https://test-agent.example.com/api",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await handleBenchmarkStream(req, testDeps);
      const events = await collectSSEEvents(res);

      const checkpointEvents = events.filter((e) => e.type === "checkpoint");
      if (checkpointEvents.length > 1) {
        const completedValues = checkpointEvents.map(
          (e) => (e.progress as { completed: number }).completed
        );
        // Verify that completed values are strictly increasing
        for (let i = 1; i < completedValues.length; i++) {
          expect(completedValues[i]).toBeGreaterThan(completedValues[i - 1]!);
        }
      }

      // Total in all progress objects should be the same
      const totals = checkpointEvents.map(
        (e) => (e.progress as { total: number }).total
      );
      const uniqueTotals = new Set(totals);
      expect(uniqueTotals.size).toBe(1);
    });

    test("final checkpoint has completed equal to total", async () => {
      globalThis.fetch = mock(async () =>
        Response.json({
          risks: [],
          nextSteps: [],
          confidence: 0.5,
          reasoning: "ok",
        })
      ) as typeof fetch;

      const req = new Request("http://localhost/api/benchmark/stream", {
        method: "POST",
        body: JSON.stringify({
          endpoint: "https://test-agent.example.com/api",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await handleBenchmarkStream(req, testDeps);
      const events = await collectSSEEvents(res);

      const checkpointEvents = events.filter((e) => e.type === "checkpoint");
      if (checkpointEvents.length > 0) {
        const lastCheckpoint = checkpointEvents[checkpointEvents.length - 1]!;
        const progress = lastCheckpoint.progress as {
          completed: number;
          total: number;
        };
        expect(progress.completed).toBe(progress.total);
      }
    });
  });

  describe("database save", () => {
    test("calls saveBenchmarkRun on successful completion", async () => {
      globalThis.fetch = mock(async () =>
        Response.json({
          risks: [{ description: "Risk", severity: "high" }],
          nextSteps: [{ action: "Act", priority: 1 }],
          confidence: 0.9,
          reasoning: "ok",
        })
      ) as typeof fetch;

      const req = new Request("http://localhost/api/benchmark/stream", {
        method: "POST",
        body: JSON.stringify({
          endpoint: "https://test-agent.example.com/api",
          agentName: "My Agent",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await handleBenchmarkStream(req, testDeps);
      // Must consume the stream to trigger all processing
      await collectSSEEvents(res);

      expect(mockSaveBenchmarkRun).toHaveBeenCalled();

      // Verify the argument structure
      const callArgs = mockSaveBenchmarkRun.mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      expect(callArgs).toHaveProperty("agentId");
      expect(callArgs).toHaveProperty("agentEndpoint");
      expect(callArgs.agentEndpoint).toBe(
        "https://test-agent.example.com/api"
      );
      expect(callArgs).toHaveProperty("mode", "public");
      expect(callArgs).toHaveProperty("scores");
    });

    test("complete event includes runId from saveBenchmarkRun", async () => {
      mockSaveBenchmarkRun.mockImplementation(async () => 123);

      globalThis.fetch = mock(async () =>
        Response.json({
          risks: [],
          nextSteps: [],
          confidence: 0.5,
          reasoning: "ok",
        })
      ) as typeof fetch;

      const req = new Request("http://localhost/api/benchmark/stream", {
        method: "POST",
        body: JSON.stringify({
          endpoint: "https://test-agent.example.com/api",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await handleBenchmarkStream(req, testDeps);
      const events = await collectSSEEvents(res);

      const completeEvent = events.find((e) => e.type === "complete");
      expect(completeEvent!.runId).toBe(123);
    });

    test("handles saveBenchmarkRun failure gracefully", async () => {
      mockSaveBenchmarkRun.mockImplementation(async () => {
        throw new Error("DB connection failed");
      });

      globalThis.fetch = mock(async () =>
        Response.json({
          risks: [],
          nextSteps: [],
          confidence: 0.5,
          reasoning: "ok",
        })
      ) as typeof fetch;

      const req = new Request("http://localhost/api/benchmark/stream", {
        method: "POST",
        body: JSON.stringify({
          endpoint: "https://test-agent.example.com/api",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await handleBenchmarkStream(req, testDeps);
      const events = await collectSSEEvents(res);

      // Should still complete (runId will be null)
      const completeEvent = events.find((e) => e.type === "complete");
      expect(completeEvent).toBeDefined();
      expect(completeEvent!.type).toBe("complete");
      expect(completeEvent!.runId).toBeNull();
    });
  });

  describe("score aggregation", () => {
    test("complete event percentage is calculated correctly", async () => {
      // Set up evaluate to return known scores
      mockEvaluateResponseMultiJudge.mockImplementation(async (checkpoint) => ({
        checkpointId: checkpoint.id,
        scores: {
          riskIdentification: 5,
          nextStepQuality: 5,
          prioritization: 5,
          outcomeAlignment: 5,
        },
        totalScore: 20,
        maxScore: 40,
        feedback: "Average",
        judgeEvaluations: [],
      }));

      globalThis.fetch = mock(async () =>
        Response.json({
          risks: [],
          nextSteps: [],
          confidence: 0.5,
          reasoning: "ok",
        })
      ) as typeof fetch;

      const req = new Request("http://localhost/api/benchmark/stream", {
        method: "POST",
        body: JSON.stringify({
          endpoint: "https://test-agent.example.com/api",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await handleBenchmarkStream(req, testDeps);
      const events = await collectSSEEvents(res);

      const completeEvent = events.find((e) => e.type === "complete");
      expect(completeEvent).toBeDefined();

      // Percentage should be totalScore/maxScore * 100
      const percentage = completeEvent!.percentage as number;
      const finalScore = completeEvent!.finalScore as number;
      const maxScore = completeEvent!.maxScore as number;

      if (maxScore > 0) {
        expect(percentage).toBe(Math.round((finalScore / maxScore) * 100));
      }
    });
  });
});
