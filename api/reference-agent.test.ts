import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import type { AgentRequest } from "../src/types/benchmark";
import { handleReferenceAgent } from "./reference-agent";

// ============================================================================
// Test Setup
// ============================================================================

// Define test BENCHMARK_MODELS (matching the shape from scripts/benchmark-models.ts)
const TEST_BENCHMARK_MODELS = [
  {
    id: "gpt-5.2",
    name: "GPT-5.2",
    openrouterId: "openai/gpt-5.2-20251211",
    tier: "frontier",
  },
  {
    id: "claude-4.6-opus",
    name: "Claude Opus 4.6",
    openrouterId: "anthropic/claude-opus-4-6",
    tier: "frontier",
  },
  {
    id: "claude-4.5-sonnet",
    name: "Claude 4.5 Sonnet",
    openrouterId: "anthropic/claude-4.5-sonnet-20250929",
    tier: "frontier",
  },
  {
    id: "gemini-3-flash",
    name: "Gemini 3 Flash Preview",
    openrouterId: "google/gemini-3-flash-preview-20251217",
    tier: "fast",
  },
  {
    id: "deepseek-v3.2",
    name: "DeepSeek V3.2",
    openrouterId: "deepseek/deepseek-v3.2-20251201",
    tier: "value",
  },
] as const;

// Mock generateText from "ai"
const mockGenerateText = mock(() =>
  Promise.resolve({
    text: JSON.stringify({
      risks: [
        { description: "Budget not approved", severity: "high" },
        { description: "Champion leaving", severity: "medium" },
      ],
      nextSteps: [
        { action: "Schedule exec meeting", priority: 1, rationale: "Need sign-off" },
      ],
      confidence: 0.7,
      reasoning: "Deal is progressing but has budget risks.",
    }),
  })
);

const testDeps = {
  generateText: mockGenerateText,
  openrouter: (modelId: string) => ({ modelId }),
  benchmarkModels: TEST_BENCHMARK_MODELS,
} as any;

// Use the test models for assertions
const BENCHMARK_MODELS = TEST_BENCHMARK_MODELS;

// ============================================================================
// Test Helpers
// ============================================================================

function makeMinimalDealContext() {
  return {
    company: "Acme Corp",
    stage: "Negotiation",
    lastInteraction: "Demo call went well",
    painPoints: ["Slow onboarding", "High churn"],
    stakeholders: [
      { name: "Jane Doe", role: "champion", sentiment: "positive" },
    ],
    history: "Started 3 months ago",
  };
}

function makeFullDealContext() {
  return {
    company: "MegaCorp",
    stage: "Discovery",
    amount: "$500,000",
    closeDate: "2026-03-15",
    timeline: "Q1 2026",
    lastInteraction: "Technical deep dive",
    painPoints: ["Manual reporting", "Data silos", "Compliance risk"],
    stakeholders: [
      {
        name: "Alice Smith",
        role: "champion",
        title: "VP Engineering",
        sentiment: "positive",
        notes: "Strong internal advocate",
      },
      {
        name: "Bob Jones",
        role: "economic_buyer",
        title: "CFO",
        sentiment: "neutral",
      },
    ],
    hypothesis: {
      whyTheyWillBuy: ["Clear ROI", "Executive sponsorship"],
      whyTheyMightNot: ["Budget freeze", "Competing priorities"],
      whatNeedsToBeTrue: ["Budget approval by Q1"],
    },
    meddpicc: {
      metrics: { status: "identified", notes: "30% reduction in manual work" },
      economicBuyer: { status: "engaged", notes: "CFO aware but not committed" },
      decisionCriteria: { status: "defined", notes: "Integration, scale, security" },
      decisionProcess: { status: "mapped", notes: "Board approval needed" },
      paperProcess: { status: "unknown", notes: "Need to clarify procurement" },
      pain: { status: "confirmed", notes: "Compliance audit failed last quarter" },
      champion: { status: "strong", notes: "VP Engineering driving internally" },
      competition: { status: "identified", notes: "Incumbent vendor at risk" },
    },
    history: "First contact in October. Demo in November.",
  };
}

