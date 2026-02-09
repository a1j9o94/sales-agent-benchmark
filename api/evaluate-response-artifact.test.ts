import { test, expect, describe, mock } from "bun:test";
import {
  evaluateArtifactTask,
  handleEvaluateArtifactEndpoint,
  type EvaluateArtifactDeps,
} from "./evaluate-response-artifact";
import type {
  EvaluationTask,
  ArtifactAgentResponse,
  ArtifactGroundTruth,
  Artifact,
  TranscriptArtifact,
  CrmSnapshotArtifact,
} from "../src/types/benchmark-artifact";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const transcript: TranscriptArtifact = {
  id: "t1",
  dealId: "deal-1",
  type: "transcript",
  title: "Discovery Call",
  rawText: "raw",
  turns: [
    { speaker: "me", text: "Tell me about your challenges" },
    { speaker: "them", text: "We need better analytics" },
  ],
  attendees: ["Alice", "Bob"],
  date: "2025-01-15",
  createdAt: "2025-01-15",
  anonymized: true,
};

const crmSnapshot: CrmSnapshotArtifact = {
  id: "crm1",
  dealId: "deal-1",
  type: "crm_snapshot",
  dealProperties: { stage: "Negotiation", amount: "$50k", closeDate: "2025-03-01" },
  contacts: [{ name: "Bob", title: "VP Engineering", role: "champion" }],
  notes: ["Strong technical fit"],
  activityLog: [
    { date: "2025-01-15", type: "call", description: "Discovery call" },
    { date: "2025-01-20", type: "email", description: "Follow-up sent" },
  ],
  createdAt: "2025-01-15",
  anonymized: true,
};

const artifacts: Artifact[] = [transcript, crmSnapshot];

const groundTruth: ArtifactGroundTruth = {
  whatHappenedNext: "Champion went silent for 2 weeks, deal stalled due to budget freeze",
  actualRisksThatMaterialized: ["Budget freeze", "Champion went dark"],
  outcomeAtThisPoint: "stalled",
  keyInsights: ["Should have multi-threaded earlier"],
};

const agentResponse: ArtifactAgentResponse = {
  version: 2,
  reasoning: "Based on transcript analysis, the deal has momentum but risks around budget timing",
  answer: "Deal is progressing but needs attention to budget concerns and champion engagement",
  isComplete: true,
  risks: [
    { description: "Budget may not be approved this quarter", severity: "high" },
    { description: "Only one champion, no multi-threading", severity: "medium" },
  ],
  nextSteps: [
    { action: "Schedule meeting with economic buyer", priority: 1, rationale: "Need budget authority" },
    { action: "Send ROI analysis", priority: 2 },
  ],
  confidence: 0.7,
};

// ---------------------------------------------------------------------------
// Mock deps
// ---------------------------------------------------------------------------

function makeMockDeps(judgeResponse: string): EvaluateArtifactDeps {
  const mockGenerateText = mock(async () => ({ text: judgeResponse }));
  const mockAnthropicProvider = mock(() => "mock-model");
  const mockOpenrouterProvider = mock(() => "mock-model");

  return {
    generateText: mockGenerateText as unknown as EvaluateArtifactDeps["generateText"],
    anthropic: mockAnthropicProvider as unknown as EvaluateArtifactDeps["anthropic"],
    openrouter: mockOpenrouterProvider as unknown as EvaluateArtifactDeps["openrouter"],
  };
}

// ---------------------------------------------------------------------------
// Tests: evaluateArtifactTask
// ---------------------------------------------------------------------------

