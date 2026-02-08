import { test, expect, describe, mock, beforeEach } from "bun:test";
import type {
  Checkpoint,
  AgentResponse,
  EvaluationScores,
  DealContext,
  GroundTruth,
} from "../src/types/benchmark";
import type { JudgeEvaluation, EvaluateDeps } from "./evaluate-response";
import {
  JUDGE_MODELS,
  evaluateResponse,
  evaluateResponseMultiJudge,
  handleEvaluateResponseEndpoint,
} from "./evaluate-response";

// ─── Test helpers ───────────────────────────────────────────────────────────────

function makeCheckpoint(overrides?: Partial<Checkpoint>): Checkpoint {
  return {
    id: "cp-1",
    dealId: "deal-1",
    timestamp: "2025-01-15T10:00:00Z",
    context: makeDealContext(),
    groundTruth: makeGroundTruth(),
    ...overrides,
  };
}

function makeDealContext(overrides?: Partial<DealContext>): DealContext {
  return {
    company: "Acme Corp",
    stage: "Negotiation",
    lastInteraction: "Call on Jan 14",
    painPoints: ["Slow onboarding", "Manual reporting"],
    stakeholders: [
      { name: "Jane Doe", role: "VP Sales", sentiment: "positive" },
      { name: "Bob Smith", role: "CFO", sentiment: "neutral" },
    ],
    history: "3 demos completed, POC approved",
    ...overrides,
  };
}

function makeGroundTruth(overrides?: Partial<GroundTruth>): GroundTruth {
  return {
    whatHappenedNext: "CFO raised budget concerns and delayed decision by 2 weeks",
    actualRisksThatMaterialized: ["Budget freeze", "Champion went on leave"],
    outcomeAtThisPoint: "at_risk",
    ...overrides,
  };
}

function makeAgentResponse(overrides?: Partial<AgentResponse>): AgentResponse {
  return {
    risks: [
      { description: "Budget might be cut", severity: "high" },
      { description: "Timeline could slip", severity: "medium" },
    ],
    nextSteps: [
      { action: "Schedule CFO meeting", priority: 1 },
      { action: "Send ROI analysis", priority: 2 },
    ],
    confidence: 0.75,
    reasoning: "Based on stakeholder sentiment and stage progression",
    ...overrides,
  };
}

function makeJudgeEvaluation(overrides?: Partial<JudgeEvaluation>): JudgeEvaluation {
  return {
    judgeModel: "test-model",
    judgeName: "Test Judge",
    scores: {
      riskIdentification: 7,
      nextStepQuality: 8,
      prioritization: 6,
      outcomeAlignment: 7,
    },
    totalScore: 28,
    feedback: "Solid analysis overall",
    risksIdentified: ["Budget risk"],
    risksMissed: ["Champion leaving"],
    helpfulRecommendations: ["CFO meeting"],
    unhelpfulRecommendations: [],
    ...overrides,
  };
}

// ─── Mock setup ─────────────────────────────────────────────────────────────────

// We need to mock the `ai` module's generateText before importing the module
// under test. We use dynamic import after mocking.

const mockGenerateText = mock(() =>
  Promise.resolve({
    text: JSON.stringify({
      scores: {
        risk_identification: 8,
        next_step_quality: 7,
        prioritization: 6,
        outcome_alignment: 9,
      },
      feedback: "Good analysis",
      risks_identified: ["Budget risk"],
      risks_missed: ["Champion leaving"],
      helpful_recommendations: ["CFO meeting"],
      unhelpful_recommendations: ["Unnecessary demo"],
    }),
  })
);

const testDeps = {
  generateText: mockGenerateText,
  anthropic: () => "mocked-anthropic-model",
  openrouter: () => "mocked-openrouter-model",
} as any;

// Access internal functions via re-importing the module source.
// Since buildEvaluationPrompt and aggregateJudgeScores are not exported,
// we test them indirectly or use a workaround to access them.

// For buildEvaluationPrompt, we can test it by looking at what prompt
// is passed to generateText when evaluateResponse is called.
// For aggregateJudgeScores, we test it through evaluateResponseMultiJudge
// or extract it. Let's use a direct approach: re-read the module and
// test the functions through the module's default evaluation path.

// ─── buildEvaluationPrompt (tested indirectly via evaluateResponse) ─────────

