/**
 * Artifact-Based Response Evaluation API
 *
 * Task-specific multi-judge evaluation for artifact-based benchmark.
 * Routes to the correct judge prompt based on task type, runs 3 judges in
 * parallel (Claude, GPT, Gemini), and aggregates dimension-specific scores.
 */

import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type {
  ArtifactAgentResponse,
  ArtifactGroundTruth,
  Artifact,
  ArtifactScoringDimensions,
  EvaluationTask,
  ScoringDimensionKey,
  ArtifactTaskEvaluation,
  EvaluationTaskType,
  TranscriptArtifact,
  EmailArtifact,
  CrmSnapshotArtifact,
  DocumentArtifact,
  SlackThreadArtifact,
  CalendarEventArtifact,
} from "../src/types/benchmark-artifact";
import { JUDGE_MODELS } from "./evaluate-response";
import {
  DEAL_ANALYSIS_JUDGE_PROMPT,
  DEAL_ANALYSIS_DIMENSIONS,
  parseDealAnalysisScores,
} from "./evaluate-tasks/deal-analysis";
import {
  CALL_SUMMARY_JUDGE_PROMPT,
  CALL_SUMMARY_DIMENSIONS,
  parseCallSummaryScores,
} from "./evaluate-tasks/call-summary";
import {
  FOLLOW_UP_DRAFT_JUDGE_PROMPT,
  FOLLOW_UP_DRAFT_DIMENSIONS,
  parseFollowUpDraftScores,
} from "./evaluate-tasks/follow-up-draft";
import {
  STAKEHOLDER_ANALYSIS_JUDGE_PROMPT,
  STAKEHOLDER_ANALYSIS_DIMENSIONS,
  parseStakeholderAnalysisScores,
} from "./evaluate-tasks/stakeholder-analysis";

// ---------------------------------------------------------------------------
// Dependency Injection
// ---------------------------------------------------------------------------

export interface EvaluateArtifactDeps {
  generateText: typeof generateText;
  anthropic: typeof anthropic;
  openrouter: ReturnType<typeof createOpenAI>;
}

let _openrouter: ReturnType<typeof createOpenAI> | null = null;
function getOpenRouter() {
  if (!_openrouter) {
    _openrouter = createOpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
      headers: {
        "HTTP-Referer": "https://sales-agent-benchmarks.fly.dev",
        "X-Title": "Sales Agent Benchmark",
      },
    });
  }
  return _openrouter;
}

function getDefaultArtifactDeps(): EvaluateArtifactDeps {
  return { generateText, anthropic, openrouter: getOpenRouter() };
}

// ---------------------------------------------------------------------------
// Task Config Registry
// ---------------------------------------------------------------------------

interface TaskConfig {
  judgePrompt: string;
  dimensions: ScoringDimensionKey[];
  parseScores: (judgeOutput: Record<string, unknown>) => Partial<ArtifactScoringDimensions>;
}

const TASK_CONFIGS: Record<string, TaskConfig> = {
  deal_analysis: {
    judgePrompt: DEAL_ANALYSIS_JUDGE_PROMPT,
    dimensions: DEAL_ANALYSIS_DIMENSIONS,
    parseScores: parseDealAnalysisScores,
  },
  call_summary: {
    judgePrompt: CALL_SUMMARY_JUDGE_PROMPT,
    dimensions: CALL_SUMMARY_DIMENSIONS,
    parseScores: parseCallSummaryScores,
  },
  follow_up_draft: {
    judgePrompt: FOLLOW_UP_DRAFT_JUDGE_PROMPT,
    dimensions: FOLLOW_UP_DRAFT_DIMENSIONS,
    parseScores: parseFollowUpDraftScores,
  },
  stakeholder_analysis: {
    judgePrompt: STAKEHOLDER_ANALYSIS_JUDGE_PROMPT,
    dimensions: STAKEHOLDER_ANALYSIS_DIMENSIONS,
    parseScores: parseStakeholderAnalysisScores,
  },
};

// Fallback config for task types without a dedicated judge prompt module.
// Uses deal_analysis as the default since it covers the broadest set of dimensions.
function getTaskConfig(taskType: EvaluationTaskType): TaskConfig {
  return TASK_CONFIGS[taskType] ?? TASK_CONFIGS["deal_analysis"]!;
}

// ---------------------------------------------------------------------------
// Artifact Summarization (keep prompts under context limits)
// ---------------------------------------------------------------------------

