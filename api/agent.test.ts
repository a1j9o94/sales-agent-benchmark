import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import type { AgentRequest, AgentResponse } from "../src/types/benchmark";
import { handleAgentRequest, handleAgentEndpoint } from "./agent";

// ============================================================================
// Mock setup
// ============================================================================

const mockGenerateText = mock(() =>
  Promise.resolve({
    text: JSON.stringify({
      risks: [
        { description: "No executive sponsor identified", severity: "high" },
        { description: "Timeline too aggressive", severity: "medium" },
      ],
      nextSteps: [
        { action: "Set up exec sponsor meeting", priority: 1, rationale: "Critical for deal" },
        { action: "Validate timeline with team", priority: 2, rationale: "Reduce risk" },
      ],
      confidence: 0.65,
      reasoning: "Deal has potential but lacks executive alignment.",
    }),
  })
);

const testDeps = {
  generateText: mockGenerateText,
  anthropic: (modelId: string) => ({ modelId }),
} as any;

// ============================================================================
// Test Helpers
// ============================================================================

function makeMinimalRequest(): AgentRequest {
  return {
    checkpointId: "cp-001",
    dealContext: {
      company: "TestCorp",
      stage: "Qualification",
      lastInteraction: "Intro call completed",
      painPoints: ["Data scattered across systems"],
      stakeholders: [
        { name: "Sarah Chen", role: "champion", sentiment: "positive" },
      ],
      history: "Deal started last month",
    },
    question: "What are the biggest risks?",
  };
}

function makeFullRequest(): AgentRequest {
  return {
    checkpointId: "cp-full",
    dealContext: {
      company: "EnterpriseCo",
      stage: "Proposal",
      amount: "$1,200,000",
      closeDate: "2026-04-30",
      timeline: "Q2 2026 implementation",
      lastInteraction: "Pricing discussion with procurement",
      painPoints: [
        "Legacy system maintenance costs",
        "Compliance gaps",
        "Slow deployment cycles",
      ],
      stakeholders: [
        {
          name: "Maria Garcia",
          role: "champion",
          title: "VP Operations",
          sentiment: "positive",
          notes: "Driving the initiative internally",
        },
        {
          name: "David Lee",
          role: "economic_buyer",
          title: "CFO",
          sentiment: "neutral",
        },
        {
          name: "Tom Wilson",
          role: "technical_evaluator",
          title: "Lead Architect",
          sentiment: "positive",
          notes: "Completed POC successfully",
        },
      ],
      hypothesis: {
        whyTheyWillBuy: [
          "Clear ROI from reducing manual work",
          "Compliance audit deadline in Q3",
        ],
        whyTheyMightNot: [
          "Budget reallocation needed",
          "Board approval required for deals > $1M",
        ],
        whatNeedsToBeTrue: ["Budget approved by end of Q1"],
      },
      meddpicc: {
        metrics: { status: "quantified", notes: "$2M annual savings projected" },
        economicBuyer: { status: "identified", notes: "CFO David Lee" },
        decisionCriteria: {
          status: "defined",
          notes: "Security, scalability, integration",
        },
        decisionProcess: {
          status: "mapped",
          notes: "VP approval -> CFO sign-off -> Board for >$1M",
        },
        paperProcess: {
          status: "in_progress",
          notes: "Procurement review started",
        },
        pain: {
          status: "confirmed",
          notes: "Failed compliance audit, $500K penalty risk",
        },
        champion: {
          status: "strong",
          notes: "Maria has internal political capital",
        },
        competition: {
          status: "present",
          notes: "Incumbent vendor plus one alternative",
        },
      },
      history:
        "Initial contact in January. Discovery complete. POC successful in February.",
    },
    question: "Should we push for a close this quarter?",
  };
}