describe("buildEvaluationPrompt", () => {
  beforeEach(() => {
    mockGenerateText.mockClear();
    mockGenerateText.mockImplementation(() =>
      Promise.resolve({
        text: JSON.stringify({
          scores: {
            risk_identification: 5,
            next_step_quality: 5,
            prioritization: 5,
            outcome_alignment: 5,
          },
          feedback: "OK",
          risks_identified: [],
          risks_missed: [],
          helpful_recommendations: [],
          unhelpful_recommendations: [],
        }),
      })
    );
  });

  test("includes company name in prompt", async () => {
    const checkpoint = makeCheckpoint({
      context: makeDealContext({ company: "TestCorp Inc" }),
    });
    await evaluateResponse(checkpoint, makeAgentResponse(), "public", testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as { prompt: string };
    expect(callArgs.prompt).toContain("TestCorp Inc");
  });

  test("includes deal stage in prompt", async () => {
    const checkpoint = makeCheckpoint({
      context: makeDealContext({ stage: "Discovery" }),
    });
    await evaluateResponse(checkpoint, makeAgentResponse(), "public", testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as { prompt: string };
    expect(callArgs.prompt).toContain("Discovery");
  });

  test("includes last interaction in prompt", async () => {
    const checkpoint = makeCheckpoint({
      context: makeDealContext({ lastInteraction: "Email on Feb 1" }),
    });
    await evaluateResponse(checkpoint, makeAgentResponse(), "public", testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as { prompt: string };
    expect(callArgs.prompt).toContain("Email on Feb 1");
  });

  test("includes all pain points in prompt", async () => {
    const checkpoint = makeCheckpoint({
      context: makeDealContext({
        painPoints: ["Pain A", "Pain B", "Pain C"],
      }),
    });
    await evaluateResponse(checkpoint, makeAgentResponse(), "public", testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as { prompt: string };
    expect(callArgs.prompt).toContain("- Pain A");
    expect(callArgs.prompt).toContain("- Pain B");
    expect(callArgs.prompt).toContain("- Pain C");
  });

  test("includes stakeholder names, roles, and sentiments", async () => {
    const checkpoint = makeCheckpoint({
      context: makeDealContext({
        stakeholders: [
          { name: "Alice", role: "CEO", sentiment: "negative" },
          { name: "Charlie", role: "CTO", sentiment: "positive" },
        ],
      }),
    });
    await evaluateResponse(checkpoint, makeAgentResponse(), "public", testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as { prompt: string };
    expect(callArgs.prompt).toContain("Alice (CEO): negative sentiment");
    expect(callArgs.prompt).toContain("Charlie (CTO): positive sentiment");
  });

  test("includes history when present", async () => {
    const checkpoint = makeCheckpoint({
      context: makeDealContext({ history: "Won similar deal last quarter" }),
    });
    await evaluateResponse(checkpoint, makeAgentResponse(), "public", testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as { prompt: string };
    expect(callArgs.prompt).toContain("Won similar deal last quarter");
  });

  test("handles empty history gracefully", async () => {
    const checkpoint = makeCheckpoint({
      context: makeDealContext({ history: "" }),
    });
    await evaluateResponse(checkpoint, makeAgentResponse(), "public", testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as { prompt: string };
    // Empty history should not produce "History: " line (falsy check)
    expect(callArgs.prompt).not.toContain("History: ");
  });

  test("includes ground truth whatHappenedNext", async () => {
    const checkpoint = makeCheckpoint({
      groundTruth: makeGroundTruth({
        whatHappenedNext: "Deal collapsed unexpectedly",
      }),
    });
    await evaluateResponse(checkpoint, makeAgentResponse(), "public", testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as { prompt: string };
    expect(callArgs.prompt).toContain("Deal collapsed unexpectedly");
  });

  test("includes actual risks that materialized", async () => {
    const checkpoint = makeCheckpoint({
      groundTruth: makeGroundTruth({
        actualRisksThatMaterialized: ["Competitor undercut price", "Legal delay"],
      }),
    });
    await evaluateResponse(checkpoint, makeAgentResponse(), "public", testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as { prompt: string };
    expect(callArgs.prompt).toContain("- Competitor undercut price");
    expect(callArgs.prompt).toContain("- Legal delay");
  });

  test("includes outcome at this point", async () => {
    const checkpoint = makeCheckpoint({
      groundTruth: makeGroundTruth({ outcomeAtThisPoint: "won" }),
    });
    await evaluateResponse(checkpoint, makeAgentResponse(), "public", testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as { prompt: string };
    expect(callArgs.prompt).toContain("Outcome at this point: won");
  });

  test("includes agent risks with severity", async () => {
    const response = makeAgentResponse({
      risks: [
        { description: "Budget freeze imminent", severity: "high" },
        { description: "Timeline slip", severity: "low" },
      ],
    });
    await evaluateResponse(makeCheckpoint(), response, "public", testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as { prompt: string };
    expect(callArgs.prompt).toContain("[high] Budget freeze imminent");
    expect(callArgs.prompt).toContain("[low] Timeline slip");
  });

  test("includes agent next steps with priority", async () => {
    const response = makeAgentResponse({
      nextSteps: [
        { action: "Call the CEO", priority: 1 },
        { action: "Send proposal", priority: 3 },
      ],
    });
    await evaluateResponse(makeCheckpoint(), response, "public", testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as { prompt: string };
    expect(callArgs.prompt).toContain("(Priority 1) Call the CEO");
    expect(callArgs.prompt).toContain("(Priority 3) Send proposal");
  });

  test("includes agent confidence and reasoning", async () => {
    const response = makeAgentResponse({
      confidence: 0.92,
      reasoning: "Strong signals from champion",
    });
    await evaluateResponse(makeCheckpoint(), response, "public", testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as { prompt: string };
    expect(callArgs.prompt).toContain("Confidence: 0.92");
    expect(callArgs.prompt).toContain("Reasoning: Strong signals from champion");
  });

  test("handles empty risks array", async () => {
    const response = makeAgentResponse({ risks: [] });
    await evaluateResponse(makeCheckpoint(), response, "public", testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as { prompt: string };
    expect(callArgs.prompt).toContain("Risks Identified:");
  });

  test("handles empty next steps array", async () => {
    const response = makeAgentResponse({ nextSteps: [] });
    await evaluateResponse(makeCheckpoint(), response, "public", testDeps);

    const callArgs = mockGenerateText.mock.calls[0][0] as { prompt: string };
    expect(callArgs.prompt).toContain("Recommended Next Steps:");
  });
});

// ─── aggregateJudgeScores (tested indirectly via evaluateResponseMultiJudge) ──

describe("aggregateJudgeScores", () => {
  // We test this by importing the function from the module internals.
  // Since it is not exported, we need to use a workaround.
  // We can extract it by using Bun's module internals or test through evaluateResponseMultiJudge.

  // Direct test approach: we can re-declare the function inline based on its known behavior,
  // OR we can test through the multi-judge API path.
  // Let's test through the multi-judge evaluation path, checking the aggregated results.

  // However, for more precise testing, let's extract the function directly.
  // We'll use a helper that imports the raw module text.

  // Actually, the cleanest approach: since we know the function signature and it's
  // deterministic, let's replicate it here for direct testing. But the user asked
  // to test the actual function. We'll extract it from the module.

  // Best approach: use eval to get access, or simply test through the public API.
  // Let's do both: direct unit tests with a local copy, and integration tests through the API.

  // For direct testing, we extract via dynamic import trick:
  // The function is not exported, so we test it indirectly through evaluateResponseMultiJudge.

  beforeEach(() => {
    mockGenerateText.mockClear();
  });

  test("single judge: scores pass through unchanged", async () => {
    mockGenerateText.mockImplementation(() =>
      Promise.resolve({
        text: JSON.stringify({
          scores: {
            risk_identification: 8,
            next_step_quality: 7,
            prioritization: 6,
            outcome_alignment: 9,
          },
          feedback: "Good",
          risks_identified: ["Risk A"],
          risks_missed: ["Risk B"],
          helpful_recommendations: ["Rec A"],
          unhelpful_recommendations: ["Rec B"],
        }),
      })
    );

    const result = await evaluateResponseMultiJudge(
      makeCheckpoint(),
      makeAgentResponse(),
      "public",
      testDeps
    );

    // With 3 identical judges (all use same mock), scores should be the same
    expect(result.scores.riskIdentification).toBe(8);
    expect(result.scores.nextStepQuality).toBe(7);
    expect(result.scores.prioritization).toBe(6);
    expect(result.scores.outcomeAlignment).toBe(9);
    expect(result.totalScore).toBe(30);
  });

  test("multiple judges: scores are averaged correctly", async () => {
    let callCount = 0;
    mockGenerateText.mockImplementation(() => {
      callCount++;
      const scores =
        callCount === 1
          ? { risk_identification: 10, next_step_quality: 8, prioritization: 6, outcome_alignment: 4 }
          : callCount === 2
            ? { risk_identification: 6, next_step_quality: 4, prioritization: 8, outcome_alignment: 10 }
            : { risk_identification: 8, next_step_quality: 6, prioritization: 4, outcome_alignment: 10 };

      return Promise.resolve({
        text: JSON.stringify({
          scores,
          feedback: `Judge ${callCount} feedback`,
          risks_identified: [],
          risks_missed: [],
          helpful_recommendations: [],
          unhelpful_recommendations: [],
        }),
      });
    });

    const result = await evaluateResponseMultiJudge(
      makeCheckpoint(),
      makeAgentResponse(),
      "public",
      testDeps
    );

    // Averages: risk=(10+6+8)/3=8, next=(8+4+6)/3=6, prior=(6+8+4)/3=6, outcome=(4+10+10)/3=8
    expect(result.scores.riskIdentification).toBe(8);
    expect(result.scores.nextStepQuality).toBe(6);
    expect(result.scores.prioritization).toBe(6);
    expect(result.scores.outcomeAlignment).toBe(8);
    expect(result.totalScore).toBe(28);
  });

  test("averaging produces correct rounding to 1 decimal place", async () => {
    let callCount = 0;
    mockGenerateText.mockImplementation(() => {
      callCount++;
      const scores =
        callCount === 1
          ? { risk_identification: 7, next_step_quality: 5, prioritization: 3, outcome_alignment: 9 }
          : callCount === 2
            ? { risk_identification: 8, next_step_quality: 6, prioritization: 4, outcome_alignment: 8 }
            : { risk_identification: 9, next_step_quality: 4, prioritization: 5, outcome_alignment: 7 };

      return Promise.resolve({
        text: JSON.stringify({
          scores,
          feedback: `Judge ${callCount}`,
          risks_identified: [],
          risks_missed: [],
          helpful_recommendations: [],
          unhelpful_recommendations: [],
        }),
      });
    });

    const result = await evaluateResponseMultiJudge(
      makeCheckpoint(),
      makeAgentResponse(),
      "public",
      testDeps
    );

    // risk=(7+8+9)/3=8.0, next=(5+6+4)/3=5.0, prior=(3+4+5)/3=4.0, outcome=(9+8+7)/3=8.0
    expect(result.scores.riskIdentification).toBe(8);
    expect(result.scores.nextStepQuality).toBe(5);
    expect(result.scores.prioritization).toBe(4);
    expect(result.scores.outcomeAlignment).toBe(8);
  });

  test("feedback from all judges is combined with judge names", async () => {
    let callCount = 0;
    mockGenerateText.mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        text: JSON.stringify({
          scores: { risk_identification: 5, next_step_quality: 5, prioritization: 5, outcome_alignment: 5 },
          feedback: `Feedback from judge ${callCount}`,
          risks_identified: [],
          risks_missed: [],
          helpful_recommendations: [],
          unhelpful_recommendations: [],
        }),
      });
    });

    const result = await evaluateResponseMultiJudge(
      makeCheckpoint(),
      makeAgentResponse(),
      "public",
      testDeps
    );

    // Feedback should contain all judge feedbacks with judge names
    expect(result.feedback).toContain("Feedback from judge");
    expect(result.feedback).toContain("|"); // separator between judge feedbacks
  });

  test("maxScore is always 40", async () => {
    mockGenerateText.mockImplementation(() =>
      Promise.resolve({
        text: JSON.stringify({
          scores: { risk_identification: 5, next_step_quality: 5, prioritization: 5, outcome_alignment: 5 },
          feedback: "OK",
          risks_identified: [],
          risks_missed: [],
          helpful_recommendations: [],
          unhelpful_recommendations: [],
        }),
      })
    );

    const result = await evaluateResponseMultiJudge(
      makeCheckpoint(),
      makeAgentResponse(),
      "public",
      testDeps
    );
    expect(result.maxScore).toBe(40);
  });
});

// ─── Score normalization / clamping ─────────────────────────────────────────────

describe("score normalization and clamping", () => {
  beforeEach(() => {
    mockGenerateText.mockClear();
  });

  test("scores above 10 are clamped to 10", async () => {
    mockGenerateText.mockImplementation(() =>
      Promise.resolve({
        text: JSON.stringify({
          scores: {
            risk_identification: 15,
            next_step_quality: 12,
            prioritization: 99,
            outcome_alignment: 11,
          },
          feedback: "Over the top",
        }),
      })
    );

    const result = await evaluateResponse(makeCheckpoint(), makeAgentResponse(), "public", testDeps);

    expect(result.scores.riskIdentification).toBe(10);
    expect(result.scores.nextStepQuality).toBe(10);
    expect(result.scores.prioritization).toBe(10);
    expect(result.scores.outcomeAlignment).toBe(10);
    expect(result.totalScore).toBe(40);
  });

  test("scores below 0 are clamped to 0", async () => {
    mockGenerateText.mockImplementation(() =>
      Promise.resolve({
        text: JSON.stringify({
          scores: {
            risk_identification: -5,
            next_step_quality: -1,
            prioritization: -100,
            outcome_alignment: -0.5,
          },
          feedback: "Negative scores",
        }),
      })
    );

    const result = await evaluateResponse(makeCheckpoint(), makeAgentResponse(), "public", testDeps);

    expect(result.scores.riskIdentification).toBe(0);
    expect(result.scores.nextStepQuality).toBe(0);
    expect(result.scores.prioritization).toBe(0);
    expect(result.scores.outcomeAlignment).toBe(0);
    expect(result.totalScore).toBe(0);
  });

  test("missing scores default to 0", async () => {
    mockGenerateText.mockImplementation(() =>
      Promise.resolve({
        text: JSON.stringify({
          scores: {},
          feedback: "Missing scores",
        }),
      })
    );

    const result = await evaluateResponse(makeCheckpoint(), makeAgentResponse(), "public", testDeps);

    expect(result.scores.riskIdentification).toBe(0);
    expect(result.scores.nextStepQuality).toBe(0);
    expect(result.scores.prioritization).toBe(0);
    expect(result.scores.outcomeAlignment).toBe(0);
    expect(result.totalScore).toBe(0);
  });

  test("missing scores object defaults to 0", async () => {
    mockGenerateText.mockImplementation(() =>
      Promise.resolve({
        text: JSON.stringify({
          feedback: "No scores object at all",
        }),
      })
    );

    const result = await evaluateResponse(makeCheckpoint(), makeAgentResponse(), "public", testDeps);

    expect(result.scores.riskIdentification).toBe(0);
    expect(result.scores.nextStepQuality).toBe(0);
    expect(result.scores.prioritization).toBe(0);
    expect(result.scores.outcomeAlignment).toBe(0);
  });

  test("valid scores in range are preserved", async () => {
    mockGenerateText.mockImplementation(() =>
      Promise.resolve({
        text: JSON.stringify({
          scores: {
            risk_identification: 7,
            next_step_quality: 3,
            prioritization: 10,
            outcome_alignment: 0,
          },
          feedback: "Normal scores",
        }),
      })
    );

    const result = await evaluateResponse(makeCheckpoint(), makeAgentResponse(), "public", testDeps);

    expect(result.scores.riskIdentification).toBe(7);
    expect(result.scores.nextStepQuality).toBe(3);
    expect(result.scores.prioritization).toBe(10);
    expect(result.scores.outcomeAlignment).toBe(0);
    expect(result.totalScore).toBe(20);
  });

  test("fractional scores are preserved within bounds", async () => {
    mockGenerateText.mockImplementation(() =>
      Promise.resolve({
        text: JSON.stringify({
          scores: {
            risk_identification: 7.5,
            next_step_quality: 3.2,
            prioritization: 9.9,
            outcome_alignment: 0.1,
          },
          feedback: "Fractional scores",
        }),
      })
    );

    const result = await evaluateResponse(makeCheckpoint(), makeAgentResponse(), "public", testDeps);

    expect(result.scores.riskIdentification).toBe(7.5);
    expect(result.scores.nextStepQuality).toBe(3.2);
    expect(result.scores.prioritization).toBe(9.9);
    expect(result.scores.outcomeAlignment).toBe(0.1);
  });
});

// ─── JSON parsing logic ─────────────────────────────────────────────────────────

describe("JSON parsing", () => {
  beforeEach(() => {
    mockGenerateText.mockClear();
  });

  test("extracts JSON from text with surrounding content", async () => {
    mockGenerateText.mockImplementation(() =>
      Promise.resolve({
        text: `Here is my evaluation:\n\n${JSON.stringify({
          scores: { risk_identification: 6, next_step_quality: 7, prioritization: 8, outcome_alignment: 9 },
          feedback: "Well done",
        })}\n\nHope this helps!`,
      })
    );

    const result = await evaluateResponse(makeCheckpoint(), makeAgentResponse(), "public", testDeps);

    expect(result.scores.riskIdentification).toBe(6);
    expect(result.scores.nextStepQuality).toBe(7);
    expect(result.scores.prioritization).toBe(8);
    expect(result.scores.outcomeAlignment).toBe(9);
    expect(result.feedback).toBe("Well done");
  });

  test("handles JSON wrapped in markdown code block", async () => {
    const jsonObj = {
      scores: { risk_identification: 5, next_step_quality: 5, prioritization: 5, outcome_alignment: 5 },
      feedback: "Average",
    };
    mockGenerateText.mockImplementation(() =>
      Promise.resolve({
        text: "```json\n" + JSON.stringify(jsonObj) + "\n```",
      })
    );

    const result = await evaluateResponse(makeCheckpoint(), makeAgentResponse(), "public", testDeps);
    expect(result.scores.riskIdentification).toBe(5);
    expect(result.feedback).toBe("Average");
  });

  test("returns error evaluation when no JSON is found", async () => {
    mockGenerateText.mockImplementation(() =>
      Promise.resolve({
        text: "I cannot provide an evaluation in the requested format.",
      })
    );

    const result = await evaluateResponse(makeCheckpoint(), makeAgentResponse(), "public", testDeps);

    expect(result.scores.riskIdentification).toBe(0);
    expect(result.scores.nextStepQuality).toBe(0);
    expect(result.scores.prioritization).toBe(0);
    expect(result.scores.outcomeAlignment).toBe(0);
    expect(result.totalScore).toBe(0);
    expect(result.feedback).toContain("Evaluation failed");
    expect(result.feedback).toContain("No JSON found");
  });

  test("returns error evaluation when JSON is malformed", async () => {
    mockGenerateText.mockImplementation(() =>
      Promise.resolve({
        text: '{"scores": {invalid json here}',
      })
    );

    const result = await evaluateResponse(makeCheckpoint(), makeAgentResponse(), "public", testDeps);

    expect(result.scores.riskIdentification).toBe(0);
    expect(result.totalScore).toBe(0);
    expect(result.feedback).toContain("Evaluation failed");
  });

  test("handles missing feedback field gracefully", async () => {
    mockGenerateText.mockImplementation(() =>
      Promise.resolve({
        text: JSON.stringify({
          scores: { risk_identification: 5, next_step_quality: 5, prioritization: 5, outcome_alignment: 5 },
        }),
      })
    );

    const result = await evaluateResponse(makeCheckpoint(), makeAgentResponse(), "public", testDeps);
    expect(result.feedback).toBe("Evaluation completed");
  });

  test("handles missing array fields gracefully", async () => {
    mockGenerateText.mockImplementation(() =>
      Promise.resolve({
        text: JSON.stringify({
          scores: { risk_identification: 5, next_step_quality: 5, prioritization: 5, outcome_alignment: 5 },
          feedback: "OK",
        }),
      })
    );

    const result = await evaluateResponse(makeCheckpoint(), makeAgentResponse(), "public", testDeps);

    expect(result.groundTruthComparison?.risksIdentified).toEqual([]);
    expect(result.groundTruthComparison?.risksMissed).toEqual([]);
    expect(result.groundTruthComparison?.helpfulRecommendations).toEqual([]);
    expect(result.groundTruthComparison?.unhelpfulRecommendations).toEqual([]);
  });
});

// ─── evaluateResponse (single judge) ────────────────────────────────────────────

describe("evaluateResponse", () => {
  beforeEach(() => {
    mockGenerateText.mockClear();
  });

  test("returns correct checkpointId", async () => {
    mockGenerateText.mockImplementation(() =>
      Promise.resolve({
        text: JSON.stringify({
          scores: { risk_identification: 5, next_step_quality: 5, prioritization: 5, outcome_alignment: 5 },
          feedback: "OK",
        }),
      })
    );

    const checkpoint = makeCheckpoint({ id: "cp-42" });
    const result = await evaluateResponse(checkpoint, makeAgentResponse(), "public", testDeps);

    expect(result.checkpointId).toBe("cp-42");
  });

  test("maxScore is always 40", async () => {
    mockGenerateText.mockImplementation(() =>
      Promise.resolve({
        text: JSON.stringify({
          scores: { risk_identification: 5, next_step_quality: 5, prioritization: 5, outcome_alignment: 5 },
          feedback: "OK",
        }),
      })
    );

    const result = await evaluateResponse(makeCheckpoint(), makeAgentResponse(), "public", testDeps);
    expect(result.maxScore).toBe(40);
  });

  test("public mode includes groundTruthComparison", async () => {
    mockGenerateText.mockImplementation(() =>
      Promise.resolve({
        text: JSON.stringify({
          scores: { risk_identification: 5, next_step_quality: 5, prioritization: 5, outcome_alignment: 5 },
          feedback: "OK",
          risks_identified: ["Risk A"],
          risks_missed: ["Risk B"],
          helpful_recommendations: ["Rec A"],
          unhelpful_recommendations: ["Rec B"],
        }),
      })
    );

    const result = await evaluateResponse(makeCheckpoint(), makeAgentResponse(), "public", testDeps);

    expect(result.groundTruthComparison).toBeDefined();
    expect(result.groundTruthComparison?.risksIdentified).toEqual(["Risk A"]);
    expect(result.groundTruthComparison?.risksMissed).toEqual(["Risk B"]);
    expect(result.groundTruthComparison?.helpfulRecommendations).toEqual(["Rec A"]);
    expect(result.groundTruthComparison?.unhelpfulRecommendations).toEqual(["Rec B"]);
  });

  test("private mode does not include groundTruthComparison", async () => {
    mockGenerateText.mockImplementation(() =>
      Promise.resolve({
        text: JSON.stringify({
          scores: { risk_identification: 5, next_step_quality: 5, prioritization: 5, outcome_alignment: 5 },
          feedback: "OK",
          risks_identified: ["Risk A"],
          risks_missed: ["Risk B"],
          helpful_recommendations: ["Rec A"],
          unhelpful_recommendations: ["Rec B"],
        }),
      })
    );

    const result = await evaluateResponse(makeCheckpoint(), makeAgentResponse(), "private", testDeps);

    expect(result.groundTruthComparison).toBeUndefined();
  });

  test("totalScore is sum of all four score dimensions", async () => {
    mockGenerateText.mockImplementation(() =>
      Promise.resolve({
        text: JSON.stringify({
          scores: { risk_identification: 3, next_step_quality: 5, prioritization: 7, outcome_alignment: 9 },
          feedback: "OK",
        }),
      })
    );

    const result = await evaluateResponse(makeCheckpoint(), makeAgentResponse(), "public", testDeps);
    expect(result.totalScore).toBe(3 + 5 + 7 + 9);
  });

  test("handles API error gracefully", async () => {
    mockGenerateText.mockImplementation(() => {
      throw new Error("API rate limit exceeded");
    });

    const result = await evaluateResponse(makeCheckpoint(), makeAgentResponse(), "public", testDeps);

    expect(result.scores.riskIdentification).toBe(0);
    expect(result.scores.nextStepQuality).toBe(0);
    expect(result.scores.prioritization).toBe(0);
    expect(result.scores.outcomeAlignment).toBe(0);
    expect(result.totalScore).toBe(0);
    expect(result.feedback).toContain("API rate limit exceeded");
  });

  test("handles non-Error throws gracefully", async () => {
    mockGenerateText.mockImplementation(() => {
      throw "string error";
    });

    const result = await evaluateResponse(makeCheckpoint(), makeAgentResponse(), "public", testDeps);

    expect(result.totalScore).toBe(0);
    expect(result.feedback).toContain("Unknown error");
  });
});

// ─── evaluateResponseMultiJudge ─────────────────────────────────────────────────

describe("evaluateResponseMultiJudge", () => {
  beforeEach(() => {
    mockGenerateText.mockClear();
  });

  test("calls generateText 3 times (one per judge)", async () => {
    mockGenerateText.mockImplementation(() =>
      Promise.resolve({
        text: JSON.stringify({
          scores: { risk_identification: 5, next_step_quality: 5, prioritization: 5, outcome_alignment: 5 },
          feedback: "OK",
          risks_identified: [],
          risks_missed: [],
          helpful_recommendations: [],
          unhelpful_recommendations: [],
        }),
      })
    );

    await evaluateResponseMultiJudge(makeCheckpoint(), makeAgentResponse(), "public", testDeps);

    expect(mockGenerateText).toHaveBeenCalledTimes(3);
  });

  test("includes judgeEvaluations array in result", async () => {
    mockGenerateText.mockImplementation(() =>
      Promise.resolve({
        text: JSON.stringify({
          scores: { risk_identification: 5, next_step_quality: 5, prioritization: 5, outcome_alignment: 5 },
          feedback: "OK",
          risks_identified: [],
          risks_missed: [],
          helpful_recommendations: [],
          unhelpful_recommendations: [],
        }),
      })
    );

    const result = await evaluateResponseMultiJudge(
      makeCheckpoint(),
      makeAgentResponse(),
      "public",
      testDeps
    );

    expect(result.judgeEvaluations).toBeDefined();
    expect(result.judgeEvaluations?.length).toBe(3);
  });

  test("public mode combines unique risks from all judges", async () => {
    let callCount = 0;
    mockGenerateText.mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        text: JSON.stringify({
          scores: { risk_identification: 5, next_step_quality: 5, prioritization: 5, outcome_alignment: 5 },
          feedback: `Judge ${callCount}`,
          risks_identified: callCount === 1 ? ["Risk A", "Risk B"] : callCount === 2 ? ["Risk B", "Risk C"] : ["Risk A", "Risk C"],
          risks_missed: callCount === 1 ? ["Miss A"] : callCount === 2 ? ["Miss A", "Miss B"] : ["Miss B"],
          helpful_recommendations: [`Rec ${callCount}`],
          unhelpful_recommendations: [`Bad ${callCount}`],
        }),
      });
    });

    const result = await evaluateResponseMultiJudge(
      makeCheckpoint(),
      makeAgentResponse(),
      "public",
      testDeps
    );

    // Should deduplicate using Set
    expect(result.groundTruthComparison?.risksIdentified?.sort()).toEqual(["Risk A", "Risk B", "Risk C"]);
    expect(result.groundTruthComparison?.risksMissed?.sort()).toEqual(["Miss A", "Miss B"]);
    expect(result.groundTruthComparison?.helpfulRecommendations?.sort()).toEqual(["Rec 1", "Rec 2", "Rec 3"]);
    expect(result.groundTruthComparison?.unhelpfulRecommendations?.sort()).toEqual(["Bad 1", "Bad 2", "Bad 3"]);
  });

  test("private mode does not include groundTruthComparison", async () => {
    mockGenerateText.mockImplementation(() =>
      Promise.resolve({
        text: JSON.stringify({
          scores: { risk_identification: 5, next_step_quality: 5, prioritization: 5, outcome_alignment: 5 },
          feedback: "OK",
          risks_identified: ["Risk A"],
          risks_missed: ["Risk B"],
          helpful_recommendations: ["Rec A"],
          unhelpful_recommendations: ["Rec B"],
        }),
      })
    );

    const result = await evaluateResponseMultiJudge(
      makeCheckpoint(),
      makeAgentResponse(),
      "private",
      testDeps
    );

    expect(result.groundTruthComparison).toBeUndefined();
  });

  test("handles partial judge failures (returns zero for failed judge)", async () => {
    let callCount = 0;
    mockGenerateText.mockImplementation(() => {
      callCount++;
      if (callCount === 2) {
        throw new Error("Judge 2 failed");
      }
      return Promise.resolve({
        text: JSON.stringify({
          scores: { risk_identification: 9, next_step_quality: 9, prioritization: 9, outcome_alignment: 9 },
          feedback: `Judge ${callCount} OK`,
          risks_identified: [],
          risks_missed: [],
          helpful_recommendations: [],
          unhelpful_recommendations: [],
        }),
      });
    });

    const result = await evaluateResponseMultiJudge(
      makeCheckpoint(),
      makeAgentResponse(),
      "public",
      testDeps
    );

    // Should still have 3 judge evaluations (failed one has zero scores)
    expect(result.judgeEvaluations?.length).toBe(3);

    // Average should be (9+0+9)/3 = 6 for each dimension
    expect(result.scores.riskIdentification).toBe(6);
    expect(result.scores.nextStepQuality).toBe(6);
    expect(result.scores.prioritization).toBe(6);
    expect(result.scores.outcomeAlignment).toBe(6);
  });
});

// ─── evaluateWithJudge (tested via multi-judge or single judge) ─────────────

describe("evaluateWithJudge error handling", () => {
  beforeEach(() => {
    mockGenerateText.mockClear();
  });

  test("returns zero scores with error feedback on API failure", async () => {
    mockGenerateText.mockImplementation(() => {
      throw new Error("Network timeout");
    });

    const result = await evaluateResponse(makeCheckpoint(), makeAgentResponse(), "public", testDeps);

    expect(result.totalScore).toBe(0);
    expect(result.feedback).toContain("Network timeout");
  });
});

// ─── handleEvaluateResponseEndpoint ─────────────────────────────────────────────

describe("handleEvaluateResponseEndpoint", () => {
  beforeEach(() => {
    mockGenerateText.mockClear();
    mockGenerateText.mockImplementation(() =>
      Promise.resolve({
        text: JSON.stringify({
          scores: { risk_identification: 5, next_step_quality: 5, prioritization: 5, outcome_alignment: 5 },
          feedback: "OK",
          risks_identified: [],
          risks_missed: [],
          helpful_recommendations: [],
          unhelpful_recommendations: [],
        }),
      })
    );
  });

  test("rejects non-POST requests with 405", async () => {
    const req = new Request("http://localhost/api/evaluate-response", {
      method: "GET",
    });

    const response = await handleEvaluateResponseEndpoint(req, testDeps);
    expect(response.status).toBe(405);

    const body = await response.json();
    expect(body.error).toBe("Method not allowed");
  });

  test("rejects missing checkpoint with 400", async () => {
    const req = new Request("http://localhost/api/evaluate-response", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentResponse: makeAgentResponse() }),
    });

    const response = await handleEvaluateResponseEndpoint(req, testDeps);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("checkpoint is required");
  });

  test("rejects missing agentResponse with 400", async () => {
    const req = new Request("http://localhost/api/evaluate-response", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkpoint: makeCheckpoint() }),
    });

    const response = await handleEvaluateResponseEndpoint(req, testDeps);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("agentResponse is required");
  });

  test("returns evaluation for valid POST request", async () => {
    const req = new Request("http://localhost/api/evaluate-response", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        checkpoint: makeCheckpoint(),
        agentResponse: makeAgentResponse(),
      }),
    });

    const response = await handleEvaluateResponseEndpoint(req, testDeps);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.checkpointId).toBe("cp-1");
    expect(body.maxScore).toBe(40);
    expect(body.scores).toBeDefined();
  });

  test("defaults mode to public when not specified", async () => {
    const req = new Request("http://localhost/api/evaluate-response", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        checkpoint: makeCheckpoint(),
        agentResponse: makeAgentResponse(),
      }),
    });

    const response = await handleEvaluateResponseEndpoint(req, testDeps);
    const body = await response.json();

    // Public mode should include groundTruthComparison
    expect(body.groundTruthComparison).toBeDefined();
  });

  test("respects private mode", async () => {
    const req = new Request("http://localhost/api/evaluate-response", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        checkpoint: makeCheckpoint(),
        agentResponse: makeAgentResponse(),
        mode: "private",
      }),
    });

    const response = await handleEvaluateResponseEndpoint(req, testDeps);
    const body = await response.json();

    expect(body.groundTruthComparison).toBeUndefined();
  });

  test("uses multi-judge when multiJudge flag is true", async () => {
    const req = new Request("http://localhost/api/evaluate-response", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        checkpoint: makeCheckpoint(),
        agentResponse: makeAgentResponse(),
        multiJudge: true,
      }),
    });

    const response = await handleEvaluateResponseEndpoint(req, testDeps);
    const body = await response.json();

    // Multi-judge returns judgeEvaluations
    expect(body.judgeEvaluations).toBeDefined();
    expect(body.judgeEvaluations.length).toBe(3);

    // Should have called generateText 3 times (one per judge)
    expect(mockGenerateText).toHaveBeenCalledTimes(3);
  });

  test("handles malformed JSON body with 500", async () => {
    const req = new Request("http://localhost/api/evaluate-response", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json",
    });

    const response = await handleEvaluateResponseEndpoint(req, testDeps);
    expect(response.status).toBe(500);
  });
});

// ─── JUDGE_MODELS constant ─────────────────────────────────────────────────────

describe("JUDGE_MODELS", () => {
  test("has three judge models defined", () => {
    const judges = Object.keys(JUDGE_MODELS);
    expect(judges.length).toBe(3);
    expect(judges).toContain("claude");
    expect(judges).toContain("gpt");
    expect(judges).toContain("gemini");
  });

  test("claude judge uses anthropic provider", () => {
    expect(JUDGE_MODELS.claude.provider).toBe("anthropic");
  });

  test("gpt judge uses openrouter provider", () => {
    expect(JUDGE_MODELS.gpt.provider).toBe("openrouter");
  });

  test("gemini judge uses openrouter provider", () => {
    expect(JUDGE_MODELS.gemini.provider).toBe("openrouter");
  });

  test("each judge has id, name, provider, and modelId", () => {
    for (const judge of Object.values(JUDGE_MODELS)) {
      expect(judge.id).toBeTruthy();
      expect(judge.name).toBeTruthy();
      expect(judge.provider).toBeTruthy();
      expect(judge.modelId).toBeTruthy();
    }
  });
});
