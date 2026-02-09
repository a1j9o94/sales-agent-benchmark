/**
 * Call Summary Judge — Artifact-Based Evaluation Task
 *
 * Evaluates agent responses to call summary tasks: information synthesis,
 * stakeholder mapping, and prioritization of key takeaways.
 */

import type {
  ArtifactScoringDimensions,
  ArtifactGroundTruth,
  Artifact,
  ArtifactAgentResponse,
  ScoringDimensionKey,
} from "../../src/types/benchmark-artifact";

export const CALL_SUMMARY_DIMENSIONS: ScoringDimensionKey[] = [
  "informationSynthesis",
  "stakeholderMapping",
  "prioritization",
];

export const CALL_SUMMARY_JUDGE_PROMPT = `You are an expert sales manager evaluating an AI sales agent's call summary against the actual transcript and deal context.

You will be given:
1. The original call transcript and any supporting artifacts (CRM data, prior emails, documents)
2. The agent's call summary
3. What ACTUALLY happened after this call (ground truth)

Evaluate the agent's summary across these dimensions.

## Scoring Dimensions (0-10 each)

**information_synthesis** (0-10): How completely and accurately did the agent synthesize information from the transcript and supporting artifacts?
- 10: Captured all key discussion points, decisions, objections, and commitments; correctly integrated context from other artifacts; no fabrication
- 7: Captured most important points with minor omissions; mostly accurate integration of supporting context
- 4: Hit some key points but missed significant discussion topics or commitments; or introduced inaccuracies
- 1: Summary is superficial or misrepresents the conversation
- 0: Summary bears little resemblance to what was discussed; significant fabrication

**stakeholder_mapping** (0-10): How accurately did the agent map stakeholder roles, sentiment, and dynamics from the call?
- 10: Correctly identified all participants' roles, sentiment shifts during the call, and interpersonal dynamics; noted new stakeholders mentioned
- 7: Correctly identified most stakeholder sentiments; may miss subtle dynamics or a mentioned-but-absent stakeholder
- 4: Got basic roles right but misread sentiment or missed important stakeholder signals
- 1: Significant stakeholder misreads that would mislead the seller
- 0: Stakeholder assessment completely wrong or absent

**prioritization** (0-10): Did the agent correctly identify and prioritize the most important takeaways, action items, and follow-ups?
- 10: Action items perfectly capture commitments made; priorities reflect what actually turned out to matter; nothing critical omitted
- 7: Most action items captured with correct priority; minor omissions
- 4: Some action items captured but priority ordering is off, or important commitments missed
- 1: Action items mostly wrong or missing; priorities would misdirect follow-up
- 0: No useful action items or completely wrong prioritization

Return ONLY valid JSON:
{
  "scores": {
    "information_synthesis": 0-10,
    "stakeholder_mapping": 0-10,
    "prioritization": 0-10
  },
  "feedback": "2-4 sentences evaluating the summary quality with specific references to what was captured vs missed from the transcript",
  "key_points_captured": ["important points the agent correctly extracted"],
  "key_points_missed": ["significant points from the transcript the agent failed to capture"],
  "stakeholder_accuracy": "brief assessment of how well the agent read each participant"
}`;

/**
 * Parse a judge's JSON response into ArtifactScoringDimensions for call summary.
 * Clamps all scores to 0-10 range.
 */
export function scoreCallSummary(
  response: ArtifactAgentResponse,
  groundTruth: ArtifactGroundTruth,
  artifacts: Artifact[]
): Partial<ArtifactScoringDimensions> {
  return {
    informationSynthesis: 0,
    stakeholderMapping: 0,
    prioritization: 0,
  };
}

/**
 * Parse raw judge JSON output into clamped ArtifactScoringDimensions.
 */
export function parseCallSummaryScores(
  judgeOutput: Record<string, unknown>
): Partial<ArtifactScoringDimensions> {
  const scores = judgeOutput.scores as Record<string, number> | undefined;
  const clamp = (v: number) => Math.min(10, Math.max(0, v || 0));

  return {
    informationSynthesis: clamp(scores?.information_synthesis ?? 0),
    stakeholderMapping: clamp(scores?.stakeholder_mapping ?? 0),
    prioritization: clamp(scores?.prioritization ?? 0),
  };
}
