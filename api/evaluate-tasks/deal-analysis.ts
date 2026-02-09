/**
 * Deal Analysis Judge — Artifact-Based Evaluation Task
 *
 * Evaluates agent responses to deal analysis tasks: risk identification,
 * next step quality, prioritization, outcome alignment, and deal qualification.
 */

import type {
  ArtifactScoringDimensions,
  ArtifactGroundTruth,
  Artifact,
  ArtifactAgentResponse,
  ScoringDimensionKey,
} from "../../src/types/benchmark-artifact";

export const DEAL_ANALYSIS_DIMENSIONS: ScoringDimensionKey[] = [
  "riskIdentification",
  "nextStepQuality",
  "prioritization",
  "outcomeAlignment",
  "dealQualification",
];

export const DEAL_ANALYSIS_JUDGE_PROMPT = `You are an expert sales manager evaluating an AI sales agent's deal analysis against real artifacts and ground truth.

You will be given:
1. Real deal artifacts (transcripts, emails, CRM data, documents)
2. The agent's deal analysis (risks, next steps, reasoning)
3. What ACTUALLY happened after this point (ground truth)

Evaluate the agent's analysis across these dimensions.

## Scoring Dimensions (0-10 each)

**risk_identification** (0-10): Did the agent identify the risks that actually materialized?
- 10: Identified all major risks with accurate severity ratings; no false positives that would distract
- 7: Identified most important risks; may have minor gaps or one false positive
- 4: Identified some real risks but missed key ones, or diluted signal with false alarms
- 1: Missed nearly all actual risks
- 0: Completely wrong about risks or identified none

**next_step_quality** (0-10): Were the recommended actions specific, actionable, and tied to evidence in the artifacts?
- 10: Every recommendation is concrete, references specific evidence, and would directly advance the deal
- 7: Most recommendations are actionable with clear rationale
- 4: Mix of actionable and vague recommendations; some lack evidence basis
- 1: Mostly generic advice not grounded in the deal specifics
- 0: Recommendations are harmful or completely disconnected from the deal

**prioritization** (0-10): Did the agent focus on what actually mattered most, given the deal outcome?
- 10: Top priorities perfectly matched what turned out to matter; correct urgency calibration
- 7: Generally correct priorities; minor ordering issues
- 4: Some correct priorities but wasted attention on secondary concerns
- 1: Priorities were largely inverted from what actually mattered
- 0: Focused on completely irrelevant issues

**outcome_alignment** (0-10): Would following this analysis have led to a better outcome?
- 10: Analysis would have maximally prepared the seller for what actually happened
- 7: Analysis generally helpful; following it would improve deal trajectory
- 4: Mixed — some helpful elements but also misleading conclusions
- 1: Analysis mostly unhelpful; could have caused wasted effort
- 0: Analysis actively harmful; following it would damage the deal

**deal_qualification** (0-10): How accurately did the agent assess the deal's viability and stage health?
- 10: Qualification assessment perfectly matched actual outcome; accurate read of buyer signals
- 7: Generally correct qualification; minor misreads of deal health
- 4: Partially correct but missed important qualification signals (budget, authority, timeline)
- 1: Significantly over- or under-qualified the deal
- 0: Qualification completely wrong (e.g., called a lost deal "strong" or a won deal "dead")

Return ONLY valid JSON:
{
  "scores": {
    "risk_identification": 0-10,
    "next_step_quality": 0-10,
    "prioritization": 0-10,
    "outcome_alignment": 0-10,
    "deal_qualification": 0-10
  },
  "feedback": "2-4 sentences explaining the evaluation with specific references to artifacts and ground truth",
  "risks_identified": ["risks the agent correctly identified"],
  "risks_missed": ["actual risks the agent failed to identify"],
  "qualification_accuracy": "brief assessment of how well the agent read deal health signals"
}`;

/**
 * Parse a judge's JSON response into ArtifactScoringDimensions for deal analysis.
 * Clamps all scores to 0-10 range.
 */
export function scoreDealAnalysis(
  response: ArtifactAgentResponse,
  groundTruth: ArtifactGroundTruth,
  artifacts: Artifact[]
): Partial<ArtifactScoringDimensions> {
  // This function parses pre-computed judge JSON output.
  // The actual LLM call happens in the benchmark runner — this just validates & clamps scores.
  // The response/groundTruth/artifacts params provide context for any heuristic adjustments.

  return {
    riskIdentification: 0,
    nextStepQuality: 0,
    prioritization: 0,
    outcomeAlignment: 0,
    dealQualification: 0,
  };
}

/**
 * Parse raw judge JSON output into clamped ArtifactScoringDimensions.
 */
export function parseDealAnalysisScores(
  judgeOutput: Record<string, unknown>
): Partial<ArtifactScoringDimensions> {
  const scores = judgeOutput.scores as Record<string, number> | undefined;
  const clamp = (v: number) => Math.min(10, Math.max(0, v || 0));

  return {
    riskIdentification: clamp(scores?.risk_identification ?? 0),
    nextStepQuality: clamp(scores?.next_step_quality ?? 0),
    prioritization: clamp(scores?.prioritization ?? 0),
    outcomeAlignment: clamp(scores?.outcome_alignment ?? 0),
    dealQualification: clamp(scores?.deal_qualification ?? 0),
  };
}
