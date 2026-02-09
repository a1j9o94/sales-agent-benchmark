/**
 * Checkpoint Builder
 *
 * Assembles artifacts into time-windowed ArtifactCheckpoints.
 * Creates 2-6 checkpoints per deal at significant deal events,
 * with appropriate artifacts available at each point.
 */

import type {
  Artifact,
  ArtifactCheckpoint,
  ArtifactStakeholder,
  MeddpiccState,
  EvaluationTask,
  ArtifactGroundTruth,
  CrmActivityEntry,
  ScoringDimensionKey,
  EvaluationTaskType,
} from "../../../src/types/benchmark-artifact";
import {
  sortArtifactsChronologically,
  getArtifactsAvailableAt,
  toArtifactReference,
  getArtifactDate,
} from "./linker";

/** Significant event types that trigger checkpoint creation */
const CHECKPOINT_TRIGGERS = [
  "demo",
  "discovery",
  "proposal",
  "pricing",
  "negotiation",
  "pilot",
  "close",
  "loss",
  "stall",
  "escalation",
  "executive",
  "technical",
  "contract",
  "decision",
];

export interface CheckpointBuilderInput {
  dealId: string;
  dealName: string;
  artifacts: Artifact[];
  activityLog: CrmActivityEntry[];
  stakeholders: ArtifactStakeholder[];
  meddpicc?: MeddpiccState;
  stage: string;
  amount?: string;
  finalOutcome: "won" | "lost" | "stalled" | "active";
  firstContactDate?: string;
}

/**
 * Identify significant dates from activity log for checkpoint placement.
 */