describe("evaluateArtifactTask", () => {
  test("deal_analysis: parses scores from all 3 judges", async () => {
    const judgeJson = JSON.stringify({
      scores: {
        risk_identification: 8,
        next_step_quality: 7,
        prioritization: 6,
        outcome_alignment: 9,
        deal_qualification: 7,
      },
      feedback: "Good analysis with accurate risk identification",
    });

    const deps = makeMockDeps(judgeJson);

    const task: EvaluationTask = {
      id: "task-1",
      type: "deal_analysis",
      prompt: "Analyze this deal",
      requiredArtifacts: ["t1"],
      optionalArtifacts: ["crm1"],
      scoringDimensions: ["riskIdentification", "nextStepQuality", "prioritization", "outcomeAlignment", "dealQualification"],
    };

    const result = await evaluateArtifactTask(task, agentResponse, groundTruth, artifacts, 1, [], deps);

    expect(result.taskId).toBe("task-1");
    expect(result.taskType).toBe("deal_analysis");
    expect(result.turnsUsed).toBe(1);
    expect(result.scores.riskIdentification).toBe(8);
    expect(result.scores.nextStepQuality).toBe(7);
    expect(result.scores.prioritization).toBe(6);
    expect(result.scores.outcomeAlignment).toBe(9);
    expect(result.scores.dealQualification).toBe(7);
    expect(result.feedback).toContain("Good analysis");
    // 3 judges called
    expect((deps.generateText as ReturnType<typeof mock>).mock.calls).toHaveLength(3);
  });

  test("call_summary: routes to correct dimensions", async () => {
    const judgeJson = JSON.stringify({
      scores: {
        information_synthesis: 9,
        stakeholder_mapping: 8,
        prioritization: 7,
      },
      feedback: "Excellent synthesis",
    });

    const deps = makeMockDeps(judgeJson);

    const task: EvaluationTask = {
      id: "task-2",
      type: "call_summary",
      prompt: "Summarize this call",
      requiredArtifacts: ["t1"],
      optionalArtifacts: [],
      scoringDimensions: ["informationSynthesis", "stakeholderMapping", "prioritization"],
    };

    const result = await evaluateArtifactTask(task, agentResponse, groundTruth, artifacts, 1, [], deps);

    expect(result.taskType).toBe("call_summary");
    expect(result.scores.informationSynthesis).toBe(9);
    expect(result.scores.stakeholderMapping).toBe(8);
    expect(result.scores.prioritization).toBe(7);
  });

  test("follow_up_draft: routes to correct dimensions", async () => {
    const judgeJson = JSON.stringify({
      scores: {
        communication_quality: 8,
        next_step_quality: 7,
        outcome_alignment: 6,
      },
      feedback: "Good follow-up draft",
    });

    const deps = makeMockDeps(judgeJson);

    const task: EvaluationTask = {
      id: "task-3",
      type: "follow_up_draft",
      prompt: "Draft a follow-up email",
      requiredArtifacts: ["t1"],
      optionalArtifacts: [],
      scoringDimensions: ["communicationQuality", "nextStepQuality", "outcomeAlignment"],
    };

    const result = await evaluateArtifactTask(task, agentResponse, groundTruth, artifacts, 1, [], deps);

    expect(result.taskType).toBe("follow_up_draft");
    expect(result.scores.communicationQuality).toBe(8);
    expect(result.scores.nextStepQuality).toBe(7);
    expect(result.scores.outcomeAlignment).toBe(6);
  });

  test("stakeholder_analysis: routes to correct dimensions", async () => {
    const judgeJson = JSON.stringify({
      scores: {
        stakeholder_mapping: 9,
        deal_qualification: 8,
        information_synthesis: 7,
      },
      feedback: "Strong stakeholder mapping",
    });

    const deps = makeMockDeps(judgeJson);

    const task: EvaluationTask = {
      id: "task-4",
      type: "stakeholder_analysis",
      prompt: "Map the stakeholders",
      requiredArtifacts: ["t1", "crm1"],
      optionalArtifacts: [],
      scoringDimensions: ["stakeholderMapping", "dealQualification", "informationSynthesis"],
    };

    const result = await evaluateArtifactTask(task, agentResponse, groundTruth, artifacts, 1, [], deps);

    expect(result.taskType).toBe("stakeholder_analysis");
    expect(result.scores.stakeholderMapping).toBe(9);
    expect(result.scores.dealQualification).toBe(8);
    expect(result.scores.informationSynthesis).toBe(7);
  });

  test("clamps scores to 0-10 range", async () => {
    const judgeJson = JSON.stringify({
      scores: {
        risk_identification: 15,
        next_step_quality: -3,
        prioritization: 5,
        outcome_alignment: 7,
        deal_qualification: 11,
      },
      feedback: "Scores out of range",
    });

    const deps = makeMockDeps(judgeJson);

    const task: EvaluationTask = {
      id: "task-5",
      type: "deal_analysis",
      prompt: "Analyze",
      requiredArtifacts: [],
      optionalArtifacts: [],
      scoringDimensions: ["riskIdentification"],
    };

    const result = await evaluateArtifactTask(task, agentResponse, groundTruth, artifacts, 1, [], deps);

    expect(result.scores.riskIdentification).toBe(10); // clamped from 15
    expect(result.scores.nextStepQuality).toBe(0); // clamped from -3
    expect(result.scores.dealQualification).toBe(10); // clamped from 11
  });

  test("handles judge failure gracefully with zero scores", async () => {
    const mockGenerateText = mock(async () => {
      throw new Error("API timeout");
    });
    const mockAnthropicProvider = mock(() => "mock-model");
    const mockOpenrouterProvider = mock(() => "mock-model");

    const deps: EvaluateArtifactDeps = {
      generateText: mockGenerateText as unknown as EvaluateArtifactDeps["generateText"],
      anthropic: mockAnthropicProvider as unknown as EvaluateArtifactDeps["anthropic"],
      openrouter: mockOpenrouterProvider as unknown as EvaluateArtifactDeps["openrouter"],
    };

    const task: EvaluationTask = {
      id: "task-6",
      type: "deal_analysis",
      prompt: "Analyze",
      requiredArtifacts: [],
      optionalArtifacts: [],
      scoringDimensions: ["riskIdentification"],
    };

    const result = await evaluateArtifactTask(task, agentResponse, groundTruth, artifacts, 1, [], deps);

    expect(result.scores.riskIdentification).toBe(0);
    expect(result.scores.outcomeAlignment).toBe(0);
    expect(result.feedback).toContain("Evaluation failed");
  });

  test("averages scores across judges when they differ", async () => {
    let callCount = 0;
    const mockGenerateText = mock(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          text: JSON.stringify({
            scores: { risk_identification: 6, next_step_quality: 8, prioritization: 4, outcome_alignment: 7, deal_qualification: 5 },
            feedback: "Judge 1",
          }),
        };
      }
      if (callCount === 2) {
        return {
          text: JSON.stringify({
            scores: { risk_identification: 8, next_step_quality: 6, prioritization: 8, outcome_alignment: 5, deal_qualification: 7 },
            feedback: "Judge 2",
          }),
        };
      }
      return {
        text: JSON.stringify({
          scores: { risk_identification: 7, next_step_quality: 7, prioritization: 6, outcome_alignment: 6, deal_qualification: 6 },
          feedback: "Judge 3",
        }),
      };
    });

    const deps: EvaluateArtifactDeps = {
      generateText: mockGenerateText as unknown as EvaluateArtifactDeps["generateText"],
      anthropic: mock(() => "mock-model") as unknown as EvaluateArtifactDeps["anthropic"],
      openrouter: mock(() => "mock-model") as unknown as EvaluateArtifactDeps["openrouter"],
    };

    const task: EvaluationTask = {
      id: "task-7",
      type: "deal_analysis",
      prompt: "Analyze",
      requiredArtifacts: [],
      optionalArtifacts: [],
      scoringDimensions: ["riskIdentification", "dealQualification"],
    };

    const result = await evaluateArtifactTask(task, agentResponse, groundTruth, artifacts, 1, [], deps);

    // Average of (6+8+7)/3 = 7.0
    expect(result.scores.riskIdentification).toBe(7);
    // Average of (8+6+7)/3 = 7.0
    expect(result.scores.nextStepQuality).toBe(7);
    // Average of (5+7+6)/3 = 6.0
    expect(result.scores.dealQualification).toBe(6);
  });

  test("records multi-turn metadata", async () => {
    const judgeJson = JSON.stringify({
      scores: { risk_identification: 7, next_step_quality: 7, prioritization: 7, outcome_alignment: 7, deal_qualification: 7 },
      feedback: "Good",
    });

    const deps = makeMockDeps(judgeJson);

    const task: EvaluationTask = {
      id: "task-8",
      type: "deal_analysis",
      prompt: "Analyze",
      requiredArtifacts: [],
      optionalArtifacts: [],
      scoringDimensions: ["riskIdentification"],
    };

    const result = await evaluateArtifactTask(
      task, agentResponse, groundTruth, artifacts,
      3, ["t2", "email1"], deps
    );

    expect(result.turnsUsed).toBe(3);
    expect(result.artifactsRequested).toEqual(["t2", "email1"]);
  });

  test("unknown task type falls back to deal_analysis config", async () => {
    const judgeJson = JSON.stringify({
      scores: { risk_identification: 7, next_step_quality: 7, prioritization: 7, outcome_alignment: 7, deal_qualification: 7 },
      feedback: "Fallback evaluation",
    });

    const deps = makeMockDeps(judgeJson);

    const task: EvaluationTask = {
      id: "task-9",
      type: "risk_assessment" as any,
      prompt: "Assess risks",
      requiredArtifacts: [],
      optionalArtifacts: [],
      scoringDimensions: ["riskIdentification"],
    };

    const result = await evaluateArtifactTask(task, agentResponse, groundTruth, artifacts, 1, [], deps);

    // Should still work using deal_analysis fallback
    expect(result.scores.riskIdentification).toBe(7);
    expect(result.feedback).toContain("Fallback evaluation");
  });
});

