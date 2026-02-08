/**
 * Response Evaluation API
 *
 * Judge individual agent responses against ground truth using multiple frontier models.
 * Uses 3 judges: Claude 4.5 Opus (via Anthropic), GPT-5.2, and Gemini 3 Pro (via OpenRouter)
 */

import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type {
  Checkpoint,
  AgentResponse,
  CheckpointEvaluation,
  EvaluationScores,
} from "../src/types/benchmark";

// Dependency injection interface for testability
export interface EvaluateDeps {
  generateText: typeof generateText;
  anthropic: typeof anthropic;
  openrouter: ReturnType<typeof createOpenAI>;
}

// Lazy OpenRouter client creation (avoids requiring API key at import time)
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

function getDefaultEvaluateDeps(): EvaluateDeps {
  return { generateText, anthropic, openrouter: getOpenRouter() };
}

// Judge model configurations
export const JUDGE_MODELS = {
  claude: {
    id: "claude-4.5-opus",
    name: "Claude 4.5 Opus",
    provider: "anthropic" as const,
    modelId: "claude-opus-4-5-20251101",
  },
  gpt: {
    id: "gpt-5.2",
    name: "GPT-5.2",
    provider: "openrouter" as const,
    modelId: "openai/gpt-5.2-20251211",
  },
  gemini: {
    id: "gemini-3-pro",
    name: "Gemini 3 Pro",
    provider: "openrouter" as const,
    modelId: "google/gemini-3-pro-preview-20251117",
  },
} as const;

const JUDGE_SYSTEM_PROMPT = `You are an expert sales manager evaluating an AI sales agent's analysis of a deal situation.

You will be given:
1. The deal context at a specific checkpoint
2. What ACTUALLY happened after this checkpoint (ground truth)
3. What the AI agent recommended (risks and next steps)

Your job is to score the agent's recommendations based on how well they align with what actually mattered.

## Scoring Dimensions (0-10 each)

**risk_identification** (0-10): Did the agent identify the ACTUAL risks that materialized?
- 10: Identified all major risks that actually happened
- 7: Identified most important risks
- 4: Identified some risks but missed key ones
- 1: Mostly missed the actual risks
- 0: Completely wrong about risks

**next_step_quality** (0-10): Were the recommended actions actually helpful?
- 10: Recommendations align perfectly with what worked
- 7: Most recommendations would have helped
- 4: Mixed - some good, some unhelpful
- 1: Mostly unhelpful recommendations
- 0: Recommendations would have hurt the deal

**prioritization** (0-10): Did the agent focus on what actually mattered most?
- 10: Top priorities perfectly matched actual priorities
- 7: Generally good prioritization
- 4: Some prioritization issues
- 1: Priorities were mostly wrong
- 0: Focused on completely wrong things

**outcome_alignment** (0-10): Overall, would following this advice have helped?
- 10: Following this advice would lead to optimal outcome
- 7: Advice generally helpful for deal progression
- 4: Mixed results expected from this advice
- 1: Advice likely unhelpful
- 0: Following this advice would have hurt the deal

Return ONLY valid JSON:
{
  "scores": {
    "risk_identification": 0-10,
    "next_step_quality": 0-10,
    "prioritization": 0-10,
    "outcome_alignment": 0-10
  },
  "feedback": "2-3 sentences explaining the evaluation",
  "risks_identified": ["risks the agent correctly identified"],
  "risks_missed": ["actual risks the agent failed to identify"],
  "helpful_recommendations": ["agent recommendations that would have helped"],
  "unhelpful_recommendations": ["agent recommendations that were wrong or unhelpful"]
}`;

// Individual judge evaluation result
export interface JudgeEvaluation {
  judgeModel: string;
  judgeName: string;
  scores: EvaluationScores;
  totalScore: number;
  feedback: string;
  risksIdentified: string[];
  risksMissed: string[];
  helpfulRecommendations: string[];
  unhelpfulRecommendations: string[];
}