export function identifyCheckpointDates(
  activityLog: CrmActivityEntry[],
  artifacts: Artifact[]
): string[] {
  const candidateDates: { date: string; score: number }[] = [];

  // Score activity log entries
  for (const entry of activityLog) {
    let score = 0;
    const lower = entry.description.toLowerCase();

    for (const trigger of CHECKPOINT_TRIGGERS) {
      if (lower.includes(trigger)) {
        score += 2;
      }
    }

    // Stage changes are always significant
    if (entry.type === "stage_change") score += 3;

    // Meetings/calls are significant
    if (entry.type === "call" || entry.type === "meeting") score += 1;

    if (score > 0) {
      candidateDates.push({ date: entry.date, score });
    }
  }

  // Also consider transcript dates as checkpoint candidates
  for (const artifact of artifacts) {
    if (artifact.type === "transcript") {
      candidateDates.push({ date: artifact.date, score: 2 });
    }
  }

  // Sort by date, then score
  candidateDates.sort((a, b) => {
    const dateCompare = new Date(a.date).getTime() - new Date(b.date).getTime();
    if (dateCompare !== 0) return dateCompare;
    return b.score - a.score;
  });

  // Deduplicate dates that are within 2 days of each other (keep highest score)
  const selectedDates: string[] = [];
  for (const candidate of candidateDates) {
    const candidateTime = new Date(candidate.date).getTime();
    const tooClose = selectedDates.some((d) => {
      const diff = Math.abs(new Date(d).getTime() - candidateTime);
      return diff < 2 * 24 * 60 * 60 * 1000;
    });
    if (!tooClose) {
      selectedDates.push(candidate.date);
    }
  }

  // Limit to 2-6 checkpoints
  if (selectedDates.length > 6) {
    // Keep first, last, and highest-scored middle ones
    const first = selectedDates[0];
    const last = selectedDates[selectedDates.length - 1];
    const middle = selectedDates
      .slice(1, -1)
      .map((d) => ({
        date: d,
        score: candidateDates.find((c) => c.date === d)?.score ?? 0,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((d) => d.date)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    return [first!, ...middle, last!];
  }

  if (selectedDates.length < 2 && artifacts.length > 0) {
    // If not enough events, create checkpoints at artifact midpoint and end
    const sorted = sortArtifactsChronologically(artifacts);
    const dates = sorted.map((a) => getArtifactDate(a));
    if (dates.length >= 2) {
      const midIdx = Math.floor(dates.length / 2);
      return [dates[midIdx]!, dates[dates.length - 1]!];
    }
    if (dates.length === 1) {
      return [dates[0]!];
    }
  }

  return selectedDates;
}

/**
 * Generate evaluation tasks appropriate for the artifacts available at a checkpoint.
 */
export function generateTasks(
  checkpointId: string,
  availableArtifacts: Artifact[],
  allArtifacts: Artifact[]
): EvaluationTask[] {
  const tasks: EvaluationTask[] = [];
  const availableIds = availableArtifacts.map((a) => a.id);
  const optionalIds = allArtifacts
    .filter((a) => !availableIds.includes(a.id))
    .map((a) => a.id);

  const transcripts = availableArtifacts.filter((a) => a.type === "transcript");
  const emails = availableArtifacts.filter((a) => a.type === "email");
  const crmSnapshots = availableArtifacts.filter((a) => a.type === "crm_snapshot");
  const hasMultipleSources = new Set(availableArtifacts.map((a) => a.type)).size >= 2;

  // Always add deal_analysis if there are any artifacts
  if (availableArtifacts.length > 0) {
    tasks.push({
      id: `${checkpointId}_task_deal_analysis`,
      type: "deal_analysis",
      prompt: "Analyze the current state of this deal. Identify key risks, recommend next steps, and assess the likelihood of closing. Consider all available information.",
      requiredArtifacts: availableIds.slice(0, 3), // provide up to 3 artifacts
      optionalArtifacts: optionalIds.slice(0, 3),
      scoringDimensions: ["riskIdentification", "nextStepQuality", "prioritization", "outcomeAlignment"],
      maxTurns: hasMultipleSources ? 3 : 1,
    });
  }

  // Add call_summary if there are transcripts
  if (transcripts.length > 0) {
    const latestTranscript = transcripts[transcripts.length - 1]!;
    tasks.push({
      id: `${checkpointId}_task_call_summary`,
      type: "call_summary",
      prompt: "Summarize this call. Identify key commitments made, objections raised, and action items. Assess the stakeholder sentiment.",
      requiredArtifacts: [latestTranscript.id],
      optionalArtifacts: crmSnapshots.map((a) => a.id).slice(0, 2),
      scoringDimensions: ["informationSynthesis", "stakeholderMapping", "prioritization"],
    });
  }

  // Add follow_up_draft if there are emails or transcripts
  if (emails.length > 0 || transcripts.length > 0) {
    const contextArtifacts = [...transcripts, ...emails].slice(-2);
    tasks.push({
      id: `${checkpointId}_task_follow_up`,
      type: "follow_up_draft",
      prompt: "Draft a follow-up email based on the recent interactions. The email should advance the deal, address any concerns raised, and include clear next steps.",
      requiredArtifacts: contextArtifacts.map((a) => a.id),
      optionalArtifacts: crmSnapshots.map((a) => a.id).slice(0, 1),
      scoringDimensions: ["communicationQuality", "nextStepQuality", "outcomeAlignment"],
    });
  }

  // Add stakeholder_analysis if there are multiple sources
  if (hasMultipleSources && availableArtifacts.length >= 3) {
    tasks.push({
      id: `${checkpointId}_task_stakeholder`,
      type: "stakeholder_analysis",
      prompt: "Map the key stakeholders in this deal. For each, identify their role in the decision process, sentiment, concerns, and level of influence. Identify any missing stakeholders that should be engaged.",
      requiredArtifacts: availableIds.slice(0, 4),
      optionalArtifacts: optionalIds.slice(0, 2),
      scoringDimensions: ["stakeholderMapping", "dealQualification", "informationSynthesis"],
      maxTurns: 2,
    });
  }

  return tasks;
}

/**
 * Build ArtifactCheckpoints from a set of artifacts and deal metadata.
 */
export function buildCheckpoints(input: CheckpointBuilderInput): ArtifactCheckpoint[] {
  const {
    dealId,
    dealName,
    artifacts,
    activityLog,
    stakeholders,
    meddpicc,
    stage,
    amount,
    firstContactDate,
  } = input;

  const checkpointDates = identifyCheckpointDates(activityLog, artifacts);

  if (checkpointDates.length === 0) {
    return [];
  }

  const firstContact = firstContactDate
    ? new Date(firstContactDate)
    : activityLog.length > 0
      ? new Date(activityLog[0]!.date)
      : new Date(getArtifactDate(sortArtifactsChronologically(artifacts)[0]!));

  return checkpointDates.map((date, idx) => {
    const id = `${dealId}_cp_${String(idx + 1).padStart(3, "0")}`;
    const available = getArtifactsAvailableAt(artifacts, date);
    const daysSinceFirst = Math.floor(
      (new Date(date).getTime() - firstContact.getTime()) / (1000 * 60 * 60 * 24)
    );

    const groundTruth = extractGroundTruth(date, checkpointDates, activityLog, idx);
    const tasks = generateTasks(id, available, artifacts);

    return {
      id,
      dealId,
      version: 2 as const,
      timestamp: date,
      availableArtifacts: available.map(toArtifactReference),
      dealSnapshot: {
        company: dealName,
        stage,
        amount,
        daysSinceFirstContact: Math.max(0, daysSinceFirst),
      },
      stakeholders,
      meddpicc,
      groundTruth,
      tasks,
    };
  });
}

/**
 * Extract ground truth for a checkpoint from activity log entries
 * that occurred AFTER the checkpoint date.
 */
function extractGroundTruth(
  checkpointDate: string,
  allCheckpointDates: string[],
  activityLog: CrmActivityEntry[],
  checkpointIdx: number
): ArtifactGroundTruth {
  const cpTime = new Date(checkpointDate).getTime();

  // Find the next checkpoint date (or end of log)
  const nextCpDate = checkpointIdx < allCheckpointDates.length - 1
    ? allCheckpointDates[checkpointIdx + 1]
    : null;
  const nextCpTime = nextCpDate ? new Date(nextCpDate).getTime() : Infinity;

  // Get activity log entries between this checkpoint and the next
  const futureEntries = activityLog.filter((entry) => {
    const entryTime = new Date(entry.date).getTime();
    return entryTime > cpTime && entryTime <= nextCpTime;
  });

  const whatHappened = futureEntries
    .map((e) => e.description)
    .join(". ");

  // Detect risks from keywords
  const riskKeywords = ["delay", "stall", "concern", "blocker", "risk", "competitor", "budget", "postpone", "cancel", "silent", "no response"];
  const risks = futureEntries
    .filter((e) => riskKeywords.some((kw) => e.description.toLowerCase().includes(kw)))
    .map((e) => e.description);

  // Determine outcome
  let outcome: ArtifactGroundTruth["outcomeAtThisPoint"] = "progressing";
  const allFutureText = whatHappened.toLowerCase();
  if (allFutureText.includes("won") || allFutureText.includes("closed won") || allFutureText.includes("signed")) {
    outcome = "won";
  } else if (allFutureText.includes("lost") || allFutureText.includes("closed lost")) {
    outcome = "lost";
  } else if (allFutureText.includes("stall") || allFutureText.includes("no response") || allFutureText.includes("went quiet")) {
    outcome = "stalled";
  } else if (risks.length > futureEntries.length / 2) {
    outcome = "at_risk";
  }

  return {
    whatHappenedNext: whatHappened || "No subsequent activity recorded.",
    actualRisksThatMaterialized: risks,
    outcomeAtThisPoint: outcome,
  };
}
