/**
 * Follow-Up Draft Judge — Artifact-Based Evaluation Task
 *
 * Evaluates agent responses to follow-up drafting tasks: communication quality,
 * next step clarity, and outcome alignment.
 */

import type {
  ArtifactScoringDimensions,
  ArtifactGroundTruth,
  Artifact,
  ArtifactAgentResponse,
  ScoringDimensionKey,
} from "../../src/types/benchmark-artifact";

export const FOLLOW_UP_DRAFT_DIMENSIONS: ScoringDimensionKey[] = [
  "communicationQuality",
  "nextStepQuality",
  "outcomeAlignment",
];

export const FOLLOW_UP_DRAFT_JUDGE_PROMPT = `You are an expert sales manager evaluating an AI sales agent's follow-up draft (email or message) against the deal context and ground truth.

You will be given:
1. Deal artifacts providing context (prior transcripts, emails, CRM data, documents)
2. The agent's follow-up draft
3. What ACTUALLY happened next in this deal (ground truth)

Evaluate the agent's follow-up draft across these dimensions.

## Scoring Dimensions (0-10 each)

**communication_quality** (0-10): Is the draft professional, well-structured, and appropriately toned for the deal stage and relationship?
- 10: Perfect tone for the relationship stage; concise yet thorough; natural language that builds trust; addresses concerns from prior interactions without being defensive
- 7: Appropriate tone; well-structured; minor issues with length, formality level, or missed nuance from prior conversations
- 4: Functional but generic; doesn't reflect the specific relationship dynamics; may be too formal/informal for the stage
- 1: Poor tone that could damage the relationship; overly pushy, too casual, or disconnected from prior context
- 0: Unprofessional or tone-deaf; would actively harm the deal

**next_step_quality** (0-10): Does the draft include a clear, specific call to action that advances the deal?
- 10: CTA is specific (date/time, deliverable, decision request), easy to say yes to, and strategically timed; creates natural momentum
- 7: Clear CTA present; mostly specific but could be stronger or more strategically timed
- 4: CTA exists but is vague ("let's connect soon") or asks for too much at once
- 1: No clear CTA or the ask is inappropriate for the deal stage
- 0: CTA would stall or reverse deal progress

**outcome_alignment** (0-10): Would sending this follow-up have helped achieve a better outcome, given what actually happened?
- 10: Draft directly addresses the issues that turned out to matter; would have accelerated the actual outcome trajectory
- 7: Draft generally helpful; addresses most relevant concerns but may miss one key point
- 4: Draft partially aligned; some helpful elements but misses what actually turned out to be important
- 1: Draft focuses on wrong issues; would not have helped with the actual challenges ahead
- 0: Draft would have actively worsened the situation given what happened next

Return ONLY valid JSON:
{
  "scores": {
    "communication_quality": 0-10,
    "next_step_quality": 0-10,
    "outcome_alignment": 0-10
  },
  "feedback": "2-4 sentences evaluating the follow-up draft with specific references to tone, CTA effectiveness, and alignment with what actually happened",
  "tone_assessment": "brief assessment of tone appropriateness for the deal stage and relationship",
  "cta_assessment": "brief assessment of the call-to-action clarity and strategic value",
  "concerns_addressed": ["concerns from prior interactions that the draft addresses"],
  "concerns_missed": ["important concerns from prior interactions that the draft fails to address"]
}`;

/**
 * Parse a judge's JSON response into ArtifactScoringDimensions for follow-up draft.
 * Clamps all scores to 0-10 range.
 */
export function scoreFollowUpDraft(
  response: ArtifactAgentResponse,
  groundTruth: ArtifactGroundTruth,
  artifacts: Artifact[]
): Partial<ArtifactScoringDimensions> {
  return {
    communicationQuality: 0,
    nextStepQuality: 0,
    outcomeAlignment: 0,
  };
}

/**
 * Parse raw judge JSON output into clamped ArtifactScoringDimensions.
 */
export function parseFollowUpDraftScores(
  judgeOutput: Record<string, unknown>
): Partial<ArtifactScoringDimensions> {
  const scores = judgeOutput.scores as Record<string, number> | undefined;
  const clamp = (v: number) => Math.min(10, Math.max(0, v || 0));

  return {
    communicationQuality: clamp(scores?.communication_quality ?? 0),
    nextStepQuality: clamp(scores?.next_step_quality ?? 0),
    outcomeAlignment: clamp(scores?.outcome_alignment ?? 0),
  };
}