// ---------------------------------------------------------------------------
// Tests: HTTP Handler
// ---------------------------------------------------------------------------

describe("handleEvaluateArtifactEndpoint", () => {
  test("rejects non-POST methods", async () => {
    const req = new Request("http://localhost/api/evaluate-artifact", { method: "GET" });
    const res = await handleEvaluateArtifactEndpoint(req);
    expect(res.status).toBe(405);
  });

  test("requires task field", async () => {
    const req = new Request("http://localhost/api/evaluate-artifact", {
      method: "POST",
      body: JSON.stringify({ agentResponse, groundTruth }),
    });
    const res = await handleEvaluateArtifactEndpoint(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("task");
  });

  test("requires agentResponse field", async () => {
    const task: EvaluationTask = {
      id: "task-1",
      type: "deal_analysis",
      prompt: "Analyze",
      requiredArtifacts: [],
      optionalArtifacts: [],
      scoringDimensions: [],
    };
    const req = new Request("http://localhost/api/evaluate-artifact", {
      method: "POST",
      body: JSON.stringify({ task, groundTruth }),
    });
    const res = await handleEvaluateArtifactEndpoint(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("agentResponse");
  });

  test("requires groundTruth field", async () => {
    const task: EvaluationTask = {
      id: "task-1",
      type: "deal_analysis",
      prompt: "Analyze",
      requiredArtifacts: [],
      optionalArtifacts: [],
      scoringDimensions: [],
    };
    const req = new Request("http://localhost/api/evaluate-artifact", {
      method: "POST",
      body: JSON.stringify({ task, agentResponse }),
    });
    const res = await handleEvaluateArtifactEndpoint(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("groundTruth");
  });

  test("successful evaluation via HTTP", async () => {
    const judgeJson = JSON.stringify({
      scores: { risk_identification: 8, next_step_quality: 7, prioritization: 6, outcome_alignment: 9, deal_qualification: 7 },
      feedback: "HTTP test",
    });
    const deps = makeMockDeps(judgeJson);

    const task: EvaluationTask = {
      id: "task-http",
      type: "deal_analysis",
      prompt: "Analyze",
      requiredArtifacts: [],
      optionalArtifacts: [],
      scoringDimensions: ["riskIdentification"],
    };

    const req = new Request("http://localhost/api/evaluate-artifact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task,
        agentResponse,
        groundTruth,
        artifacts,
        turnsUsed: 2,
        artifactsRequested: ["crm1"],
      }),
    });

    const res = await handleEvaluateArtifactEndpoint(req, deps);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.taskId).toBe("task-http");
    expect(json.turnsUsed).toBe(2);
    expect(json.artifactsRequested).toEqual(["crm1"]);
    expect(json.scores.riskIdentification).toBe(8);
  });
});
