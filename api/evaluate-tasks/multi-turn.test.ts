import { test, expect, describe, mock } from "bun:test";
import { MultiTurnOrchestrator, type MultiTurnDeps } from "./multi-turn";
import type {
  V2Checkpoint,
  V2AgentRequest,
  V2AgentResponse,
  EvaluationTask,
  Artifact,
  TranscriptArtifact,
  CrmSnapshotArtifact,
  EmailArtifact,
} from "../../src/types/benchmark-v2";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeTranscript = (id: string): TranscriptArtifact => ({
  id,
  dealId: "deal-1",
  type: "transcript",
  title: `Call ${id}`,
  rawText: "raw",
  turns: [{ speaker: "me", text: "Hello" }],
  attendees: ["Alice"],
  date: "2025-01-15",
  createdAt: "2025-01-15",
  anonymized: true,
});

const makeCrm = (id: string): CrmSnapshotArtifact => ({
  id,
  dealId: "deal-1",
  type: "crm_snapshot",
  dealProperties: { stage: "Negotiation" },
  contacts: [{ name: "Bob", role: "champion" }],
  notes: ["Good engagement"],
  activityLog: [{ date: "2025-01-15", type: "call", description: "Intro call" }],
  createdAt: "2025-01-15",
  anonymized: true,
});

const makeEmail = (id: string): EmailArtifact => ({
  id,
  dealId: "deal-1",
  type: "email",
  subject: "Follow-up",
  messages: [{ from: "me@co.com", to: ["them@co.com"], date: "2025-01-16", body: "Thanks" }],
  participants: ["me@co.com", "them@co.com"],
  createdAt: "2025-01-16",
  anonymized: true,
});

const allArtifacts: Record<string, Artifact> = {
  "t1": makeTranscript("t1"),
  "t2": makeTranscript("t2"),
  "crm1": makeCrm("crm1"),
  "email1": makeEmail("email1"),
};

const checkpoint: V2Checkpoint = {
  id: "cp-1",
  dealId: "deal-1",
  version: 2,
  timestamp: "2025-01-15",
  availableArtifacts: [],
  dealSnapshot: { company: "Acme", stage: "Negotiation", daysSinceFirstContact: 30 },
  stakeholders: [{ name: "Bob", role: "champion", sentiment: "positive" }],
  groundTruth: {
    whatHappenedNext: "Deal progressed",
    actualRisksThatMaterialized: [],
    outcomeAtThisPoint: "progressing",
  },
  tasks: [],
};

const task: EvaluationTask = {
  id: "task-1",
  type: "deal_analysis",
  prompt: "Analyze this deal",
  requiredArtifacts: ["t1", "crm1"],
  optionalArtifacts: ["t2", "email1"],
  scoringDimensions: ["riskIdentification", "nextStepQuality"],
  maxTurns: 3,
};