function makeRequest(
  modelId: string,
  overrides: Record<string, unknown> = {}
): Request {
  const body = {
    checkpoint_id: "cp-001",
    deal_context: makeMinimalDealContext(),
    question: "What are the key risks?",
    ...overrides,
  };

  return new Request(`http://localhost/api/reference-agent/${modelId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ============================================================================
// Tests: Model Lookup
// ============================================================================

describe("reference-agent: model lookup", () => {
  test("finds a valid model ID from BENCHMARK_MODELS", () => {
    const first = BENCHMARK_MODELS[0];
    const found = BENCHMARK_MODELS.find((m) => m.id === first.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(first.id);
  });

  test("all BENCHMARK_MODELS have required fields", () => {
    for (const model of BENCHMARK_MODELS) {
      expect(model.id).toBeString();
      expect(model.name).toBeString();
      expect(model.openrouterId).toBeString();
      expect(model.tier).toBeString();
      expect(model.id.length).toBeGreaterThan(0);
    }
  });

  test("model IDs are unique", () => {
    const ids = BENCHMARK_MODELS.map((m) => m.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  test("returns undefined for invalid model ID", () => {
    const found = BENCHMARK_MODELS.find((m) => m.id === "nonexistent-model");
    expect(found).toBeUndefined();
  });
});

// ============================================================================
// Tests: Deal Context Prompt Building
// ============================================================================

describe("reference-agent: buildDealContextPrompt (via handler)", () => {
  const originalEnv = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key";
    mockGenerateText.mockClear();
  });

  afterEach(() => {
    process.env.OPENROUTER_API_KEY = originalEnv;
  });

  test("builds prompt with minimal deal context", async () => {
    const validModelId = BENCHMARK_MODELS[0].id;
    const req = makeRequest(validModelId);

    await handleReferenceAgent(req, testDeps);

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    const callArgs = mockGenerateText.mock.calls[0][0] as {
      system: string;
      prompt: string;
    };

    expect(callArgs.prompt).toContain("## Deal: Acme Corp");
    expect(callArgs.prompt).toContain("**Stage:** Negotiation");
    expect(callArgs.prompt).toContain("**Last Interaction:** Demo call went well");
    expect(callArgs.prompt).toContain("- Slow onboarding");
    expect(callArgs.prompt).toContain("- High churn");
    expect(callArgs.prompt).toContain("Jane Doe");
    expect(callArgs.prompt).toContain("What are the key risks?");
    expect(callArgs.system).toContain("expert sales analyst");
  });

  test("builds prompt with all optional fields", async () => {
    const validModelId = BENCHMARK_MODELS[0].id;
    const req = makeRequest(validModelId, {
      deal_context: makeFullDealContext(),
    });

    await handleReferenceAgent(req, testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      prompt: string;
    };

    expect(callArgs.prompt).toContain("**Deal Size:** $500,000");
    expect(callArgs.prompt).toContain("**Target Close:** 2026-03-15");
    expect(callArgs.prompt).toContain("**Timeline:** Q1 2026");
    expect(callArgs.prompt).toContain("### Hypothesis:");
    expect(callArgs.prompt).toContain("**Why they'll buy:**");
    expect(callArgs.prompt).toContain("- Clear ROI");
    expect(callArgs.prompt).toContain("**Why they might not:**");
    expect(callArgs.prompt).toContain("- Budget freeze");
    expect(callArgs.prompt).toContain("### MEDDPICC Status:");
    expect(callArgs.prompt).toContain("**Metrics:** identified");
    expect(callArgs.prompt).toContain("**Economic Buyer:** engaged");
    expect(callArgs.prompt).toContain("**Champion:** strong");
    expect(callArgs.prompt).toContain("**Competition:** identified");
    expect(callArgs.prompt).toContain("### Deal History:");
  });

  test("handles empty hypothesis arrays", async () => {
    const validModelId = BENCHMARK_MODELS[0].id;
    const ctx = makeMinimalDealContext() as Record<string, unknown>;
    ctx.hypothesis = {
      whyTheyWillBuy: [],
      whyTheyMightNot: [],
      whatNeedsToBeTrue: [],
    };

    const req = makeRequest(validModelId, { deal_context: ctx });

    await handleReferenceAgent(req, testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      prompt: string;
    };

    // Hypothesis section exists but no buy/not reasons listed
    expect(callArgs.prompt).toContain("### Hypothesis:");
    expect(callArgs.prompt).not.toContain("**Why they'll buy:**");
    expect(callArgs.prompt).not.toContain("**Why they might not:**");
  });

  test("handles missing optional fields (amount, closeDate, timeline)", async () => {
    const validModelId = BENCHMARK_MODELS[0].id;
    const req = makeRequest(validModelId);

    await handleReferenceAgent(req, testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      prompt: string;
    };

    // These should NOT appear since the minimal context lacks them
    expect(callArgs.prompt).not.toContain("**Deal Size:**");
    expect(callArgs.prompt).not.toContain("**Target Close:**");
    expect(callArgs.prompt).not.toContain("**Timeline:**");
  });

  test("stakeholder with all fields renders correctly", async () => {
    const validModelId = BENCHMARK_MODELS[0].id;
    const ctx = makeMinimalDealContext() as Record<string, unknown>;
    ctx.stakeholders = [
      {
        name: "John Smith",
        role: "decision_maker",
        title: "CTO",
        sentiment: "negative",
        notes: "Prefers competitor",
      },
    ];

    const req = makeRequest(validModelId, { deal_context: ctx });

    await handleReferenceAgent(req, testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      prompt: string;
    };

    expect(callArgs.prompt).toContain("**John Smith** (decision_maker, CTO)");
    expect(callArgs.prompt).toContain("negative sentiment");
    expect(callArgs.prompt).toContain("Prefers competitor");
  });

  test("stakeholder without optional title/notes renders correctly", async () => {
    const validModelId = BENCHMARK_MODELS[0].id;
    const ctx = makeMinimalDealContext() as Record<string, unknown>;
    ctx.stakeholders = [
      {
        name: "Minimal Person",
        role: "influencer",
      },
    ];

    const req = makeRequest(validModelId, { deal_context: ctx });

    await handleReferenceAgent(req, testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      prompt: string;
    };

    expect(callArgs.prompt).toContain("**Minimal Person** (influencer)");
    expect(callArgs.prompt).toContain("unknown sentiment");
    expect(callArgs.prompt).not.toContain("undefined");
  });
});

// ============================================================================
// Tests: Request Handler
// ============================================================================

describe("reference-agent: handleReferenceAgent", () => {
  const originalEnv = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key";
    mockGenerateText.mockClear();
  });

  afterEach(() => {
    process.env.OPENROUTER_API_KEY = originalEnv;
  });

  test("returns 405 for non-POST requests", async () => {
    const req = new Request("http://localhost/api/reference-agent/gpt-5.2", {
      method: "GET",
    });
    const res = await handleReferenceAgent(req, testDeps);
    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body.error).toContain("Method not allowed");
  });

  test("returns 404 for invalid model ID", async () => {
    const req = makeRequest("nonexistent-model-xyz");
    const res = await handleReferenceAgent(req, testDeps);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("not found");
    expect(body.error).toContain("Available models:");
  });

  test("returns 500 when OPENROUTER_API_KEY is not set", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const validModelId = BENCHMARK_MODELS[0].id;
    const req = makeRequest(validModelId);
    const res = await handleReferenceAgent(req, testDeps);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("OPENROUTER_API_KEY");
  });

  test("returns 400 when checkpoint_id is missing", async () => {
    const validModelId = BENCHMARK_MODELS[0].id;
    const req = makeRequest(validModelId, {
      checkpoint_id: undefined,
      checkpointId: undefined,
    });
    // Rebuild request without checkpoint_id
    const body = {
      deal_context: makeMinimalDealContext(),
      question: "Test question",
    };
    const request = new Request(
      `http://localhost/api/reference-agent/${validModelId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    const res = await handleReferenceAgent(request, testDeps);
    expect(res.status).toBe(400);
    const responseBody = await res.json();
    expect(responseBody.error).toContain("checkpoint_id is required");
  });

  test("returns 400 when deal_context is missing", async () => {
    const validModelId = BENCHMARK_MODELS[0].id;
    const body = {
      checkpoint_id: "cp-001",
      question: "Test question",
    };
    const request = new Request(
      `http://localhost/api/reference-agent/${validModelId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    const res = await handleReferenceAgent(request, testDeps);
    expect(res.status).toBe(400);
    const responseBody = await res.json();
    expect(responseBody.error).toContain("deal_context is required");
  });

  test("successful request returns parsed response with model info", async () => {
    const validModelId = BENCHMARK_MODELS[0].id;
    const validModelName = BENCHMARK_MODELS[0].name;
    const req = makeRequest(validModelId);

    const res = await handleReferenceAgent(req, testDeps);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.model).toBe(validModelId);
    expect(body.model_name).toBe(validModelName);
    expect(body.risks).toBeArray();
    expect(body.risks.length).toBe(2);
    expect(body.risks[0].description).toBe("Budget not approved");
    expect(body.risks[0].severity).toBe("high");
    expect(body.next_steps).toBeArray();
    expect(body.next_steps[0].action).toBe("Schedule exec meeting");
    expect(body.confidence).toBe(0.7);
    expect(body.reasoning).toBe("Deal is progressing but has budget risks.");
  });

  test("response uses snake_case for API compatibility", async () => {
    const validModelId = BENCHMARK_MODELS[0].id;
    const req = makeRequest(validModelId);
    const res = await handleReferenceAgent(req, testDeps);
    const body = await res.json();

    // Should have snake_case keys
    expect(body).toHaveProperty("next_steps");
    expect(body).toHaveProperty("model_name");
    // Should NOT have camelCase keys at top level
    expect(body).not.toHaveProperty("nextSteps");
    expect(body).not.toHaveProperty("modelName");
  });

  test("uses default question when none provided", async () => {
    const validModelId = BENCHMARK_MODELS[0].id;
    const body = {
      checkpoint_id: "cp-001",
      deal_context: makeMinimalDealContext(),
      // No question field
    };
    const request = new Request(
      `http://localhost/api/reference-agent/${validModelId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    await handleReferenceAgent(request, testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      prompt: string;
    };
    expect(callArgs.prompt).toContain(
      "What are the top risks and recommended next steps?"
    );
  });

  test("returns error response when API call fails", async () => {
    mockGenerateText.mockImplementationOnce(() =>
      Promise.reject(new Error("API rate limited"))
    );

    const validModelId = BENCHMARK_MODELS[0].id;
    const req = makeRequest(validModelId);

    const res = await handleReferenceAgent(req, testDeps);
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.model).toBe(validModelId);
    expect(body.risks).toBeArray();
    expect(body.risks[0].severity).toBe("high");
    expect(body.next_steps).toBeArray();
    expect(body.confidence).toBe(0);
    expect(body.reasoning).toContain("API rate limited");
  });

  test("handles response with no JSON in model output", async () => {
    mockGenerateText.mockImplementationOnce(() =>
      Promise.resolve({ text: "I cannot analyze this deal right now." })
    );

    const validModelId = BENCHMARK_MODELS[0].id;
    const req = makeRequest(validModelId);

    const res = await handleReferenceAgent(req, testDeps);
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.reasoning).toContain("No JSON found");
  });
});

