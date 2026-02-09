import { test, expect, describe } from "bun:test";
import type {
  Artifact,
  ArtifactType,
  TranscriptArtifact,
  EmailArtifact,
  CrmSnapshotArtifact,
  DocumentArtifact,
  SlackThreadArtifact,
  CalendarEventArtifact,
  ArtifactCheckpoint,
  ArtifactDeal,
  EvaluationTask,
  ArtifactAgentRequest,
  ArtifactAgentResponse,
  ArtifactScoringDimensions,
  ArtifactBenchmarkResult,
  PipelineConfig,
  PipelineResult,
  PipelineSummary,
  DealClassification,
} from "./benchmark-artifact";
import { SUMMARY_DIMENSIONS, ARTIFACT_DIMENSIONS } from "./benchmark-artifact";

describe("Artifact-Based Benchmark Types", () => {
  test("SUMMARY_DIMENSIONS contains the 4 original dimensions", () => {
    expect(SUMMARY_DIMENSIONS).toEqual([
      "riskIdentification",
      "nextStepQuality",
      "prioritization",
      "outcomeAlignment",
    ]);
  });

  test("ARTIFACT_DIMENSIONS contains all 8 dimensions", () => {
    expect(ARTIFACT_DIMENSIONS).toHaveLength(8);
    expect(ARTIFACT_DIMENSIONS).toContain("stakeholderMapping");
    expect(ARTIFACT_DIMENSIONS).toContain("dealQualification");
    expect(ARTIFACT_DIMENSIONS).toContain("informationSynthesis");
    expect(ARTIFACT_DIMENSIONS).toContain("communicationQuality");
  });

  test("ARTIFACT_DIMENSIONS includes all SUMMARY dimensions", () => {
    for (const dim of SUMMARY_DIMENSIONS) {
      expect(ARTIFACT_DIMENSIONS).toContain(dim);
    }
  });

  test("TranscriptArtifact can be constructed with required fields", () => {
    const transcript: TranscriptArtifact = {
      id: "tx_001",
      dealId: "velocity-systems",
      type: "transcript",
      title: "Discovery Call",
      rawText: "Me: Hello\nThem: Hi there",
      turns: [
        { speaker: "me", text: "Hello" },
        { speaker: "them", text: "Hi there" },
      ],
      attendees: ["Alex", "Jordan"],
      date: "2026-01-15",
      createdAt: "2026-01-15T10:00:00Z",
      anonymized: true,
    };
    expect(transcript.type).toBe("transcript");
    expect(transcript.turns).toHaveLength(2);
  });

  test("EmailArtifact can be constructed", () => {
    const email: EmailArtifact = {
      id: "em_001",
      dealId: "velocity-systems",
      type: "email",
      subject: "Follow up on demo",
      messages: [
        {
          from: "Alex",
          to: ["Jordan"],
          date: "2026-01-16",
          body: "Thanks for the demo",
        },
      ],
      participants: ["Alex", "Jordan"],
      createdAt: "2026-01-16T10:00:00Z",
      anonymized: true,
    };
    expect(email.type).toBe("email");
  });

  test("CrmSnapshotArtifact can be constructed", () => {
    const crm: CrmSnapshotArtifact = {
      id: "crm_001",
      dealId: "velocity-systems",
      type: "crm_snapshot",
      dealProperties: {
        stage: "Discovery",
        amount: "$50-100K",
      },
      contacts: [{ name: "Jordan", title: "VP Sales", role: "champion" }],
      notes: ["Initial discovery complete"],
      activityLog: [
        { date: "2026-01-15", type: "call", description: "Discovery call" },
      ],
      createdAt: "2026-01-15T10:00:00Z",
      anonymized: true,
    };
    expect(crm.type).toBe("crm_snapshot");
    expect(crm.contacts).toHaveLength(1);
  });

  test("DocumentArtifact can be constructed", () => {
    const doc: DocumentArtifact = {
      id: "doc_001",
      dealId: "velocity-systems",
      type: "document",
      title: "Proposal v1",
      documentType: "docx",
      content: "Executive summary...",
      createdAt: "2026-01-17T10:00:00Z",
      anonymized: true,
    };
    expect(doc.type).toBe("document");
  });

  test("SlackThreadArtifact can be constructed", () => {
    const slack: SlackThreadArtifact = {
      id: "sl_001",
      dealId: "velocity-systems",
      type: "slack_thread",
      channel: "#deal-velocity",
      messages: [
        { author: "Alex", text: "Update on deal", timestamp: "2026-01-15T14:00:00Z" },
      ],
      createdAt: "2026-01-15T14:00:00Z",
      anonymized: true,
    };
    expect(slack.type).toBe("slack_thread");
  });

  test("CalendarEventArtifact can be constructed", () => {
    const event: CalendarEventArtifact = {
      id: "cal_001",
      dealId: "velocity-systems",
      type: "calendar_event",
      title: "Demo with VP",
      date: "2026-01-20T15:00:00Z",
      duration: 45,
      attendees: ["Alex", "Jordan", "Mike"],
      createdAt: "2026-01-20T10:00:00Z",
      anonymized: true,
    };
    expect(event.type).toBe("calendar_event");
  });

  test("Artifact union type discriminates correctly", () => {
    const artifacts: Artifact[] = [
      {
        id: "tx_001", dealId: "d1", type: "transcript", title: "Call",
        rawText: "", turns: [], attendees: [], date: "2026-01-15",
        createdAt: "2026-01-15T10:00:00Z", anonymized: true,
      },
      {
        id: "em_001", dealId: "d1", type: "email", subject: "Hi",
        messages: [], participants: [],
        createdAt: "2026-01-15T10:00:00Z", anonymized: true,
      },
    ];

    const types: ArtifactType[] = artifacts.map((a) => a.type);
    expect(types).toEqual(["transcript", "email"]);
  });

  test("ArtifactCheckpoint can be constructed with tasks", () => {
    const checkpoint: ArtifactCheckpoint = {
      id: "velocity-systems_cp_001",
      dealId: "velocity-systems",
      version: 2,
      timestamp: "2026-01-15",
      availableArtifacts: [
        { artifactId: "tx_001", type: "transcript", title: "Discovery Call", date: "2026-01-15" },
      ],
      dealSnapshot: {
        company: "Velocity Systems",
        stage: "Discovery",
        daysSinceFirstContact: 5,
      },
      stakeholders: [
        { name: "Jordan", role: "champion", sentiment: "positive" },
      ],
      groundTruth: {
        whatHappenedNext: "Demo scheduled",
        actualRisksThatMaterialized: [],
        outcomeAtThisPoint: "progressing",
      },
      tasks: [
        {
          id: "task_001",
          type: "deal_analysis",
          prompt: "Analyze this deal and identify risks",
          requiredArtifacts: ["tx_001"],
          optionalArtifacts: [],
          scoringDimensions: ["riskIdentification", "prioritization"],
        },
      ],
    };
    expect(checkpoint.version).toBe(2);
    expect(checkpoint.tasks).toHaveLength(1);
  });

  test("ArtifactDeal can be constructed with artifacts and checkpoints", () => {
    const deal: ArtifactDeal = {
      id: "velocity-systems",
      name: "Velocity Systems",
      version: 2,
      artifacts: {
        tx_001: {
          id: "tx_001", dealId: "velocity-systems", type: "transcript",
          title: "Discovery Call", rawText: "...", turns: [], attendees: [],
          date: "2026-01-15", createdAt: "2026-01-15T10:00:00Z", anonymized: true,
        },
      },
      checkpoints: [],
      finalOutcome: "active",
      metadata: {
        transcriptCount: 1,
        artifactCount: 1,
        dateRange: { start: "2026-01-15", end: "2026-01-15" },
      },
    };
    expect(deal.version).toBe(2);
    expect(Object.keys(deal.artifacts)).toHaveLength(1);
  });

  test("ArtifactAgentRequest and ArtifactAgentResponse have correct version", () => {
    const request: ArtifactAgentRequest = {
      version: 2,
      checkpointId: "cp_001",
      taskId: "task_001",
      taskType: "deal_analysis",
      prompt: "Analyze this deal",
      artifacts: [],
      dealSnapshot: { company: "Velocity", stage: "Discovery", daysSinceFirstContact: 5 },
      stakeholders: [],
      turnNumber: 1,
      maxTurns: 3,
    };
    expect(request.version).toBe(2);

    const response: ArtifactAgentResponse = {
      version: 2,
      reasoning: "Based on the transcript...",
      answer: "The deal is progressing well",
      isComplete: true,
      confidence: 0.85,
    };
    expect(response.version).toBe(2);
    expect(response.isComplete).toBe(true);
  });

  test("ArtifactScoringDimensions allows optional artifact dimensions", () => {
    // Summary-only scoring (artifact dimensions omitted)
    const summaryScores: ArtifactScoringDimensions = {
      riskIdentification: 8,
      nextStepQuality: 7,
      prioritization: 9,
      outcomeAlignment: 6,
    };
    expect(summaryScores.stakeholderMapping).toBeUndefined();

    // Full artifact scoring
    const artifactScores: ArtifactScoringDimensions = {
      riskIdentification: 8,
      nextStepQuality: 7,
      prioritization: 9,
      outcomeAlignment: 6,
      stakeholderMapping: 8,
      dealQualification: 7,
      informationSynthesis: 9,
      communicationQuality: 8,
    };
    expect(artifactScores.stakeholderMapping).toBe(8);
  });

  test("PipelineConfig supports all flags", () => {
    const config: PipelineConfig = {
      dealsDir: "/tmp/deals",
      outputDir: "/tmp/output",
      deals: ["flagship", "eaton-group"],
      skipExternal: true,
      dryRun: false,
      anonymize: true,
    };
    expect(config.deals).toHaveLength(2);
    expect(config.skipExternal).toBe(true);
  });

  test("DealClassification categorizes tiers", () => {
    const classifications: DealClassification[] = [
      { dealDir: "flagship", tier: "artifact-rich", transcriptCount: 11, hasContextMd: true, hasOutputs: true },
      { dealDir: "granola", tier: "artifact-standard", transcriptCount: 2, hasContextMd: true, hasOutputs: true },
      { dealDir: "hometime", tier: "summary-only", transcriptCount: 0, hasContextMd: true, hasOutputs: false },
    ];
    expect(classifications.filter((c) => c.tier === "artifact-rich")).toHaveLength(1);
    expect(classifications.filter((c) => c.tier === "artifact-standard")).toHaveLength(1);
    expect(classifications.filter((c) => c.tier === "summary-only")).toHaveLength(1);
  });

  test("ArtifactBenchmarkResult has version 2", () => {
    const result: ArtifactBenchmarkResult = {
      agentId: "test-agent",
      agentEndpoint: "http://localhost:3000",
      version: 2,
      mode: "public",
      runTimestamp: "2026-01-20T10:00:00Z",
      dealResults: [],
      aggregateScore: 0,
      maxPossibleScore: 0,
      aggregateDimensions: {
        riskIdentification: 0,
        nextStepQuality: 0,
        prioritization: 0,
        outcomeAlignment: 0,
      },
    };
    expect(result.version).toBe(2);
  });
});