// Extended checkpoint evaluation with multi-judge support
export interface MultiJudgeCheckpointEvaluation extends CheckpointEvaluation {
  judgeEvaluations?: JudgeEvaluation[];
}

function buildEvaluationPrompt(checkpoint: Checkpoint, agentResponse: AgentResponse): string {
  return `## Deal Context at Checkpoint
Company: ${checkpoint.context.company}
Stage: ${checkpoint.context.stage}
Last Interaction: ${checkpoint.context.lastInteraction}

Pain Points:
${checkpoint.context.painPoints.map((p) => `- ${p}`).join("\n")}

Stakeholders:
${checkpoint.context.stakeholders.map((s) => `- ${s.name} (${s.role}): ${s.sentiment} sentiment`).join("\n")}

${checkpoint.context.history ? `History: ${checkpoint.context.history}` : ""}

## What ACTUALLY Happened (Ground Truth)
${checkpoint.groundTruth.whatHappenedNext}

Risks that actually materialized:
${checkpoint.groundTruth.actualRisksThatMaterialized.map((r) => `- ${r}`).join("\n")}

Outcome at this point: ${checkpoint.groundTruth.outcomeAtThisPoint}

## Agent's Analysis

Risks Identified:
${agentResponse.risks.map((r) => `- [${r.severity}] ${r.description}`).join("\n")}

Recommended Next Steps:
${agentResponse.nextSteps.map((s) => `- (Priority ${s.priority}) ${s.action}`).join("\n")}

Confidence: ${agentResponse.confidence}
Reasoning: ${agentResponse.reasoning}

---

Evaluate the agent's analysis against the ground truth. How well did they identify the actual risks and recommend actions that would have helped?`;
}