// ============================================================================
// Tests: Snake_case vs CamelCase Request Format
// ============================================================================

describe("reference-agent: snake_case vs camelCase handling", () => {
  const originalEnv = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key";
    mockGenerateText.mockClear();
  });

  afterEach(() => {
    process.env.OPENROUTER_API_KEY = originalEnv;
  });

  test("accepts snake_case format (checkpoint_id, deal_context)", async () => {
    const validModelId = BENCHMARK_MODELS[0].id;
    const body = {
      checkpoint_id: "cp-snake",
      deal_context: makeMinimalDealContext(),
      question: "Snake test",
    };
    const request = new Request(
      `http://localhost/api/reference-agent/${validModelId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    const res = await handleReferenceAgent(request, testDeps);
    expect(res.status).toBe(200);
  });

  test("accepts camelCase format (checkpointId, dealContext)", async () => {
    const validModelId = BENCHMARK_MODELS[0].id;
    const body = {
      checkpointId: "cp-camel",
      dealContext: makeMinimalDealContext(),
      question: "Camel test",
    };
    const request = new Request(
      `http://localhost/api/reference-agent/${validModelId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    const res = await handleReferenceAgent(request, testDeps);
    expect(res.status).toBe(200);
  });

  test("normalizes snake_case deal context fields to camelCase", async () => {
    const validModelId = BENCHMARK_MODELS[0].id;
    const body = {
      checkpoint_id: "cp-norm",
      deal_context: {
        company: "SnakeCo",
        stage: "Discovery",
        close_date: "2026-06-01",
        last_interaction: "Initial call",
        pain_points: ["Latency issues"],
        stakeholders: [{ name: "Test", role: "champion" }],
        history: "New deal",
      },
      question: "Normalize test",
    };
    const request = new Request(
      `http://localhost/api/reference-agent/${validModelId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    await handleReferenceAgent(request, testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      prompt: string;
    };

    expect(callArgs.prompt).toContain("**Target Close:** 2026-06-01");
    expect(callArgs.prompt).toContain("**Last Interaction:** Initial call");
    expect(callArgs.prompt).toContain("- Latency issues");
  });

  test("prefers snake_case over camelCase when both provided", async () => {
    const validModelId = BENCHMARK_MODELS[0].id;
    const body = {
      checkpoint_id: "cp-prefer",
      checkpointId: "cp-ignored",
      deal_context: {
        company: "PriorityCo",
        stage: "Negotiation",
        close_date: "2026-01-01",
        closeDate: "2026-12-31",
        last_interaction: "Snake wins",
        lastInteraction: "Camel loses",
        pain_points: ["Snake pain"],
        painPoints: ["Camel pain"],
        stakeholders: [],
        history: "Test",
      },
      question: "Priority test",
    };
    const request = new Request(
      `http://localhost/api/reference-agent/${validModelId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    await handleReferenceAgent(request, testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      prompt: string;
    };

    // The code uses `rawContext.close_date || rawContext.closeDate`
    // so snake_case takes priority
    expect(callArgs.prompt).toContain("**Target Close:** 2026-01-01");
    expect(callArgs.prompt).toContain("**Last Interaction:** Snake wins");
    expect(callArgs.prompt).toContain("- Snake pain");
  });
});

