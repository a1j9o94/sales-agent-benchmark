/**
 * V2 Benchmark Types — Real-World Evaluation with Artifact-Based Context
 *
 * V2 replaces LLM-generated checkpoint summaries with real deal artifacts:
 * call transcripts, email threads, CRM snapshots, documents, Slack threads,
 * and calendar events. Models are evaluated on their ability to extract
 * insight from messy, unstructured multi-source data.
 *
 * V1 types in benchmark.ts remain untouched. The benchmark runner detects
 * the `version` field and routes accordingly.
 */

// ---------------------------------------------------------------------------
// Artifact Types
// ---------------------------------------------------------------------------

/** Base fields shared by all artifact types */
export interface ArtifactBase {
  id: string;
  dealId: string;
  sourceFile?: string;
  createdAt: string; // ISO date
  anonymized: boolean;
}

/** A single turn in a transcript */
export interface TranscriptTurn {
  speaker: "me" | "them";
  speakerName?: string;
  text: string;
  timestamp?: string;
}

/** Call / meeting transcript (Granola AI format) */
export interface TranscriptArtifact extends ArtifactBase {
  type: "transcript";
  title: string;
  rawText: string;
  turns: TranscriptTurn[];
  attendees: string[];
  date: string; // ISO date
  duration?: number; // minutes
  keyTakeaways?: string[];
}

/** A single message in an email thread */
export interface EmailMessage {
  from: string;
  to: string[];
  cc?: string[];
  date: string;
  body: string;
}

/** Email thread */
export interface EmailArtifact extends ArtifactBase {
  type: "email";
  subject: string;
  messages: EmailMessage[];
  participants: string[];
}

/** CRM activity log entry */
export interface CrmActivityEntry {
  date: string;
  type: string; // "call" | "email" | "meeting" | "note" | "stage_change" | etc.
  description: string;
}

/** CRM snapshot (HubSpot / context.md parsed data) */
export interface CrmSnapshotArtifact extends ArtifactBase {
  type: "crm_snapshot";
  dealProperties: {
    stage: string;
    amount?: string;
    closeDate?: string;
    pipeline?: string;
    lastContactedDate?: string;
  };
  contacts: {
    name: string;
    title?: string;
    role?: string;
    email?: string;
  }[];
  notes: string[];
  activityLog: CrmActivityEntry[];
}

/** Extracted text from a document (PPTX, DOCX, XLSX, etc.) */
export interface DocumentArtifact extends ArtifactBase {
  type: "document";
  title: string;
  documentType: "pptx" | "docx" | "xlsx" | "pdf" | "other";
  content: string; // extracted text
  metadata?: Record<string, string>;
}

/** A single Slack message */
export interface SlackMessage {
  author: string;
  text: string;
  timestamp: string;
  threadReply?: boolean;
}

/** Slack thread / channel messages */
export interface SlackThreadArtifact extends ArtifactBase {
  type: "slack_thread";
  channel: string;
  messages: SlackMessage[];
}

/** Calendar event */
export interface CalendarEventArtifact extends ArtifactBase {
  type: "calendar_event";
  title: string;
  date: string; // ISO datetime
  duration: number; // minutes
  attendees: string[];
  description?: string;
  location?: string;
}

/** Union of all artifact types */
export type Artifact =
  | TranscriptArtifact
  | EmailArtifact
  | CrmSnapshotArtifact
  | DocumentArtifact
  | SlackThreadArtifact
  | CalendarEventArtifact;

/** Artifact type discriminator */
export type ArtifactType = Artifact["type"];

/** Lightweight reference to an artifact (used in checkpoints) */
export interface ArtifactReference {
  artifactId: string;
  type: ArtifactType;
  title: string;
  date: string;
}

// ---------------------------------------------------------------------------
// Stakeholders & MEDDPICC
// ---------------------------------------------------------------------------

export interface V2Stakeholder {
  name: string;
  title?: string;
  role: string; // "champion" | "economic_buyer" | "technical_evaluator" | "blocker" | etc.
  sentiment: "positive" | "neutral" | "negative" | "unknown";
  notes?: string;
  firstMentionedIn?: string; // artifact ID
}

export interface MeddpiccElement {
  status: "green" | "yellow" | "red" | "unknown";
  notes: string;
  evidence?: string[]; // artifact IDs providing evidence
}