function summarizeArtifact(artifact: Artifact): string {
  switch (artifact.type) {
    case "transcript": {
      const t = artifact as TranscriptArtifact;
      const turnSummary = t.turns.length > 20
        ? t.turns.slice(0, 10).map((turn) => `[${turn.speaker}] ${turn.text.slice(0, 200)}`).join("\n") +
          `\n... (${t.turns.length - 20} turns omitted) ...\n` +
          t.turns.slice(-10).map((turn) => `[${turn.speaker}] ${turn.text.slice(0, 200)}`).join("\n")
        : t.turns.map((turn) => `[${turn.speaker}] ${turn.text}`).join("\n");
      return `### Transcript: ${t.title} (${t.date})\nAttendees: ${t.attendees.join(", ")}\n${turnSummary}`;
    }
    case "email": {
      const e = artifact as EmailArtifact;
      const messageSummary = e.messages.map(
        (m) => `From: ${m.from} | To: ${m.to.join(", ")} | ${m.date}\n${m.body.slice(0, 500)}`
      ).join("\n---\n");
      return `### Email Thread: ${e.subject}\nParticipants: ${e.participants.join(", ")}\n${messageSummary}`;
    }
    case "crm_snapshot": {
      const c = artifact as CrmSnapshotArtifact;
      const props = c.dealProperties;
      const contacts = c.contacts.map((ct) => `  - ${ct.name} (${ct.title ?? ct.role ?? "unknown role"})`).join("\n");
      const activity = c.activityLog.slice(-10).map((a) => `  - [${a.date}] ${a.type}: ${a.description}`).join("\n");
      return `### CRM Snapshot\nStage: ${props.stage} | Amount: ${props.amount ?? "N/A"} | Close: ${props.closeDate ?? "N/A"}\nContacts:\n${contacts}\nRecent Activity:\n${activity}`;
    }
    case "document": {
      const d = artifact as DocumentArtifact;
      const content = d.content.length > 1500 ? d.content.slice(0, 1500) + "\n... (truncated)" : d.content;
      return `### Document: ${d.title} (${d.documentType})\n${content}`;
    }
    case "slack_thread": {
      const s = artifact as SlackThreadArtifact;
      const msgs = s.messages.slice(-15).map((m) => `[${m.author}] ${m.text}`).join("\n");
      return `### Slack Thread: #${s.channel}\n${msgs}`;
    }
    case "calendar_event": {
      const cal = artifact as CalendarEventArtifact;
      return `### Calendar Event: ${cal.title}\nDate: ${cal.date} | Duration: ${cal.duration}min\nAttendees: ${cal.attendees.join(", ")}\n${cal.description ?? ""}`;
    }
    default:
      return `### Artifact (${(artifact as Artifact).type})\n[Content not displayed]`;
  }
}

// ---------------------------------------------------------------------------
// Prompt Building
// ---------------------------------------------------------------------------

function buildArtifactEvaluationPrompt(
  task: EvaluationTask,
  response: ArtifactAgentResponse,
  groundTruth: ArtifactGroundTruth,
  artifacts: Artifact[]
): string {
  const artifactSummaries = artifacts.map(summarizeArtifact).join("\n\n");

  const risksSection = response.risks && response.risks.length > 0
    ? response.risks.map((r) => `- [${r.severity}] ${r.description}`).join("\n")
    : "(none identified)";

  const nextStepsSection = response.nextSteps && response.nextSteps.length > 0
    ? response.nextSteps.map((s) => `- (Priority ${s.priority}) ${s.action}${s.rationale ? ` — ${s.rationale}` : ""}`).join("\n")
    : "(none recommended)";

  return `## Task
${task.prompt}

## Artifacts Provided to the Agent
${artifactSummaries}

## Agent's Response

**Reasoning:** ${response.reasoning}

**Answer:** ${response.answer}

**Risks Identified:**
${risksSection}

**Recommended Next Steps:**
${nextStepsSection}

**Confidence:** ${response.confidence}

## Ground Truth — What ACTUALLY Happened
${groundTruth.whatHappenedNext}

Risks that actually materialized:
${groundTruth.actualRisksThatMaterialized.map((r) => `- ${r}`).join("\n")}

Outcome at this point: ${groundTruth.outcomeAtThisPoint}
${groundTruth.keyInsights ? `\nKey insights:\n${groundTruth.keyInsights.map((i) => `- ${i}`).join("\n")}` : ""}

---

Evaluate the agent's response against the artifacts and ground truth.`;
}

// ---------------------------------------------------------------------------
// Single Judge Evaluation
// ---------------------------------------------------------------------------

interface JudgeResult {
  scores: Partial<ArtifactScoringDimensions>;
  feedback: string;
  judgeModel: string;
  rawOutput: Record<string, unknown>;
}