// ============================================================================
// Tests: Response Parsing and Normalization
// ============================================================================

describe("reference-agent: response parsing", () => {
  const originalEnv = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key";
    mockGenerateText.mockClear();
  });

  afterEach(() => {
    process.env.OPENROUTER_API_KEY = originalEnv;
  });

  test("normalizes invalid severity to medium", async () => {
    mockGenerateText.mockImplementationOnce(() =>
      Promise.resolve({
        text: JSON.stringify({
          risks: [{ description: "Bad risk", severity: "critical" }],
          nextSteps: [],
          confidence: 0.5,
          reasoning: "Test",
        }),
      })
    );

    const validModelId = BENCHMARK_MODELS[0].id;
    const req = makeRequest(validModelId);
    const res = await handleReferenceAgent(req, testDeps);
    const body = await res.json();

    expect(body.risks[0].severity).toBe("medium");
  });

  test("clamps confidence to 0-1 range", async () => {
    mockGenerateText.mockImplementationOnce(() =>
      Promise.resolve({
        text: JSON.stringify({
          risks: [],
          nextSteps: [],
          confidence: 1.5,
          reasoning: "Over-confident",
        }),
      })
    );

    const validModelId = BENCHMARK_MODELS[0].id;
    const req = makeRequest(validModelId);
    const res = await handleReferenceAgent(req, testDeps);
    const body = await res.json();

    expect(body.confidence).toBe(1.0);
  });

  test("clamps negative confidence to 0", async () => {
    mockGenerateText.mockImplementationOnce(() =>
      Promise.resolve({
        text: JSON.stringify({
          risks: [],
          nextSteps: [],
          confidence: -0.5,
          reasoning: "Negative",
        }),
      })
    );

    const validModelId = BENCHMARK_MODELS[0].id;
    const req = makeRequest(validModelId);
    const res = await handleReferenceAgent(req, testDeps);
    const body = await res.json();

    expect(body.confidence).toBe(0);
  });

  test("defaults confidence to 0.5 when not a number", async () => {
    mockGenerateText.mockImplementationOnce(() =>
      Promise.resolve({
        text: JSON.stringify({
          risks: [],
          nextSteps: [],
          confidence: "high",
          reasoning: "String confidence",
        }),
      })
    );

    const validModelId = BENCHMARK_MODELS[0].id;
    const req = makeRequest(validModelId);
    const res = await handleReferenceAgent(req, testDeps);
    const body = await res.json();

    expect(body.confidence).toBe(0.5);
  });

  test("handles next_steps (snake_case) from model response", async () => {
    mockGenerateText.mockImplementationOnce(() =>
      Promise.resolve({
        text: JSON.stringify({
          risks: [],
          next_steps: [
            { action: "Call stakeholder", priority: 1 },
            { action: "Send proposal", priority: 2 },
          ],
          confidence: 0.6,
          reasoning: "Snake case steps",
        }),
      })
    );

    const validModelId = BENCHMARK_MODELS[0].id;
    const req = makeRequest(validModelId);
    const res = await handleReferenceAgent(req, testDeps);
    const body = await res.json();

    expect(body.next_steps.length).toBe(2);
    expect(body.next_steps[0].action).toBe("Call stakeholder");
  });

  test("assigns sequential priorities when not provided", async () => {
    mockGenerateText.mockImplementationOnce(() =>
      Promise.resolve({
        text: JSON.stringify({
          risks: [],
          nextSteps: [
            { action: "First" },
            { action: "Second" },
            { action: "Third" },
          ],
          confidence: 0.5,
          reasoning: "No priorities",
        }),
      })
    );

    const validModelId = BENCHMARK_MODELS[0].id;
    const req = makeRequest(validModelId);
    const res = await handleReferenceAgent(req, testDeps);
    const body = await res.json();

    expect(body.next_steps[0].priority).toBe(1);
    expect(body.next_steps[1].priority).toBe(2);
    expect(body.next_steps[2].priority).toBe(3);
  });

  test("defaults missing description to 'Unknown risk'", async () => {
    mockGenerateText.mockImplementationOnce(() =>
      Promise.resolve({
        text: JSON.stringify({
          risks: [{ severity: "high" }],
          nextSteps: [],
          confidence: 0.5,
          reasoning: "Missing descriptions",
        }),
      })
    );

    const validModelId = BENCHMARK_MODELS[0].id;
    const req = makeRequest(validModelId);
    const res = await handleReferenceAgent(req, testDeps);
    const body = await res.json();

    expect(body.risks[0].description).toBe("Unknown risk");
  });

  test("defaults missing action to 'No action specified'", async () => {
    mockGenerateText.mockImplementationOnce(() =>
      Promise.resolve({
        text: JSON.stringify({
          risks: [],
          nextSteps: [{ priority: 1 }],
          confidence: 0.5,
          reasoning: "Missing actions",
        }),
      })
    );

    const validModelId = BENCHMARK_MODELS[0].id;
    const req = makeRequest(validModelId);
    const res = await handleReferenceAgent(req, testDeps);
    const body = await res.json();

    expect(body.next_steps[0].action).toBe("No action specified");
  });

  test("defaults missing reasoning to 'No reasoning provided'", async () => {
    mockGenerateText.mockImplementationOnce(() =>
      Promise.resolve({
        text: JSON.stringify({
          risks: [],
          nextSteps: [],
          confidence: 0.5,
        }),
      })
    );

    const validModelId = BENCHMARK_MODELS[0].id;
    const req = makeRequest(validModelId);
    const res = await handleReferenceAgent(req, testDeps);
    const body = await res.json();

    expect(body.reasoning).toBe("No reasoning provided");
  });

  test("extracts JSON from text with surrounding content", async () => {
    mockGenerateText.mockImplementationOnce(() =>
      Promise.resolve({
        text: `Here is my analysis:\n\n${JSON.stringify({
          risks: [{ description: "Extracted", severity: "low" }],
          nextSteps: [],
          confidence: 0.3,
          reasoning: "Embedded in text",
        })}\n\nHope this helps!`,
      })
    );

    const validModelId = BENCHMARK_MODELS[0].id;
    const req = makeRequest(validModelId);
    const res = await handleReferenceAgent(req, testDeps);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.risks[0].description).toBe("Extracted");
    expect(body.reasoning).toBe("Embedded in text");
  });

  test("handles empty risks and nextSteps arrays in response", async () => {
    mockGenerateText.mockImplementationOnce(() =>
      Promise.resolve({
        text: JSON.stringify({
          confidence: 0.9,
          reasoning: "No issues found",
        }),
      })
    );

    const validModelId = BENCHMARK_MODELS[0].id;
    const req = makeRequest(validModelId);
    const res = await handleReferenceAgent(req, testDeps);
    const body = await res.json();

    expect(body.risks).toEqual([]);
    expect(body.next_steps).toEqual([]);
    expect(body.confidence).toBe(0.9);
  });
});

// ============================================================================
// Tests: URL Path Parsing
// ============================================================================

describe("reference-agent: URL path parsing", () => {
  const originalEnv = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key";
    mockGenerateText.mockClear();
  });

  afterEach(() => {
    process.env.OPENROUTER_API_KEY = originalEnv;
  });

  test("extracts model ID from URL path", async () => {
    const validModelId = BENCHMARK_MODELS[0].id;
    const req = makeRequest(validModelId);
    const res = await handleReferenceAgent(req, testDeps);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.model).toBe(validModelId);
  });

  test("handles various model IDs from BENCHMARK_MODELS", async () => {
    // Test with a couple of different model IDs
    for (const model of BENCHMARK_MODELS.slice(0, 3)) {
      mockGenerateText.mockClear();
      const req = makeRequest(model.id);
      const res = await handleReferenceAgent(req, testDeps);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.model).toBe(model.id);
      expect(body.model_name).toBe(model.name);
    }
  });
});