function makeHttpRequest(
  body: Record<string, unknown>,
  method = "POST"
): Request {
  return new Request("http://localhost/api/agent", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ============================================================================
// Tests: Deal Context Prompt Building (via handleAgentRequest)
// ============================================================================

describe("agent: deal context prompt building", () => {
  beforeEach(() => {
    mockGenerateText.mockClear();
  });

  test("builds prompt with minimal context", async () => {
    const req = makeMinimalRequest();
    await handleAgentRequest(req, testDeps);

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    const callArgs = mockGenerateText.mock.calls[0][0] as {
      system: string;
      prompt: string;
    };

    expect(callArgs.prompt).toContain("## Deal: TestCorp");
    expect(callArgs.prompt).toContain("**Stage:** Qualification");
    expect(callArgs.prompt).toContain("**Last Interaction:** Intro call completed");
    expect(callArgs.prompt).toContain("- Data scattered across systems");
    expect(callArgs.prompt).toContain("Sarah Chen");
    expect(callArgs.prompt).toContain("What are the biggest risks?");
    expect(callArgs.system).toContain("expert sales analyst");
  });

  test("builds prompt with all optional fields", async () => {
    const req = makeFullRequest();
    await handleAgentRequest(req, testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      prompt: string;
    };

    expect(callArgs.prompt).toContain("**Deal Size:** $1,200,000");
    expect(callArgs.prompt).toContain("**Target Close:** 2026-04-30");
    expect(callArgs.prompt).toContain("**Timeline:** Q2 2026 implementation");
  });

  test("includes hypothesis section when present", async () => {
    const req = makeFullRequest();
    await handleAgentRequest(req, testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      prompt: string;
    };

    expect(callArgs.prompt).toContain("### Hypothesis:");
    expect(callArgs.prompt).toContain("**Why they'll buy:**");
    expect(callArgs.prompt).toContain("- Clear ROI from reducing manual work");
    expect(callArgs.prompt).toContain("**Why they might not:**");
    expect(callArgs.prompt).toContain("- Budget reallocation needed");
  });

  test("skips hypothesis buy/not-buy sections when arrays are empty", async () => {
    const req = makeMinimalRequest();
    req.dealContext.hypothesis = {
      whyTheyWillBuy: [],
      whyTheyMightNot: [],
      whatNeedsToBeTrue: [],
    };

    await handleAgentRequest(req, testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      prompt: string;
    };

    expect(callArgs.prompt).toContain("### Hypothesis:");
    expect(callArgs.prompt).not.toContain("**Why they'll buy:**");
    expect(callArgs.prompt).not.toContain("**Why they might not:**");
  });

  test("includes MEDDPICC section when present", async () => {
    const req = makeFullRequest();
    await handleAgentRequest(req, testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      prompt: string;
    };

    expect(callArgs.prompt).toContain("### MEDDPICC Status:");
    expect(callArgs.prompt).toContain("**Metrics:** quantified");
    expect(callArgs.prompt).toContain("**Economic Buyer:** identified");
    expect(callArgs.prompt).toContain("**Decision Criteria:** defined");
    expect(callArgs.prompt).toContain("**Decision Process:** mapped");
    expect(callArgs.prompt).toContain("**Paper Process:** in_progress");
    expect(callArgs.prompt).toContain("**Pain:** confirmed");
    expect(callArgs.prompt).toContain("**Champion:** strong");
    expect(callArgs.prompt).toContain("**Competition:** present");
  });

  test("handles partial MEDDPICC (only some fields)", async () => {
    const req = makeMinimalRequest();
    req.dealContext.meddpicc = {
      metrics: { status: "unknown", notes: "TBD" },
      champion: { status: "weak", notes: "Not identified yet" },
    };

    await handleAgentRequest(req, testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      prompt: string;
    };

    expect(callArgs.prompt).toContain("### MEDDPICC Status:");
    expect(callArgs.prompt).toContain("**Metrics:** unknown - TBD");
    expect(callArgs.prompt).toContain("**Champion:** weak - Not identified yet");
    expect(callArgs.prompt).not.toContain("**Economic Buyer:**");
    expect(callArgs.prompt).not.toContain("**Competition:**");
  });

  test("includes deal history when present", async () => {
    const req = makeMinimalRequest();
    await handleAgentRequest(req, testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      prompt: string;
    };

    expect(callArgs.prompt).toContain("### Deal History:");
    expect(callArgs.prompt).toContain("Deal started last month");
  });

  test("skips deal history when absent", async () => {
    const req = makeMinimalRequest();
    // Use type assertion to remove required `history` field for testing
    delete (req.dealContext as Record<string, unknown>).history;

    await handleAgentRequest(req, testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      prompt: string;
    };

    expect(callArgs.prompt).not.toContain("### Deal History:");
  });

  test("renders stakeholder with title, sentiment, and notes", async () => {
    const req = makeMinimalRequest();
    req.dealContext.stakeholders = [
      {
        name: "Alex Kim",
        role: "economic_buyer",
        title: "CRO",
        sentiment: "negative",
        notes: "Concerned about ROI",
      },
    ];

    await handleAgentRequest(req, testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      prompt: string;
    };

    expect(callArgs.prompt).toContain("**Alex Kim** (economic_buyer, CRO)");
    expect(callArgs.prompt).toContain("negative sentiment");
    expect(callArgs.prompt).toContain("Concerned about ROI");
  });

  test("renders stakeholder without optional fields", async () => {
    const req = makeMinimalRequest();
    req.dealContext.stakeholders = [
      { name: "Bare Bones", role: "influencer" },
    ];

    await handleAgentRequest(req, testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      prompt: string;
    };

    expect(callArgs.prompt).toContain("**Bare Bones** (influencer)");
    expect(callArgs.prompt).toContain("unknown sentiment");
  });

  test("omits amount when not provided", async () => {
    const req = makeMinimalRequest();
    await handleAgentRequest(req, testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      prompt: string;
    };

    expect(callArgs.prompt).not.toContain("**Deal Size:**");
  });

  test("omits closeDate when not provided", async () => {
    const req = makeMinimalRequest();
    await handleAgentRequest(req, testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      prompt: string;
    };

    expect(callArgs.prompt).not.toContain("**Target Close:**");
  });

  test("omits timeline when not provided", async () => {
    const req = makeMinimalRequest();
    await handleAgentRequest(req, testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      prompt: string;
    };

    expect(callArgs.prompt).not.toContain("**Timeline:**");
  });

  test("prompt ends with JSON analysis instruction", async () => {
    const req = makeMinimalRequest();
    await handleAgentRequest(req, testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      prompt: string;
    };

    expect(callArgs.prompt).toContain(
      "Analyze this deal situation and provide your assessment as JSON."
    );
  });

  test("multiple pain points are all included", async () => {
    const req = makeMinimalRequest();
    req.dealContext.painPoints = ["Pain A", "Pain B", "Pain C", "Pain D"];

    await handleAgentRequest(req, testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      prompt: string;
    };

    expect(callArgs.prompt).toContain("- Pain A");
    expect(callArgs.prompt).toContain("- Pain B");
    expect(callArgs.prompt).toContain("- Pain C");
    expect(callArgs.prompt).toContain("- Pain D");
  });
});

// ============================================================================
// Tests: Response Parsing and Validation
// ============================================================================

describe("agent: response parsing and validation", () => {
  beforeEach(() => {
    mockGenerateText.mockClear();
  });

  test("returns well-structured AgentResponse for valid model output", async () => {
    const req = makeMinimalRequest();
    const res = await handleAgentRequest(req, testDeps);

    expect(res.risks).toBeArray();
    expect(res.risks.length).toBe(2);
    expect(res.risks[0].description).toBe("No executive sponsor identified");
    expect(res.risks[0].severity).toBe("high");
    expect(res.risks[1].severity).toBe("medium");

    expect(res.nextSteps).toBeArray();
    expect(res.nextSteps.length).toBe(2);
    expect(res.nextSteps[0].action).toBe("Set up exec sponsor meeting");
    expect(res.nextSteps[0].priority).toBe(1);
    expect(res.nextSteps[0].rationale).toBe("Critical for deal");

    expect(res.confidence).toBe(0.65);
    expect(res.reasoning).toBe(
      "Deal has potential but lacks executive alignment."
    );
  });

  test("normalizes invalid severity values to 'medium'", async () => {
    mockGenerateText.mockImplementationOnce(() =>
      Promise.resolve({
        text: JSON.stringify({
          risks: [
            { description: "R1", severity: "critical" },
            { description: "R2", severity: "extreme" },
            { description: "R3", severity: "low" },
          ],
          nextSteps: [],
          confidence: 0.5,
          reasoning: "Test",
        }),
      })
    );

    const res = await handleAgentRequest(makeMinimalRequest(), testDeps);
    expect(res.risks[0].severity).toBe("medium");
    expect(res.risks[1].severity).toBe("medium");
    expect(res.risks[2].severity).toBe("low");
  });

  test("clamps confidence > 1 to 1.0", async () => {
    mockGenerateText.mockImplementationOnce(() =>
      Promise.resolve({
        text: JSON.stringify({
          risks: [],
          nextSteps: [],
          confidence: 2.5,
          reasoning: "Over-confident",
        }),
      })
    );

    const res = await handleAgentRequest(makeMinimalRequest(), testDeps);
    expect(res.confidence).toBe(1.0);
  });

  test("clamps confidence < 0 to 0", async () => {
    mockGenerateText.mockImplementationOnce(() =>
      Promise.resolve({
        text: JSON.stringify({
          risks: [],
          nextSteps: [],
          confidence: -1,
          reasoning: "Negative",
        }),
      })
    );

    const res = await handleAgentRequest(makeMinimalRequest(), testDeps);
    expect(res.confidence).toBe(0);
  });

  test("defaults confidence to 0.5 when not a number", async () => {
    mockGenerateText.mockImplementationOnce(() =>
      Promise.resolve({
        text: JSON.stringify({
          risks: [],
          nextSteps: [],
          confidence: "moderate",
          reasoning: "String confidence",
        }),
      })
    );

    const res = await handleAgentRequest(makeMinimalRequest(), testDeps);
    expect(res.confidence).toBe(0.5);
  });

  test("handles next_steps (snake_case) from model output", async () => {
    mockGenerateText.mockImplementationOnce(() =>
      Promise.resolve({
        text: JSON.stringify({
          risks: [],
          next_steps: [
            { action: "Action A", priority: 1 },
            { action: "Action B", priority: 2 },
          ],
          confidence: 0.6,
          reasoning: "Snake case test",
        }),
      })
    );

    const res = await handleAgentRequest(makeMinimalRequest(), testDeps);
    expect(res.nextSteps.length).toBe(2);
    expect(res.nextSteps[0].action).toBe("Action A");
    expect(res.nextSteps[1].action).toBe("Action B");
  });

  test("assigns sequential priorities when missing", async () => {
    mockGenerateText.mockImplementationOnce(() =>
      Promise.resolve({
        text: JSON.stringify({
          risks: [],
          nextSteps: [
            { action: "Step 1" },
            { action: "Step 2" },
            { action: "Step 3" },
          ],
          confidence: 0.5,
          reasoning: "No priorities",
        }),
      })
    );

    const res = await handleAgentRequest(makeMinimalRequest(), testDeps);
    expect(res.nextSteps[0].priority).toBe(1);
    expect(res.nextSteps[1].priority).toBe(2);
    expect(res.nextSteps[2].priority).toBe(3);
  });

  test("defaults missing risk description to 'Unknown risk'", async () => {
    mockGenerateText.mockImplementationOnce(() =>
      Promise.resolve({
        text: JSON.stringify({
          risks: [{ severity: "high" }, {}],
          nextSteps: [],
          confidence: 0.5,
          reasoning: "Test",
        }),
      })
    );

    const res = await handleAgentRequest(makeMinimalRequest(), testDeps);
    expect(res.risks[0].description).toBe("Unknown risk");
    expect(res.risks[1].description).toBe("Unknown risk");
  });

  test("defaults missing action to 'No action specified'", async () => {
    mockGenerateText.mockImplementationOnce(() =>
      Promise.resolve({
        text: JSON.stringify({
          risks: [],
          nextSteps: [{ priority: 1 }],
          confidence: 0.5,
          reasoning: "Test",
        }),
      })
    );

    const res = await handleAgentRequest(makeMinimalRequest(), testDeps);
    expect(res.nextSteps[0].action).toBe("No action specified");
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

    const res = await handleAgentRequest(makeMinimalRequest(), testDeps);
    expect(res.reasoning).toBe("No reasoning provided");
  });

  test("extracts JSON from text with surrounding content", async () => {
    mockGenerateText.mockImplementationOnce(() =>
      Promise.resolve({
        text: `Let me analyze this deal.\n\n${JSON.stringify({
          risks: [{ description: "Found it", severity: "low" }],
          nextSteps: [],
          confidence: 0.4,
          reasoning: "Extracted successfully",
        })}\n\nI hope this analysis is helpful.`,
      })
    );

    const res = await handleAgentRequest(makeMinimalRequest(), testDeps);
    expect(res.risks[0].description).toBe("Found it");
    expect(res.reasoning).toBe("Extracted successfully");
  });

  test("handles empty risks and nextSteps arrays", async () => {
    mockGenerateText.mockImplementationOnce(() =>
      Promise.resolve({
        text: JSON.stringify({
          confidence: 0.95,
          reasoning: "Looks great",
        }),
      })
    );

    const res = await handleAgentRequest(makeMinimalRequest(), testDeps);
    expect(res.risks).toEqual([]);
    expect(res.nextSteps).toEqual([]);
  });

  test("returns fallback response when no JSON found", async () => {
    mockGenerateText.mockImplementationOnce(() =>
      Promise.resolve({
        text: "I cannot provide a structured analysis at this time.",
      })
    );

    const res = await handleAgentRequest(makeMinimalRequest(), testDeps);

    // Fallback response
    expect(res.risks.length).toBe(1);
    expect(res.risks[0].description).toContain("Unable to analyze deal");
    expect(res.risks[0].severity).toBe("high");
    expect(res.nextSteps.length).toBe(1);
    expect(res.confidence).toBe(0);
    expect(res.reasoning).toContain("No JSON found");
  });

  test("returns fallback response when API call throws", async () => {
    mockGenerateText.mockImplementationOnce(() =>
      Promise.reject(new Error("Network timeout"))
    );

    const res = await handleAgentRequest(makeMinimalRequest(), testDeps);

    expect(res.risks.length).toBe(1);
    expect(res.risks[0].description).toContain("Unable to analyze deal");
    expect(res.confidence).toBe(0);
    expect(res.reasoning).toContain("Network timeout");
  });

  test("returns fallback response with 'Unknown error' for non-Error throws", async () => {
    mockGenerateText.mockImplementationOnce(() =>
      Promise.reject("string error")
    );

    const res = await handleAgentRequest(makeMinimalRequest(), testDeps);

    expect(res.confidence).toBe(0);
    expect(res.reasoning).toContain("Unknown error");
  });
});

// ============================================================================
// Tests: HTTP Handler (handleAgentEndpoint)
// ============================================================================

describe("agent: handleAgentEndpoint", () => {
  beforeEach(() => {
    mockGenerateText.mockClear();
  });

  test("returns 405 for non-POST methods", async () => {
    const req = new Request("http://localhost/api/agent", { method: "GET" });
    const res = await handleAgentEndpoint(req, testDeps);
    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body.error).toContain("Method not allowed");
  });

  test("returns 405 for PUT method", async () => {
    const req = new Request("http://localhost/api/agent", {
      method: "PUT",
      body: "{}",
    });
    const res = await handleAgentEndpoint(req, testDeps);
    expect(res.status).toBe(405);
  });

  test("returns 400 when checkpoint_id is missing", async () => {
    const req = makeHttpRequest({
      deal_context: { company: "Test", stage: "Discovery", lastInteraction: "Call", painPoints: [], stakeholders: [], history: "" },
    });
    const res = await handleAgentEndpoint(req, testDeps);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("checkpoint_id is required");
  });

  test("returns 400 when deal_context is missing", async () => {
    const req = makeHttpRequest({
      checkpoint_id: "cp-001",
    });
    const res = await handleAgentEndpoint(req, testDeps);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("deal_context is required");
  });

  test("successful request returns 200 with correct response shape", async () => {
    const req = makeHttpRequest({
      checkpoint_id: "cp-001",
      deal_context: {
        company: "TestCorp",
        stage: "Qualification",
        lastInteraction: "Demo",
        painPoints: ["Slowness"],
        stakeholders: [{ name: "Test", role: "champion" }],
        history: "Recent",
      },
      question: "Key risks?",
    });

    const res = await handleAgentEndpoint(req, testDeps);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.risks).toBeArray();
    expect(body.next_steps).toBeArray();
    expect(typeof body.confidence).toBe("number");
    expect(typeof body.reasoning).toBe("string");
  });

  test("response uses snake_case keys (next_steps not nextSteps)", async () => {
    const req = makeHttpRequest({
      checkpoint_id: "cp-001",
      deal_context: {
        company: "TestCorp",
        stage: "Qualification",
        lastInteraction: "Demo",
        painPoints: ["Slowness"],
        stakeholders: [],
        history: "Recent",
      },
    });

    const res = await handleAgentEndpoint(req, testDeps);
    const body = await res.json();

    expect(body).toHaveProperty("next_steps");
    expect(body).not.toHaveProperty("nextSteps");
  });

  test("accepts camelCase request format", async () => {
    const req = makeHttpRequest({
      checkpointId: "cp-camel",
      dealContext: {
        company: "CamelCorp",
        stage: "Discovery",
        lastInteraction: "Call",
        painPoints: ["Issue"],
        stakeholders: [],
        history: "Fresh",
      },
      question: "Camel case test",
    });

    const res = await handleAgentEndpoint(req, testDeps);
    expect(res.status).toBe(200);
  });

  test("accepts snake_case request format", async () => {
    const req = makeHttpRequest({
      checkpoint_id: "cp-snake",
      deal_context: {
        company: "SnakeCorp",
        stage: "Proposal",
        last_interaction: "Meeting",
        pain_points: ["Problem"],
        stakeholders: [],
        history: "Ongoing",
      },
      question: "Snake case test",
    });

    const res = await handleAgentEndpoint(req, testDeps);
    expect(res.status).toBe(200);
  });

  test("normalizes snake_case deal_context fields", async () => {
    const req = makeHttpRequest({
      checkpoint_id: "cp-norm",
      deal_context: {
        company: "NormCorp",
        stage: "Discovery",
        close_date: "2026-05-01",
        last_interaction: "First meeting",
        pain_points: ["Integration complexity"],
        stakeholders: [{ name: "Norm Test", role: "champion" }],
        history: "New deal",
      },
      question: "Normalization test",
    });

    await handleAgentEndpoint(req, testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      prompt: string;
    };

    expect(callArgs.prompt).toContain("**Target Close:** 2026-05-01");
    expect(callArgs.prompt).toContain("**Last Interaction:** First meeting");
    expect(callArgs.prompt).toContain("- Integration complexity");
  });

  test("uses default question when none provided", async () => {
    const req = makeHttpRequest({
      checkpoint_id: "cp-default",
      deal_context: {
        company: "DefaultQ",
        stage: "Discovery",
        lastInteraction: "Call",
        painPoints: [],
        stakeholders: [],
        history: "Test",
      },
      // No question field
    });

    await handleAgentEndpoint(req, testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      prompt: string;
    };

    expect(callArgs.prompt).toContain(
      "What are the top risks and recommended next steps?"
    );
  });

  test("response next_steps have action, priority, and rationale", async () => {
    const req = makeHttpRequest({
      checkpoint_id: "cp-001",
      deal_context: {
        company: "TestCorp",
        stage: "Qualification",
        lastInteraction: "Demo",
        painPoints: [],
        stakeholders: [],
        history: "Test",
      },
    });

    const res = await handleAgentEndpoint(req, testDeps);
    const body = await res.json();

    for (const step of body.next_steps) {
      expect(step).toHaveProperty("action");
      expect(step).toHaveProperty("priority");
      // rationale may be undefined but the key should exist
      expect("rationale" in step).toBe(true);
    }
  });

  test("handles error in request body parsing", async () => {
    const req = new Request("http://localhost/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-valid-json",
    });

    const res = await handleAgentEndpoint(req, testDeps);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});

// ============================================================================
// Tests: System Prompt
// ============================================================================

describe("agent: system prompt", () => {
  beforeEach(() => {
    mockGenerateText.mockClear();
  });

  test("system prompt includes risk identification instructions", async () => {
    await handleAgentRequest(makeMinimalRequest(), testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      system: string;
    };

    expect(callArgs.system).toContain("IDENTIFY RISKS");
    expect(callArgs.system).toContain("Missing stakeholder buy-in");
    expect(callArgs.system).toContain("Competitive threats");
  });

  test("system prompt includes next steps instructions", async () => {
    await handleAgentRequest(makeMinimalRequest(), testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      system: string;
    };

    expect(callArgs.system).toContain("RECOMMEND NEXT STEPS");
    expect(callArgs.system).toContain("build momentum");
  });

  test("system prompt specifies JSON response format", async () => {
    await handleAgentRequest(makeMinimalRequest(), testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      system: string;
    };

    expect(callArgs.system).toContain("Return your analysis as JSON");
    expect(callArgs.system).toContain('"risks"');
    expect(callArgs.system).toContain('"nextSteps"');
    expect(callArgs.system).toContain('"confidence"');
    expect(callArgs.system).toContain('"reasoning"');
  });

  test("system prompt uses claude-sonnet model", async () => {
    await handleAgentRequest(makeMinimalRequest(), testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      model: { modelId: string };
    };

    expect(callArgs.model.modelId).toContain("claude-sonnet");
  });
});

// ============================================================================
// Tests: Edge Cases
// ============================================================================

describe("agent: edge cases", () => {
  beforeEach(() => {
    mockGenerateText.mockClear();
  });

  test("handles deal with no stakeholders", async () => {
    const req = makeMinimalRequest();
    req.dealContext.stakeholders = [];

    await handleAgentRequest(req, testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      prompt: string;
    };

    expect(callArgs.prompt).toContain("### Stakeholders:");
    // No stakeholder lines should follow
  });

  test("handles deal with no pain points", async () => {
    const req = makeMinimalRequest();
    req.dealContext.painPoints = [];

    await handleAgentRequest(req, testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as {
      prompt: string;
    };

    expect(callArgs.prompt).toContain("### Pain Points:");
  });

  test("handles model returning malformed JSON gracefully", async () => {
    mockGenerateText.mockImplementationOnce(() =>
      Promise.resolve({
        text: '{"risks": [{"description": "test"}], "nextSteps": INVALID',
      })
    );

    const res = await handleAgentRequest(makeMinimalRequest(), testDeps);

    // Should return fallback response (JSON.parse fails, caught by try/catch)
    expect(res.confidence).toBe(0);
    expect(res.risks[0].description).toContain("Unable to analyze deal");
  });

  test("handles model returning nested JSON objects", async () => {
    mockGenerateText.mockImplementationOnce(() =>
      Promise.resolve({
        text: JSON.stringify({
          risks: [
            { description: "Complex risk", severity: "high" },
          ],
          nextSteps: [
            {
              action: "Multi-step plan",
              priority: 1,
              rationale: "Important because of multiple factors",
            },
          ],
          confidence: 0.72,
          reasoning: "Detailed analysis with specific references.",
        }),
      })
    );

    const res = await handleAgentRequest(makeMinimalRequest(), testDeps);
    expect(res.risks[0].description).toBe("Complex risk");
    expect(res.nextSteps[0].rationale).toContain("multiple factors");
  });

  test("confidence of exactly 0 is preserved", async () => {
    mockGenerateText.mockImplementationOnce(() =>
      Promise.resolve({
        text: JSON.stringify({
          risks: [],
          nextSteps: [],
          confidence: 0,
          reasoning: "Zero confidence",
        }),
      })
    );

    const res = await handleAgentRequest(makeMinimalRequest(), testDeps);
    expect(res.confidence).toBe(0);
  });

  test("confidence of exactly 1 is preserved", async () => {
    mockGenerateText.mockImplementationOnce(() =>
      Promise.resolve({
        text: JSON.stringify({
          risks: [],
          nextSteps: [],
          confidence: 1,
          reasoning: "Full confidence",
        }),
      })
    );

    const res = await handleAgentRequest(makeMinimalRequest(), testDeps);
    expect(res.confidence).toBe(1);
  });
});
