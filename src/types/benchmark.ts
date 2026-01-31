/**
 * Types for the Sales Agent Benchmark
 */

// Stakeholder information
export interface Stakeholder {
  name: string;
  role: string;
  title?: string;
  sentiment?: "positive" | "neutral" | "negative" | "unknown";
  notes?: string;
}

// Deal context at a checkpoint
export interface DealContext {
  company: string;
  stage: string;
  amount?: string;
  closeDate?: string;
  lastInteraction: string;
  painPoints: string[];
  stakeholders: Stakeholder[];
  timeline?: string;
  hypothesis?: {
    whyTheyWillBuy: string[];
    whyTheyMightNot: string[];
    whatNeedsToBeTrue: string[];
  };
  meddpicc?: {
    metrics?: { status: string; notes: string };
    economicBuyer?: { status: string; notes: string };
    decisionCriteria?: { status: string; notes: string };
    decisionProcess?: { status: string; notes: string };
    paperProcess?: { status: string; notes: string };
    pain?: { status: string; notes: string };
    champion?: { status: string; notes: string };
    competition?: { status: string; notes: string };
  };
  competitiveLandscape?: string;
  techStack?: string[];
  useCases?: string[];
  history: string;
}

// Ground truth for what actually happened
export interface GroundTruth {
  whatHappenedNext: string;
  actualRisksThatMaterialized: string[];
  outcomeAtThisPoint: "progressing" | "stalled" | "at_risk" | "won" | "lost";
  keyInsights?: string[];
}

// A single checkpoint in a deal timeline
export interface Checkpoint {
  id: string;
  dealId: string;
  timestamp: string;
  context: DealContext;
  groundTruth: GroundTruth;
}

// Complete deal with all checkpoints
export interface Deal {
  id: string;
  name: string;
  industry?: string;
  checkpoints: Checkpoint[];
  finalOutcome: "won" | "lost" | "stalled" | "active";
  summary?: string;
}

// API Request to user's agent
export interface AgentRequest {
  checkpointId: string;
  dealContext: DealContext;
  question: string;
}

// Risk identified by agent
export interface Risk {
  description: string;
  severity: "high" | "medium" | "low";
}

// Next step recommended by agent
export interface NextStep {
  action: string;
  priority: number;
  rationale?: string;
}

// Expected Response from user's agent
export interface AgentResponse {
  risks: Risk[];
  nextSteps: NextStep[];
  confidence: number;
  reasoning: string;
}

// Evaluation scores for a single response
export interface EvaluationScores {
  riskIdentification: number; // 0-10: Did agent flag actual blockers?
  nextStepQuality: number; // 0-10: Were recommendations actionable and correct?
  prioritization: number; // 0-10: Did agent focus on what mattered?
  outcomeAlignment: number; // 0-10: Did recommendations align with what worked?
}

// Evaluation result for a checkpoint
export interface CheckpointEvaluation {
  checkpointId: string;
  scores: EvaluationScores;
  totalScore: number;
  maxScore: number;
  feedback: string;
  groundTruthComparison?: {
    risksIdentified: string[];
    risksMissed: string[];
    helpfulRecommendations: string[];
    unhelpfulRecommendations: string[];
  };
}

// Benchmark run result
export interface BenchmarkResult {
  agentId: string;
  agentEndpoint: string;
  mode: "public" | "private";
  runTimestamp: string;
  dealResults: {
    dealId: string;
    checkpointEvaluations: CheckpointEvaluation[];
    dealScore: number;
  }[];
  aggregateScore: number;
  maxPossibleScore: number;
  percentile?: number;
}

// Registered agent
export interface RegisteredAgent {
  id: string;
  endpoint: string;
  name?: string;
  registeredAt: string;
  apiKey: string;
}