export interface MeddpiccState {
  metrics?: MeddpiccElement;
  economicBuyer?: MeddpiccElement;
  decisionCriteria?: MeddpiccElement;
  decisionProcess?: MeddpiccElement;
  paperProcess?: MeddpiccElement;
  pain?: MeddpiccElement;
  champion?: MeddpiccElement;
  competition?: MeddpiccElement;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** V2 scoring dimensions (8 total, backward-compatible with v1's 4) */
export interface V2ScoringDimensions {
  // V1 dimensions (always scored)
  riskIdentification: number;    // 0-10
  nextStepQuality: number;       // 0-10
  prioritization: number;        // 0-10
  outcomeAlignment: number;      // 0-10

  // V2 dimensions (scored when relevant to task type)
  stakeholderMapping?: number;   // 0-10
  dealQualification?: number;    // 0-10
  informationSynthesis?: number; // 0-10
  communicationQuality?: number; // 0-10
}

/** Which dimensions are relevant for a given task */
export type ScoringDimensionKey = keyof V2ScoringDimensions;

export const V1_DIMENSIONS: ScoringDimensionKey[] = [
  "riskIdentification",
  "nextStepQuality",
  "prioritization",
  "outcomeAlignment",
];

export const V2_DIMENSIONS: ScoringDimensionKey[] = [
  ...V1_DIMENSIONS,
  "stakeholderMapping",
  "dealQualification",
  "informationSynthesis",
  "communicationQuality",
];

// ---------------------------------------------------------------------------
// Evaluation Tasks
// ---------------------------------------------------------------------------

export type EvaluationTaskType =
  | "deal_analysis"
  | "call_summary"
  | "follow_up_draft"
  | "stakeholder_analysis"
  | "risk_assessment"
  | "deal_qualification"
  | "objection_handling"
  | "action_items";

export interface EvaluationTask {
  id: string;
  type: EvaluationTaskType;
  prompt: string;
  requiredArtifacts: string[];  // artifact IDs the agent must receive
  optionalArtifacts: string[];  // artifact IDs available on request
  scoringDimensions: ScoringDimensionKey[];
  maxTurns?: number; // for multi-turn evaluation (default: 1)
}

// ---------------------------------------------------------------------------
// Ground Truth
// ---------------------------------------------------------------------------

export interface V2GroundTruth {
  whatHappenedNext: string;
  actualRisksThatMaterialized: string[];
  outcomeAtThisPoint: "progressing" | "stalled" | "at_risk" | "won" | "lost";
  keyInsights?: string[];
  evidenceArtifacts?: string[]; // artifact IDs supporting ground truth
}

// ---------------------------------------------------------------------------
// Checkpoints & Deals
// ---------------------------------------------------------------------------

export interface V2Checkpoint {
  id: string;
  dealId: string;
  version: 2;
  timestamp: string; // ISO date — the point in time this checkpoint represents
  availableArtifacts: ArtifactReference[];
  dealSnapshot: {
    company: string;
    stage: string;
    amount?: string;
    daysSinceFirstContact: number;
  };
  stakeholders: V2Stakeholder[];
  meddpicc?: MeddpiccState;
  groundTruth: V2GroundTruth;
  tasks: EvaluationTask[];
}

export interface V2Deal {
  id: string;
  name: string;
  version: 2;
  industry?: string;
  artifacts: Record<string, Artifact>; // keyed by artifact ID
  checkpoints: V2Checkpoint[];
  finalOutcome: "won" | "lost" | "stalled" | "active";
  metadata?: {
    sourceDeals?: string[]; // original deal directory names (before anonymization)
    transcriptCount: number;
    artifactCount: number;
    dateRange: { start: string; end: string };
  };
}

// ---------------------------------------------------------------------------
// V2 Agent API Contract
// ---------------------------------------------------------------------------

/** Request sent to an agent for a v2 evaluation task */
export interface V2AgentRequest {
  version: 2;
  checkpointId: string;
  taskId: string;
  taskType: EvaluationTaskType;
  prompt: string;
  artifacts: Artifact[];       // initial artifacts provided
  dealSnapshot: V2Checkpoint["dealSnapshot"];
  stakeholders: V2Stakeholder[];
  meddpicc?: MeddpiccState;
  turnNumber: number;          // 1-based, increments on multi-turn
  maxTurns: number;
}

/** Response from an agent */
export interface V2AgentResponse {
  version: 2;
  reasoning: string;
  answer: string;
  artifactRequests?: string[]; // artifact IDs to request (multi-turn)
  isComplete: boolean;         // false = agent wants more artifacts
  risks?: {
    description: string;
    severity: "high" | "medium" | "low";
  }[];
  nextSteps?: {
    action: string;
    priority: number;
    rationale?: string;
  }[];
  confidence: number;          // 0-1
}

// ---------------------------------------------------------------------------
// V2 Evaluation Results
// ---------------------------------------------------------------------------

export interface V2TaskEvaluation {
  taskId: string;
  taskType: EvaluationTaskType;
  turnsUsed: number;
  scores: V2ScoringDimensions;
  feedback: string;
  artifactsRequested: string[];
  judgeModel?: string;
}

export interface V2CheckpointEvaluation {
  checkpointId: string;
  taskEvaluations: V2TaskEvaluation[];
  aggregateScores: V2ScoringDimensions;
  totalScore: number;
  maxScore: number;
}

export interface V2BenchmarkResult {
  agentId: string;
  agentEndpoint: string;
  version: 2;
  mode: "public" | "private";
  runTimestamp: string;
  dealResults: {
    dealId: string;
    checkpointEvaluations: V2CheckpointEvaluation[];
    dealScore: number;
  }[];
  aggregateScore: number;
  maxPossibleScore: number;
  aggregateDimensions: V2ScoringDimensions;
}

// ---------------------------------------------------------------------------
// Pipeline Types (used by scripts/v2/)
// ---------------------------------------------------------------------------

/** Configuration for a pipeline run */
export interface PipelineConfig {
  dealsDir: string;
  outputDir: string;
  deals?: string[];         // specific deal names to process (all if omitted)
  skipExternal?: boolean;   // skip HubSpot/Gmail/Slack/Calendar ingestion
  dryRun?: boolean;         // validate without writing output
  anonymize?: boolean;      // default true
}

/** Result of processing a single deal through the pipeline */
export interface PipelineResult {
  dealId: string;
  dealName: string;
  success: boolean;
  artifactCount: number;
  checkpointCount: number;
  warnings: string[];
  errors: string[];
}

/** Summary of a complete pipeline run */
export interface PipelineSummary {
  startedAt: string;
  completedAt: string;
  config: PipelineConfig;
  results: PipelineResult[];
  totalArtifacts: number;
  totalCheckpoints: number;
  dealsProcessed: number;
  dealsFailed: number;
}

// ---------------------------------------------------------------------------
// Deal Tier Classification (for pipeline prioritization)
// ---------------------------------------------------------------------------

export type DealTier = "v2-rich" | "v2-standard" | "v1-only";

export interface DealClassification {
  dealDir: string;
  tier: DealTier;
  transcriptCount: number;
  hasContextMd: boolean;
  hasOutputs: boolean;
}