function makeResponse(opts: Partial<V2AgentResponse> = {}): V2AgentResponse {
  return {
    version: 2,
    reasoning: "Analysis complete",
    answer: "The deal looks good",
    isComplete: true,
    confidence: 0.8,
    ...opts,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MultiTurnOrchestrator", () => {
  test("single-turn: agent completes on first call", async () => {
    const callAgent = mock(async (_req: V2AgentRequest) => makeResponse());

    const orchestrator = new MultiTurnOrchestrator(checkpoint, task, allArtifacts, { callAgent });
    const result = await orchestrator.execute();

    expect(result.turnsUsed).toBe(1);
    expect(result.finalResponse.isComplete).toBe(true);
    expect(result.artifactsRequested).toEqual([]);
    expect(result.turnHistory).toHaveLength(1);

    // Check initial request included required artifacts
    const req = callAgent.mock.calls[0]![0];
    expect(req.turnNumber).toBe(1);
    expect(req.artifacts).toHaveLength(2); // t1 + crm1
    expect(req.artifacts.map((a: Artifact) => a.id).sort()).toEqual(["crm1", "t1"]);
  });

  test("multi-turn: agent requests optional artifacts", async () => {
    let callCount = 0;
    const callAgent = mock(async (_req: V2AgentRequest) => {
      callCount++;
      if (callCount === 1) {
        return makeResponse({
          isComplete: false,
          artifactRequests: ["t2"],
        });
      }
      return makeResponse();
    });

    const orchestrator = new MultiTurnOrchestrator(checkpoint, task, allArtifacts, { callAgent });
    const result = await orchestrator.execute();

    expect(result.turnsUsed).toBe(2);
    expect(result.artifactsRequested).toEqual(["t2"]);
    expect(result.turnHistory).toHaveLength(2);

    // Second call should have t1 + crm1 + t2
    const secondReq = callAgent.mock.calls[1]![0];
    expect(secondReq.turnNumber).toBe(2);
    expect(secondReq.artifacts).toHaveLength(3);
  });

  test("multi-turn: respects maxTurns limit", async () => {
    const callAgent = mock(async (_req: V2AgentRequest) =>
      makeResponse({
        isComplete: false,
        artifactRequests: ["t2", "email1"],
      })
    );

    const limitedTask: EvaluationTask = { ...task, maxTurns: 2 };
    const orchestrator = new MultiTurnOrchestrator(checkpoint, limitedTask, allArtifacts, { callAgent });
    const result = await orchestrator.execute();

    expect(result.turnsUsed).toBe(2);
    expect(callAgent.mock.calls).toHaveLength(2);
  });

  test("filters out artifacts not in optionalArtifacts", async () => {
    let callCount = 0;
    const callAgent = mock(async (_req: V2AgentRequest) => {
      callCount++;
      if (callCount === 1) {
        return makeResponse({
          isComplete: false,
          artifactRequests: ["nonexistent-artifact"],
        });
      }
      return makeResponse();
    });

    const orchestrator = new MultiTurnOrchestrator(checkpoint, task, allArtifacts, { callAgent });
    const result = await orchestrator.execute();

    // Should complete on turn 1 since the requested artifact isn't available
    expect(result.turnsUsed).toBe(1);
    expect(result.artifactsRequested).toEqual([]);
  });

  test("does not provide already-provided artifacts again", async () => {
    let callCount = 0;
    const callAgent = mock(async (_req: V2AgentRequest) => {
      callCount++;
      if (callCount === 1) {
        return makeResponse({
          isComplete: false,
          artifactRequests: ["t2"],
        });
      }
      if (callCount === 2) {
        // Request t2 again (already provided) and email1 (new)
        return makeResponse({
          isComplete: false,
          artifactRequests: ["t2", "email1"],
        });
      }
      return makeResponse();
    });

    const orchestrator = new MultiTurnOrchestrator(checkpoint, task, allArtifacts, { callAgent });
    const result = await orchestrator.execute();

    expect(result.turnsUsed).toBe(3);
    // t2 should only appear once in artifactsRequested, email1 once
    expect(result.artifactsRequested).toEqual(["t2", "email1"]);
  });

  test("default maxTurns is 3 when not specified on task", async () => {
    // Add more optional artifacts so the agent can request across 3 turns
    const extendedArtifacts: Record<string, Artifact> = {
      ...allArtifacts,
      "t3": makeTranscript("t3"),
      "email2": makeEmail("email2"),
    };
    const taskNoMax: EvaluationTask = {
      ...task,
      maxTurns: undefined,
      optionalArtifacts: ["t2", "email1", "t3", "email2"],
    };

    let callCount = 0;
    const callAgent = mock(async (_req: V2AgentRequest) => {
      callCount++;
      if (callCount === 1) {
        return makeResponse({ isComplete: false, artifactRequests: ["t2"] });
      }
      if (callCount === 2) {
        return makeResponse({ isComplete: false, artifactRequests: ["email1"] });
      }
      // Turn 3: still not done, but maxTurns reached
      return makeResponse({ isComplete: false, artifactRequests: ["t3"] });
    });

    const orchestrator = new MultiTurnOrchestrator(checkpoint, taskNoMax, extendedArtifacts, { callAgent });
    const result = await orchestrator.execute();

    // Default is 3 turns
    expect(result.turnsUsed).toBe(3);
    expect(callAgent.mock.calls).toHaveLength(3);
  });

  test("handles agent with empty artifactRequests as complete", async () => {
    const callAgent = mock(async (_req: V2AgentRequest) =>
      makeResponse({
        isComplete: false,
        artifactRequests: [],
      })
    );

    const orchestrator = new MultiTurnOrchestrator(checkpoint, task, allArtifacts, { callAgent });
    const result = await orchestrator.execute();

    expect(result.turnsUsed).toBe(1);
    expect(callAgent.mock.calls).toHaveLength(1);
  });

  test("resolves only artifacts that exist in allArtifacts", async () => {
    const sparseArtifacts: Record<string, Artifact> = {
      "t1": makeTranscript("t1"),
      // crm1 is missing
    };

    const callAgent = mock(async (_req: V2AgentRequest) => makeResponse());
    const orchestrator = new MultiTurnOrchestrator(checkpoint, task, sparseArtifacts, { callAgent });
    const result = await orchestrator.execute();

    // Only t1 should be provided (crm1 missing from pool)
    const req = callAgent.mock.calls[0]![0];
    expect(req.artifacts).toHaveLength(1);
    expect(req.artifacts[0]!.id).toBe("t1");
    expect(result.turnsUsed).toBe(1);
  });

  test("passes correct checkpoint fields in request", async () => {
    const callAgent = mock(async (_req: V2AgentRequest) => makeResponse());

    const orchestrator = new MultiTurnOrchestrator(checkpoint, task, allArtifacts, { callAgent });
    await orchestrator.execute();

    const req = callAgent.mock.calls[0]![0];
    expect(req.version).toBe(2);
    expect(req.checkpointId).toBe("cp-1");
    expect(req.taskId).toBe("task-1");
    expect(req.taskType).toBe("deal_analysis");
    expect(req.prompt).toBe("Analyze this deal");
    expect(req.dealSnapshot.company).toBe("Acme");
    expect(req.stakeholders).toHaveLength(1);
    expect(req.maxTurns).toBe(3);
  });
});