async function evaluateArtifactWithJudge(
  judgeConfig: (typeof JUDGE_MODELS)[keyof typeof JUDGE_MODELS],
  prompt: string,
  taskConfig: TaskConfig,
  deps: EvaluateArtifactDeps
): Promise<JudgeResult> {
  try {
    let result;

    if (judgeConfig.provider === "anthropic") {
      result = await deps.generateText({
        model: deps.anthropic(judgeConfig.modelId),
        system: taskConfig.judgePrompt,
        prompt,
      });
    } else {
      result = await deps.generateText({
        model: deps.openrouter(judgeConfig.modelId),
        system: taskConfig.judgePrompt,
        prompt,
      });
    }

    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`No JSON found in ${judgeConfig.name} response`);
    }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const scores = taskConfig.parseScores(parsed);

    return {
      scores,
      feedback: (parsed.feedback as string) ?? "Evaluation completed",
      judgeModel: judgeConfig.id,
      rawOutput: parsed,
    };
  } catch (error) {
    console.error(`${judgeConfig.name} artifact-based evaluation error:`, error);

    // Return zero scores on error
    const zeroScores: Partial<ArtifactScoringDimensions> = {};
    for (const dim of taskConfig.dimensions) {
      zeroScores[dim] = 0;
    }

    return {
      scores: zeroScores,
      feedback: `Evaluation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      judgeModel: judgeConfig.id,
      rawOutput: {},
    };
  }
}

// ---------------------------------------------------------------------------
// Score Aggregation
// ---------------------------------------------------------------------------

function aggregateArtifactScores(
  judgeResults: JudgeResult[],
  dimensions: ScoringDimensionKey[]
): { scores: ArtifactScoringDimensions; feedback: string } {
  const scores: ArtifactScoringDimensions = {
    riskIdentification: 0,
    nextStepQuality: 0,
    prioritization: 0,
    outcomeAlignment: 0,
  };

  if (judgeResults.length === 0) {
    return { scores, feedback: "No judge evaluations available" };
  }

  // Average each relevant dimension across judges
  for (const dim of dimensions) {
    let sum = 0;
    let count = 0;
    for (const jr of judgeResults) {
      const val = jr.scores[dim];
      if (val !== undefined) {
        sum += val;
        count++;
      }
    }
    if (count > 0) {
      (scores as unknown as Record<string, number>)[dim] = Math.round((sum / count) * 10) / 10;
    }
  }

  const feedbackParts = judgeResults.map(
    (jr) => `[${jr.judgeModel}] ${jr.feedback}`
  );

  return { scores, feedback: feedbackParts.join(" | ") };
}

// ---------------------------------------------------------------------------
// Main Evaluation Function
// ---------------------------------------------------------------------------

export async function evaluateArtifactTask(
  task: EvaluationTask,
  agentResponse: ArtifactAgentResponse,
  groundTruth: ArtifactGroundTruth,
  artifacts: Artifact[],
  turnsUsed: number = 1,
  artifactsRequested: string[] = [],
  deps: EvaluateArtifactDeps = getDefaultArtifactDeps()
): Promise<ArtifactTaskEvaluation> {
  const taskConfig = getTaskConfig(task.type);

  // Build the evaluation prompt
  const prompt = buildArtifactEvaluationPrompt(task, agentResponse, groundTruth, artifacts);

  // Run all 3 judges in parallel
  const judgePromises = Object.values(JUDGE_MODELS).map((judgeConfig) =>
    evaluateArtifactWithJudge(judgeConfig, prompt, taskConfig, deps)
  );

  const judgeResults = await Promise.all(judgePromises);

  // Aggregate scores across judges
  const { scores, feedback } = aggregateArtifactScores(judgeResults, taskConfig.dimensions);

  return {
    taskId: task.id,
    taskType: task.type,
    turnsUsed,
    scores,
    feedback,
    artifactsRequested,
    judgeModel: Object.values(JUDGE_MODELS).map((j) => j.id).join(","),
  };
}

// ---------------------------------------------------------------------------
// HTTP Handler
// ---------------------------------------------------------------------------

export async function handleEvaluateArtifactEndpoint(
  req: Request,
  deps: EvaluateArtifactDeps = getDefaultArtifactDeps()
): Promise<Response> {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = (await req.json()) as {
      task?: EvaluationTask;
      agentResponse?: ArtifactAgentResponse;
      groundTruth?: ArtifactGroundTruth;
      artifacts?: Artifact[];
      turnsUsed?: number;
      artifactsRequested?: string[];
    };

    if (!body.task) {
      return Response.json({ error: "task is required" }, { status: 400 });
    }
    if (!body.agentResponse) {
      return Response.json({ error: "agentResponse is required" }, { status: 400 });
    }
    if (!body.groundTruth) {
      return Response.json({ error: "groundTruth is required" }, { status: 400 });
    }

    const evaluation = await evaluateArtifactTask(
      body.task,
      body.agentResponse,
      body.groundTruth,
      body.artifacts ?? [],
      body.turnsUsed ?? 1,
      body.artifactsRequested ?? [],
      deps
    );

    return Response.json(evaluation);
  } catch (error) {
    console.error("Artifact-based evaluate response error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Evaluation failed" },
      { status: 500 }
    );
  }
}
