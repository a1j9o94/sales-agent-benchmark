/**
 * Stakeholder Analysis Judge — V2 Evaluation Task
 *
 * Evaluates agent responses to stakeholder analysis tasks: stakeholder mapping,
 * deal qualification through stakeholder signals, and information synthesis.
 */

import type {
  V2ScoringDimensions,
  V2GroundTruth,
  Artifact,
  V2AgentResponse,
  ScoringDimensionKey,
} from "../../src/types/benchmark-v2";

export const STAKEHOLDER_ANALYSIS_DIMENSIONS: ScoringDimensionKey[] = [
  "stakeholderMapping",
  "dealQualification",
  "informationSynthesis",
];

export const STAKEHOLDER_ANALYSIS_JUDGE_PROMPT = `You are an expert sales manager evaluating an AI sales agent's stakeholder analysis against real deal artifacts and ground truth.

You will be given:
1. Deal artifacts (transcripts, emails, CRM data, documents) containing stakeholder information
2. The agent's stakeholder analysis
3. What ACTUALLY happened in this deal (ground truth) — including which stakeholders influenced the outcome

Evaluate the agent's stakeholder analysis across these dimensions.

## Scoring Dimensions (0-10 each)

**stakeholder_mapping** (0-10): How completely and accurately did the agent map the stakeholder landscape?
- 10: Identified all key stakeholders with correct roles, titles, and reporting relationships; accurately assessed each person's sentiment and influence level; flagged missing stakeholders who should be engaged
- 7: Identified most stakeholders with generally accurate roles and sentiment; may miss one secondary stakeholder or misjudge one person's influence
- 4: Got the obvious stakeholders right but missed important players or significantly misread roles/sentiment; incomplete org chart
- 1: Major stakeholder gaps; incorrect role assignments that would mislead sales strategy
- 0: Stakeholder map is fundamentally wrong or missing

**deal_qualification** (0-10): How well did the stakeholder analysis inform deal qualification (is the right buying committee engaged)?
- 10: Correctly identified champion, economic buyer, and decision maker; accurately assessed whether the right people are at the table; flagged gaps in buying committee coverage
- 7: Generally correct buying committee assessment; may miss nuance about one role
- 4: Partially correct but missed important qualification signals from stakeholder dynamics (e.g., no economic buyer engaged, champion going quiet)
- 1: Qualification assessment from stakeholders is mostly wrong; would lead to false confidence or unnecessary alarm
- 0: No useful qualification insight from the stakeholder analysis

**information_synthesis** (0-10): How well did the agent synthesize stakeholder information across multiple artifacts?
- 10: Cross-referenced stakeholder mentions across transcripts, emails, and CRM; identified sentiment evolution over time; connected organizational dynamics to deal trajectory
- 7: Good cross-referencing across most artifacts; may miss one connection or subtle evolution
- 4: Relied heavily on one artifact type; missed important cross-artifact signals (e.g., stakeholder said one thing in meeting, different thing in email)
- 1: Superficial synthesis; essentially just listed stakeholders from a single source
- 0: No meaningful synthesis; missed contradictions or important patterns across artifacts

Return ONLY valid JSON:
{
  "scores": {
    "stakeholder_mapping": 0-10,
    "deal_qualification": 0-10,
    "information_synthesis": 0-10
  },
  "feedback": "2-4 sentences evaluating the stakeholder analysis with specific references to accuracy of stakeholder identification and cross-artifact synthesis",
  "stakeholders_correctly_identified": ["stakeholders the agent correctly mapped with role/sentiment"],
  "stakeholders_missed": ["important stakeholders the agent failed to identify or significantly misread"],
  "buying_committee_assessment": "brief assessment of how well the agent mapped the buying committee and identified gaps"
}`;

/**
 * Parse a judge's JSON response into V2ScoringDimensions for stakeholder analysis.
 * Clamps all scores to 0-10 range.
 */
export function scoreStakeholderAnalysis(
  response: V2AgentResponse,
  groundTruth: V2GroundTruth,
  artifacts: Artifact[]
): Partial<V2ScoringDimensions> {
  return {
    stakeholderMapping: 0,
    dealQualification: 0,
    informationSynthesis: 0,
  };
}

/**
 * Parse raw judge JSON output into clamped V2ScoringDimensions.
 */
export function parseStakeholderAnalysisScores(
  judgeOutput: Record<string, unknown>
): Partial<V2ScoringDimensions> {
  const scores = judgeOutput.scores as Record<string, number> | undefined;
  const clamp = (v: number) => Math.min(10, Math.max(0, v || 0));

  return {
    stakeholderMapping: clamp(scores?.stakeholder_mapping ?? 0),
    dealQualification: clamp(scores?.deal_qualification ?? 0),
    informationSynthesis: clamp(scores?.information_synthesis ?? 0),
  };
}