// Evaluate with a single judge model
async function evaluateWithJudge(
  judgeConfig: (typeof JUDGE_MODELS)[keyof typeof JUDGE_MODELS],
  prompt: string,
  deps = getDefaultEvaluateDeps()
): Promise<JudgeEvaluation> {
  try {
    let result;

    if (judgeConfig.provider === "anthropic") {
      result = await deps.generateText({
        model: deps.anthropic(judgeConfig.modelId),
        system: JUDGE_SYSTEM_PROMPT,
        prompt,
      });
    } else {
      result = await deps.generateText({
        model: deps.openrouter(judgeConfig.modelId),
        system: JUDGE_SYSTEM_PROMPT,
        prompt,
      });
    }

    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`No JSON found in ${judgeConfig.name} response`);
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const scores: EvaluationScores = {
      riskIdentification: Math.min(10, Math.max(0, parsed.scores?.risk_identification || 0)),
      nextStepQuality: Math.min(10, Math.max(0, parsed.scores?.next_step_quality || 0)),
      prioritization: Math.min(10, Math.max(0, parsed.scores?.prioritization || 0)),
      outcomeAlignment: Math.min(10, Math.max(0, parsed.scores?.outcome_alignment || 0)),
    };

    const totalScore =
      scores.riskIdentification +
      scores.nextStepQuality +
      scores.prioritization +
      scores.outcomeAlignment;

    return {
      judgeModel: judgeConfig.id,
      judgeName: judgeConfig.name,
      scores,
      totalScore,
      feedback: parsed.feedback || "Evaluation completed",
      risksIdentified: parsed.risks_identified || [],
      risksMissed: parsed.risks_missed || [],
      helpfulRecommendations: parsed.helpful_recommendations || [],
      unhelpfulRecommendations: parsed.unhelpful_recommendations || [],
    };
  } catch (error) {
    console.error(`${judgeConfig.name} evaluation error:`, error);

    // Return zero scores on error
    return {
      judgeModel: judgeConfig.id,
      judgeName: judgeConfig.name,
      scores: {
        riskIdentification: 0,
        nextStepQuality: 0,
        prioritization: 0,
        outcomeAlignment: 0,
      },
      totalScore: 0,
      feedback: `Evaluation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      risksIdentified: [],
      risksMissed: [],
      helpfulRecommendations: [],
      unhelpfulRecommendations: [],
    };
  }
}

// Aggregate scores from multiple judges
function aggregateJudgeScores(judgeEvaluations: JudgeEvaluation[]): {
  scores: EvaluationScores;
  totalScore: number;
  feedback: string;
} {
  if (judgeEvaluations.length === 0) {
    return {
      scores: {
        riskIdentification: 0,
        nextStepQuality: 0,
        prioritization: 0,
        outcomeAlignment: 0,
      },
      totalScore: 0,
      feedback: "No judge evaluations available",
    };
  }

  // Calculate average scores
  const avgScores: EvaluationScores = {
    riskIdentification: 0,
    nextStepQuality: 0,
    prioritization: 0,
    outcomeAlignment: 0,
  };

  for (const evaluation of judgeEvaluations) {
    avgScores.riskIdentification += evaluation.scores.riskIdentification;
    avgScores.nextStepQuality += evaluation.scores.nextStepQuality;
    avgScores.prioritization += evaluation.scores.prioritization;
    avgScores.outcomeAlignment += evaluation.scores.outcomeAlignment;
  }

  const count = judgeEvaluations.length;
  avgScores.riskIdentification = Math.round((avgScores.riskIdentification / count) * 10) / 10;
  avgScores.nextStepQuality = Math.round((avgScores.nextStepQuality / count) * 10) / 10;
  avgScores.prioritization = Math.round((avgScores.prioritization / count) * 10) / 10;
  avgScores.outcomeAlignment = Math.round((avgScores.outcomeAlignment / count) * 10) / 10;

  const totalScore =
    avgScores.riskIdentification +
    avgScores.nextStepQuality +
    avgScores.prioritization +
    avgScores.outcomeAlignment;

  // Combine feedback from all judges
  const feedbackParts = judgeEvaluations.map((e) => `[${e.judgeName}] ${e.feedback}`);
  const feedback = feedbackParts.join(" | ");

  return { scores: avgScores, totalScore, feedback };
}

// Multi-judge evaluation (calls all 3 judges in parallel)
export async function evaluateResponseMultiJudge(
  checkpoint: Checkpoint,
  agentResponse: AgentResponse,
  mode: "public" | "private",
  deps = getDefaultEvaluateDeps()
): Promise<MultiJudgeCheckpointEvaluation> {
  const prompt = buildEvaluationPrompt(checkpoint, agentResponse);

  // Run all judges in parallel
  const judgePromises = Object.values(JUDGE_MODELS).map((judgeConfig) =>
    evaluateWithJudge(judgeConfig, prompt, deps)
  );

  const judgeEvaluations = await Promise.all(judgePromises);

  // Aggregate scores from all judges
  const aggregated = aggregateJudgeScores(judgeEvaluations);

  const evaluation: MultiJudgeCheckpointEvaluation = {
    checkpointId: checkpoint.id,
    scores: aggregated.scores,
    totalScore: aggregated.totalScore,
    maxScore: 40,
    feedback: aggregated.feedback,
    judgeEvaluations,
  };

  // Only include detailed comparison for public mode
  if (mode === "public") {
    // Combine unique items from all judges
    const allRisksIdentified = new Set<string>();
    const allRisksMissed = new Set<string>();
    const allHelpful = new Set<string>();
    const allUnhelpful = new Set<string>();

    for (const judge of judgeEvaluations) {
      judge.risksIdentified.forEach((r) => allRisksIdentified.add(r));
      judge.risksMissed.forEach((r) => allRisksMissed.add(r));
      judge.helpfulRecommendations.forEach((r) => allHelpful.add(r));
      judge.unhelpfulRecommendations.forEach((r) => allUnhelpful.add(r));
    }

    evaluation.groundTruthComparison = {
      risksIdentified: Array.from(allRisksIdentified),
      risksMissed: Array.from(allRisksMissed),
      helpfulRecommendations: Array.from(allHelpful),
      unhelpfulRecommendations: Array.from(allUnhelpful),
    };
  }

  return evaluation;
}

// Single judge evaluation (backward compatible, uses Claude by default)
export async function evaluateResponse(
  checkpoint: Checkpoint,
  agentResponse: AgentResponse,
  mode: "public" | "private",
  deps = getDefaultEvaluateDeps()
): Promise<CheckpointEvaluation> {
  const prompt = buildEvaluationPrompt(checkpoint, agentResponse);

  try {
    const result = await deps.generateText({
      model: deps.anthropic("claude-sonnet-4-20250514"),
      system: JUDGE_SYSTEM_PROMPT,
      prompt,
    });

    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in judge response");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const scores: EvaluationScores = {
      riskIdentification: Math.min(10, Math.max(0, parsed.scores?.risk_identification || 0)),
      nextStepQuality: Math.min(10, Math.max(0, parsed.scores?.next_step_quality || 0)),
      prioritization: Math.min(10, Math.max(0, parsed.scores?.prioritization || 0)),
      outcomeAlignment: Math.min(10, Math.max(0, parsed.scores?.outcome_alignment || 0)),
    };

    const totalScore =
      scores.riskIdentification +
      scores.nextStepQuality +
      scores.prioritization +
      scores.outcomeAlignment;

    const evaluation: CheckpointEvaluation = {
      checkpointId: checkpoint.id,
      scores,
      totalScore,
      maxScore: 40,
      feedback: parsed.feedback || "Evaluation completed",
    };

    // Only include detailed comparison for public mode
    if (mode === "public") {
      evaluation.groundTruthComparison = {
        risksIdentified: parsed.risks_identified || [],
        risksMissed: parsed.risks_missed || [],
        helpfulRecommendations: parsed.helpful_recommendations || [],
        unhelpfulRecommendations: parsed.unhelpful_recommendations || [],
      };
    }

    return evaluation;
  } catch (error) {
    console.error("Evaluation error:", error);

    // Return a default evaluation on error
    return {
      checkpointId: checkpoint.id,
      scores: {
        riskIdentification: 0,
        nextStepQuality: 0,
        prioritization: 0,
        outcomeAlignment: 0,
      },
      totalScore: 0,
      maxScore: 40,
      feedback: `Evaluation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

// HTTP handler for direct evaluation requests
export async function handleEvaluateResponseEndpoint(req: Request, deps = getDefaultEvaluateDeps()): Promise<Response> {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = (await req.json()) as {
      checkpoint?: Checkpoint;
      agentResponse?: AgentResponse;
      mode?: string;
      multiJudge?: boolean;
    };

    if (!body.checkpoint) {
      return Response.json({ error: "checkpoint is required" }, { status: 400 });
    }
    if (!body.agentResponse) {
      return Response.json({ error: "agentResponse is required" }, { status: 400 });
    }

    const mode = body.mode === "private" ? "private" : "public";

    // Use multi-judge if requested
    if (body.multiJudge) {
      const evaluation = await evaluateResponseMultiJudge(
        body.checkpoint as Checkpoint,
        body.agentResponse as AgentResponse,
        mode,
        deps
      );
      return Response.json(evaluation);
    }

    // Default to single judge
    const evaluation = await evaluateResponse(
      body.checkpoint as Checkpoint,
      body.agentResponse as AgentResponse,
      mode,
      deps
    );

    return Response.json(evaluation);
  } catch (error) {
    console.error("Evaluate response error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Evaluation failed" },
      { status: 500 }
    );
  }
}

// Vercel default export
export const config = { runtime: "edge" };
export default handleEvaluateResponseEndpoint;
