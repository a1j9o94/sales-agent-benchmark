/**
 * Response Evaluation API
 *
 * Judge individual agent responses against ground truth.
 */

import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import type {
  Checkpoint,
  AgentResponse,
  CheckpointEvaluation,
  EvaluationScores,
} from "../src/types/benchmark";

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

export async function evaluateResponse(
  checkpoint: Checkpoint,
  agentResponse: AgentResponse,
  mode: "public" | "private"
): Promise<CheckpointEvaluation> {
  const prompt = `## Deal Context at Checkpoint
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

  try {
    const result = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
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
export async function handleEvaluateResponseEndpoint(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = (await req.json()) as {
      checkpoint?: Checkpoint;
      agentResponse?: AgentResponse;
      mode?: string;
    };

    if (!body.checkpoint) {
      return Response.json({ error: "checkpoint is required" }, { status: 400 });
    }
    if (!body.agentResponse) {
      return Response.json({ error: "agentResponse is required" }, { status: 400 });
    }

    const mode = body.mode === "private" ? "private" : "public";

    const evaluation = await evaluateResponse(
      body.checkpoint as Checkpoint,
      body.agentResponse as AgentResponse,
      mode
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
