#!/usr/bin/env bun
/**
 * Multi-Model Benchmark Script
 *
 * Runs the Sales Agent Benchmark against multiple LLM models using OpenRouter,
 * evaluates responses with multi-judge panel, and saves results to the database.
 *
 * Full Dataset Mode:
 * - Evaluates ALL 15 deals (36 checkpoints)
 * - Public deals (5): Full feedback stored and visible to users
 * - Private deals (10): Scores only, no detailed feedback (prevents gaming)
 * - Leaderboard shows combined score from both sets
 *
 * Usage:
 *   bun scripts/benchmark-models.ts                    # Run all models on full dataset
 *   bun scripts/benchmark-models.ts --models gpt-5.2,claude-4.5-sonnet
 *   bun scripts/benchmark-models.ts --dry-run          # Test without saving
 *   bun scripts/benchmark-models.ts --single-judge     # Use single judge (faster)
 *   bun scripts/benchmark-models.ts --reset            # Clear database before running
 *   bun scripts/benchmark-models.ts --public-only      # Only run public deals (for testing)
 *   bun scripts/benchmark-models.ts --resume           # Skip already-completed models
 *   bun scripts/benchmark-models.ts --parallel=4       # Run 4 models concurrently
 */

import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { sql } from "@vercel/postgres";
import type {
  Deal,
  Checkpoint,
  AgentRequest,
  AgentResponse,
  EvaluationScores,
} from "../src/types/benchmark";
import {
  evaluateResponse,
  evaluateResponseMultiJudge,
  type JudgeEvaluation,
  type MultiJudgeCheckpointEvaluation,
} from "../api/evaluate-response";
import {
  saveBenchmarkRun,
  saveJudgeEvaluation,
  initDatabase,
} from "../api/results";

// ============================================================================
// Configuration
// ============================================================================

// OpenRouter client
const openrouter = createOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  headers: {
    "HTTP-Referer": "https://sales-agent-benchmarks.fly.dev",
    "X-Title": "Sales Agent Benchmark",
  },
});

// Models to benchmark (based on OpenRouter rankings Jan 2026)
export const BENCHMARK_MODELS = [
  // Frontier tier
  {
    id: "gpt-5.2",
    name: "GPT-5.2",
    openrouterId: "openai/gpt-5.2-20251211",
    tier: "frontier",
  },
  {
    id: "claude-4.5-opus",
    name: "Claude 4.5 Opus",
    openrouterId: "anthropic/claude-4.5-opus-20251124",
    tier: "frontier",
  },
  {
    id: "claude-4.5-sonnet",
    name: "Claude 4.5 Sonnet",
    openrouterId: "anthropic/claude-4.5-sonnet-20250929",
    tier: "frontier",
  },
  {
    id: "gemini-3-pro",
    name: "Gemini 3 Pro Preview",
    openrouterId: "google/gemini-3-pro-preview-20251117",
    tier: "frontier",
  },
  // Fast tier
  {
    id: "gemini-3-flash",
    name: "Gemini 3 Flash Preview",
    openrouterId: "google/gemini-3-flash-preview-20251217",
    tier: "fast",
  },
  {
    id: "grok-4.1-fast",
    name: "Grok 4.1 Fast",
    openrouterId: "x-ai/grok-4.1-fast",
    tier: "fast",
  },
  // Mid tier
  {
    id: "kimi-k2.5",
    name: "Kimi K2.5",
    openrouterId: "moonshotai/kimi-k2.5-0127",
    tier: "mid",
  },
  {
    id: "devstral-2512",
    name: "Devstral 2512",
    openrouterId: "mistralai/devstral-2512",
    tier: "mid",
  },
  // Value tier
  {
    id: "deepseek-v3.2",
    name: "DeepSeek V3.2",
    openrouterId: "deepseek/deepseek-v3.2-20251201",
    tier: "value",
  },
  // Specialized
  {
    id: "qwen3-coder-480b",
    name: "Qwen 3 Coder 480B",
    openrouterId: "qwen/qwen3-coder-480b-a35b-07-25",
    tier: "specialized",
  },
  // Budget tier
  {
    id: "claude-4.5-haiku",
    name: "Claude 4.5 Haiku",
    openrouterId: "anthropic/claude-4.5-haiku-20251001",
    tier: "budget",
  },
  {
    id: "gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash Lite",
    openrouterId: "google/gemini-2.5-flash-lite",
    tier: "budget",
  },
] as const;

export type ModelConfig = (typeof BENCHMARK_MODELS)[number];

// Sales agent system prompt (same as api/agent.ts)
const SALES_AGENT_SYSTEM_PROMPT = `You are an expert sales analyst evaluating deal situations. Your role is to:

1. IDENTIFY RISKS - What could prevent this deal from closing? Consider:
   - Missing stakeholder buy-in
   - Competitive threats
   - Budget/timing concerns
   - Technical blockers
   - Champion weakness
   - Decision process gaps

2. RECOMMEND NEXT STEPS - What should happen to advance this deal? Prioritize:
   - Actions that address the highest risks
   - Steps that build momentum
   - Activities that create urgency
   - Moves that expand the coalition

3. ASSESS CONFIDENCE - How likely is this deal to progress successfully?

Be specific, not generic. Reference the actual stakeholders, pain points, and dynamics in the deal.

IMPORTANT: Return your analysis as JSON in this exact format:
{
  "risks": [
    {"description": "specific risk description", "severity": "high|medium|low"}
  ],
  "nextSteps": [
    {"action": "specific action to take", "priority": 1, "rationale": "why this matters"}
  ],
  "confidence": 0.0-1.0,
  "reasoning": "2-3 sentences explaining your overall assessment"
}`;

// ============================================================================
// Constants
// ============================================================================

// API call timeout in milliseconds (60 seconds)
const API_TIMEOUT_MS = 60000;

// Retry configuration
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

// Maximum failure rate before skipping model (25%)
const MAX_FAILURE_RATE = 0.25;

// Maximum parallel execution (rate limit safety)
const MAX_PARALLEL = 6;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Retry wrapper with exponential backoff
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  description: string,
  maxRetries = MAX_RETRIES,
  baseDelayMs = BASE_DELAY_MS
): Promise<T> {
  let lastError: Error | unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries) {
        console.error(`  ❌ ${description} failed after ${maxRetries} attempts`);
        throw error;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.log(`  ⚠️  ${description} failed (attempt ${attempt}/${maxRetries}): ${errorMsg}`);
      console.log(`      Retrying in ${delay}ms...`);
      await Bun.sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Promise.race with timeout
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  description: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timeout after ${timeoutMs}ms: ${description}`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

/**
 * Get models that have already been completed in the last 24 hours
 * Used for --resume functionality to skip already-benchmarked models
 */
async function getCompletedModels(expectedCheckpoints: number): Promise<Set<string>> {
  try {
    const result = await sql`
      SELECT DISTINCT agent_id FROM benchmark_runs
      WHERE checkpoints_evaluated = ${expectedCheckpoints}
      AND run_timestamp > NOW() - INTERVAL '24 hours'
    `;
    return new Set(result.rows.map((r) => r.agent_id as string));
  } catch (error) {
    console.error("Warning: Could not fetch completed models:", error);
    return new Set();
  }
}

/**
 * Run async functions with limited concurrency (semaphore pattern)
 */
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  const executing: Promise<void>[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item === undefined) continue;

    const p = fn(item, i).then(() => {
      executing.splice(executing.indexOf(p), 1);
    });
    executing.push(p);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
}

function buildDealContextPrompt(request: AgentRequest): string {
  const contextParts: string[] = [
    `## Deal: ${request.dealContext.company}`,
    `**Stage:** ${request.dealContext.stage}`,
    request.dealContext.amount ? `**Deal Size:** ${request.dealContext.amount}` : "",
    request.dealContext.closeDate ? `**Target Close:** ${request.dealContext.closeDate}` : "",
    request.dealContext.timeline ? `**Timeline:** ${request.dealContext.timeline}` : "",
    "",
    `**Last Interaction:** ${request.dealContext.lastInteraction}`,
    "",
    "### Pain Points:",
    ...request.dealContext.painPoints.map((p) => `- ${p}`),
    "",
    "### Stakeholders:",
    ...request.dealContext.stakeholders.map(
      (s) =>
        `- **${s.name}** (${s.role}${s.title ? `, ${s.title}` : ""}) - ${s.sentiment || "unknown"} sentiment${s.notes ? `: ${s.notes}` : ""}`
    ),
  ];

  // Add hypothesis if available
  if (request.dealContext.hypothesis) {
    contextParts.push("", "### Hypothesis:");
    if (request.dealContext.hypothesis.whyTheyWillBuy.length > 0) {
      contextParts.push("**Why they'll buy:**");
      contextParts.push(...request.dealContext.hypothesis.whyTheyWillBuy.map((r) => `- ${r}`));
    }
    if (request.dealContext.hypothesis.whyTheyMightNot.length > 0) {
      contextParts.push("**Why they might not:**");
      contextParts.push(...request.dealContext.hypothesis.whyTheyMightNot.map((r) => `- ${r}`));
    }
  }

  // Add MEDDPICC if available
  if (request.dealContext.meddpicc) {
    const m = request.dealContext.meddpicc;
    contextParts.push("", "### MEDDPICC Status:");
    if (m.metrics) contextParts.push(`- **Metrics:** ${m.metrics.status} - ${m.metrics.notes}`);
    if (m.economicBuyer)
      contextParts.push(`- **Economic Buyer:** ${m.economicBuyer.status} - ${m.economicBuyer.notes}`);
    if (m.decisionCriteria)
      contextParts.push(
        `- **Decision Criteria:** ${m.decisionCriteria.status} - ${m.decisionCriteria.notes}`
      );
    if (m.decisionProcess)
      contextParts.push(
        `- **Decision Process:** ${m.decisionProcess.status} - ${m.decisionProcess.notes}`
      );
    if (m.paperProcess)
      contextParts.push(`- **Paper Process:** ${m.paperProcess.status} - ${m.paperProcess.notes}`);
    if (m.pain) contextParts.push(`- **Pain:** ${m.pain.status} - ${m.pain.notes}`);
    if (m.champion) contextParts.push(`- **Champion:** ${m.champion.status} - ${m.champion.notes}`);
    if (m.competition)
      contextParts.push(`- **Competition:** ${m.competition.status} - ${m.competition.notes}`);
  }

  // Add history
  if (request.dealContext.history) {
    contextParts.push("", "### Deal History:", request.dealContext.history);
  }

  const contextString = contextParts.filter(Boolean).join("\n");

  return `${contextString}

---

**Question:** ${request.question}

Analyze this deal situation and provide your assessment as JSON.`;
}

// Load deals from a directory
async function loadDealsFromDir(dirPath: string): Promise<Deal[]> {
  const deals: Deal[] = [];

  try {
    const dir = await Bun.$`ls ${dirPath}/*.json`.text();
    const files = dir.trim().split("\n").filter(Boolean);

    for (const filePath of files) {
      try {
        const file = Bun.file(filePath.trim());
        const content = await file.json();
        deals.push(content as Deal);
      } catch (error) {
        console.error(`Failed to load ${filePath}:`, error);
      }
    }
  } catch (error) {
    console.error(`Failed to list deals in ${dirPath}:`, error);
  }

  return deals;
}

// Load public deals (5 deals, 14 checkpoints)
async function loadPublicDeals(): Promise<Deal[]> {
  return loadDealsFromDir("data/checkpoints/public");
}

// Load private deals (10 deals, 22 checkpoints)
async function loadPrivateDeals(): Promise<Deal[]> {
  return loadDealsFromDir("data/checkpoints/private");
}

// Load all deals (public + private)
async function loadAllDeals(): Promise<{ publicDeals: Deal[]; privateDeals: Deal[] }> {
  const [publicDeals, privateDeals] = await Promise.all([
    loadPublicDeals(),
    loadPrivateDeals(),
  ]);
  return { publicDeals, privateDeals };
}

// Error marker used to detect failed evaluations
const ERROR_MARKER = "[API_ERROR]";

// Query a model via OpenRouter with retry and timeout
async function queryModel(
  model: ModelConfig,
  prompt: string
): Promise<{ response: AgentResponse; failed: boolean }> {
  const makeRequest = async (): Promise<AgentResponse> => {
    const apiCall = generateText({
      model: openrouter(model.openrouterId),
      system: SALES_AGENT_SYSTEM_PROMPT,
      prompt,
    });

    const result = await withTimeout(
      apiCall,
      API_TIMEOUT_MS,
      `${model.name} API call`
    );

    // Parse the JSON response
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in model response");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate and normalize the response
    const response: AgentResponse = {
      risks: (parsed.risks || []).map((r: Record<string, unknown>) => ({
        description: String(r.description || "Unknown risk"),
        severity: ["high", "medium", "low"].includes(r.severity as string)
          ? (r.severity as "high" | "medium" | "low")
          : "medium",
      })),
      nextSteps: (parsed.nextSteps || parsed.next_steps || []).map(
        (s: Record<string, unknown>, idx: number) => ({
          action: String(s.action || "No action specified"),
          priority: typeof s.priority === "number" ? s.priority : idx + 1,
          rationale: s.rationale as string | undefined,
        })
      ),
      confidence:
        typeof parsed.confidence === "number" ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
      reasoning: String(parsed.reasoning || "No reasoning provided"),
    };

    return response;
  };

  try {
    const response = await withRetry(
      makeRequest,
      `Query ${model.name}`,
      MAX_RETRIES,
      BASE_DELAY_MS
    );
    return { response, failed: false };
  } catch (error) {
    console.error(`  ❌ Failed to query ${model.name} after retries:`, error);

    // Return a fallback response marked as failed
    return {
      response: {
        risks: [{ description: "Unable to analyze deal - error in processing", severity: "high" }],
        nextSteps: [{ action: "Review deal context and try again", priority: 1 }],
        confidence: 0,
        reasoning: `${ERROR_MARKER} ${error instanceof Error ? error.message : "Unknown error"}`,
      },
      failed: true,
    };
  }
}

// ============================================================================
// Benchmark Runner
// ============================================================================

interface CheckpointResult {
  checkpointId: string;
  response: AgentResponse;
  latencyMs: number;
  evaluation: MultiJudgeCheckpointEvaluation;
}

interface DealResult {
  dealId: string;
  dealName: string;
  checkpointResults: CheckpointResult[];
  dealScore: number;
  maxScore: number;
}

// Result for evaluating a set of deals (public or private)
interface DealSetResult {
  dealResults: DealResult[];
  score: number;
  maxScore: number;
  checkpointCount: number;
  totalLatencyMs: number;
  scores: EvaluationScores;
  failedCheckpoints: number;
}

// Full benchmark result including both public and private evaluations
interface ModelBenchmarkResult {
  model: ModelConfig;
  // Public results (with full detail)
  publicDealResults: DealResult[];
  publicScore: number;
  publicMaxScore: number;
  publicCheckpoints: number;
  // Private results (scores only)
  privateDealScores: { dealId: string; dealName: string; score: number; maxScore: number }[];
  privateScore: number;
  privateMaxScore: number;
  privateCheckpoints: number;
  // Combined totals
  aggregateScore: number;
  maxPossibleScore: number;
  percentage: number;
  avgLatencyMs: number;
  totalCheckpoints: number;
  scores: EvaluationScores;
  // Failure tracking
  failedCheckpoints: number;
  tooManyFailures: boolean;
}

// Evaluate a set of deals (used for both public and private)
async function evaluateDeals(
  model: ModelConfig,
  deals: Deal[],
  mode: "public" | "private",
  options: { multiJudge: boolean; verbose: boolean }
): Promise<DealSetResult> {
  const dealResults: DealResult[] = [];
  let totalScore = 0;
  let totalMaxScore = 0;
  let totalLatencyMs = 0;
  let checkpointCount = 0;
  let failedCheckpoints = 0;

  const aggregatedScores: EvaluationScores = {
    riskIdentification: 0,
    nextStepQuality: 0,
    prioritization: 0,
    outcomeAlignment: 0,
  };

  for (const deal of deals) {
    const checkpointResults: CheckpointResult[] = [];
    let dealScore = 0;

    for (const checkpoint of deal.checkpoints) {
      // Build the request
      const request: AgentRequest = {
        checkpointId: checkpoint.id,
        dealContext: checkpoint.context,
        question: "What are the top risks and recommended next steps for this deal?",
      };

      // Query the model with retry and timeout
      const prompt = buildDealContextPrompt(request);
      const startTime = Date.now();
      const { response, failed } = await queryModel(model, prompt);
      const latencyMs = Date.now() - startTime;

      // Track failures
      if (failed) {
        failedCheckpoints++;
        if (options.verbose) {
          console.log(`    ❌ ${checkpoint.id}: FAILED - ${latencyMs}ms`);
        }
      }

      // Evaluate the response (even if failed, to maintain consistent structure)
      // Note: mode determines whether groundTruthComparison is included
      let evaluation: MultiJudgeCheckpointEvaluation;
      try {
        if (options.multiJudge) {
          evaluation = await withRetry(
            () => evaluateResponseMultiJudge(checkpoint, response, mode),
            `Evaluate ${checkpoint.id}`,
            MAX_RETRIES,
            BASE_DELAY_MS
          );
        } else {
          const singleEval = await withRetry(
            () => evaluateResponse(checkpoint, response, mode),
            `Evaluate ${checkpoint.id}`,
            MAX_RETRIES,
            BASE_DELAY_MS
          );
          evaluation = singleEval as MultiJudgeCheckpointEvaluation;
        }
      } catch (evalError) {
        // If evaluation fails even after retries, create a zero-score evaluation
        console.error(`    ❌ Failed to evaluate ${checkpoint.id}:`, evalError);
        failedCheckpoints++;
        evaluation = {
          checkpointId: checkpoint.id,
          scores: { riskIdentification: 0, nextStepQuality: 0, prioritization: 0, outcomeAlignment: 0 },
          totalScore: 0,
          maxScore: 40,
          feedback: `${ERROR_MARKER} Evaluation failed: ${evalError instanceof Error ? evalError.message : String(evalError)}`,
        };
      }

      // Record results
      checkpointResults.push({
        checkpointId: checkpoint.id,
        response,
        latencyMs,
        evaluation,
      });

      dealScore += evaluation.totalScore;
      totalLatencyMs += latencyMs;
      checkpointCount++;

      // Aggregate dimension scores
      aggregatedScores.riskIdentification += evaluation.scores.riskIdentification;
      aggregatedScores.nextStepQuality += evaluation.scores.nextStepQuality;
      aggregatedScores.prioritization += evaluation.scores.prioritization;
      aggregatedScores.outcomeAlignment += evaluation.scores.outcomeAlignment;

      // Progress indicator (only verbose for public)
      if (options.verbose && !failed) {
        const pct = Math.round((evaluation.totalScore / 40) * 100);
        process.stdout.write(`    ${checkpoint.id}: ${evaluation.totalScore}/40 (${pct}%) - ${latencyMs}ms\n`);
      }
    }

    const maxScore = deal.checkpoints.length * 40;
    totalScore += dealScore;
    totalMaxScore += maxScore;

    dealResults.push({
      dealId: deal.id,
      dealName: deal.name,
      checkpointResults,
      dealScore,
      maxScore,
    });

    if (options.verbose) {
      const dealPct = Math.round((dealScore / maxScore) * 100);
      console.log(`    ${deal.name}: ${dealScore}/${maxScore} (${dealPct}%)`);
    }
  }

  // Calculate averages
  if (checkpointCount > 0) {
    aggregatedScores.riskIdentification /= checkpointCount;
    aggregatedScores.nextStepQuality /= checkpointCount;
    aggregatedScores.prioritization /= checkpointCount;
    aggregatedScores.outcomeAlignment /= checkpointCount;
  }

  return {
    dealResults,
    score: totalScore,
    maxScore: totalMaxScore,
    checkpointCount,
    totalLatencyMs,
    scores: aggregatedScores,
    failedCheckpoints,
  };
}

// Benchmark a model against both public and private deals
async function benchmarkModel(
  model: ModelConfig,
  publicDeals: Deal[],
  privateDeals: Deal[],
  options: { multiJudge: boolean; dryRun: boolean; publicOnly: boolean }
): Promise<ModelBenchmarkResult> {
  console.log(`\n[${model.id}] ${model.name} (${model.tier})`);

  // Evaluate PUBLIC deals (full feedback stored)
  console.log(`\n  PUBLIC DEALS (visible results):`);
  const publicResults = await evaluateDeals(model, publicDeals, "public", {
    multiJudge: options.multiJudge,
    verbose: true,
  });
  const publicPct = Math.round((publicResults.score / publicResults.maxScore) * 100);
  console.log(`  → Public: ${publicResults.score}/${publicResults.maxScore} (${publicPct}%)`);
  if (publicResults.failedCheckpoints > 0) {
    console.log(`  ⚠️  ${publicResults.failedCheckpoints} checkpoint(s) failed in public deals`);
  }

  // Evaluate PRIVATE deals (score only, no detailed feedback)
  let privateResults: DealSetResult;
  if (options.publicOnly || privateDeals.length === 0) {
    // Skip private deals
    privateResults = {
      dealResults: [],
      score: 0,
      maxScore: 0,
      checkpointCount: 0,
      totalLatencyMs: 0,
      scores: { riskIdentification: 0, nextStepQuality: 0, prioritization: 0, outcomeAlignment: 0 },
      failedCheckpoints: 0,
    };
    console.log(`\n  PRIVATE DEALS: Skipped (--public-only mode)`);
  } else {
    console.log(`\n  PRIVATE DEALS (scores only):`);
    privateResults = await evaluateDeals(model, privateDeals, "private", {
      multiJudge: options.multiJudge,
      verbose: false, // Don't show detailed output for private deals
    });
    const privatePct = Math.round((privateResults.score / privateResults.maxScore) * 100);
    console.log(`  → Private: ${privateResults.score}/${privateResults.maxScore} (${privatePct}%)`);
    if (privateResults.failedCheckpoints > 0) {
      console.log(`  ⚠️  ${privateResults.failedCheckpoints} checkpoint(s) failed in private deals`);
    }
  }

  // Combine scores
  const combinedScore = publicResults.score + privateResults.score;
  const combinedMaxScore = publicResults.maxScore + privateResults.maxScore;
  const combinedPct = Math.round((combinedScore / combinedMaxScore) * 100);
  const totalCheckpoints = publicResults.checkpointCount + privateResults.checkpointCount;
  const totalLatencyMs = publicResults.totalLatencyMs + privateResults.totalLatencyMs;
  const avgLatencyMs = totalCheckpoints > 0 ? Math.round(totalLatencyMs / totalCheckpoints) : 0;
  const totalFailedCheckpoints = publicResults.failedCheckpoints + privateResults.failedCheckpoints;

  // Check if too many checkpoints failed
  const failureRate = totalCheckpoints > 0 ? totalFailedCheckpoints / totalCheckpoints : 0;
  const tooManyFailures = failureRate > MAX_FAILURE_RATE;

  // Combine dimension scores (weighted average)
  const combinedScores: EvaluationScores = {
    riskIdentification: 0,
    nextStepQuality: 0,
    prioritization: 0,
    outcomeAlignment: 0,
  };
  if (totalCheckpoints > 0) {
    const pubWeight = publicResults.checkpointCount / totalCheckpoints;
    const privWeight = privateResults.checkpointCount / totalCheckpoints;
    combinedScores.riskIdentification =
      publicResults.scores.riskIdentification * pubWeight +
      privateResults.scores.riskIdentification * privWeight;
    combinedScores.nextStepQuality =
      publicResults.scores.nextStepQuality * pubWeight +
      privateResults.scores.nextStepQuality * privWeight;
    combinedScores.prioritization =
      publicResults.scores.prioritization * pubWeight +
      privateResults.scores.prioritization * privWeight;
    combinedScores.outcomeAlignment =
      publicResults.scores.outcomeAlignment * pubWeight +
      privateResults.scores.outcomeAlignment * privWeight;
  }

  console.log(`\n  COMBINED SCORE: ${combinedScore}/${combinedMaxScore} (${combinedPct}%) | Avg latency: ${avgLatencyMs}ms`);

  if (tooManyFailures) {
    const failPct = Math.round(failureRate * 100);
    console.log(`  ❌ TOO MANY FAILURES: ${totalFailedCheckpoints}/${totalCheckpoints} (${failPct}%) - results will NOT be saved`);
  }

  // Extract private deal scores (just score summary, no detailed results)
  const privateDealScores = privateResults.dealResults.map((dr) => ({
    dealId: dr.dealId,
    dealName: dr.dealName,
    score: dr.dealScore,
    maxScore: dr.maxScore,
  }));

  return {
    model,
    // Public results (with full detail)
    publicDealResults: publicResults.dealResults,
    publicScore: publicResults.score,
    publicMaxScore: publicResults.maxScore,
    publicCheckpoints: publicResults.checkpointCount,
    // Private results (scores only)
    privateDealScores,
    privateScore: privateResults.score,
    privateMaxScore: privateResults.maxScore,
    privateCheckpoints: privateResults.checkpointCount,
    // Combined totals
    aggregateScore: combinedScore,
    maxPossibleScore: combinedMaxScore,
    percentage: combinedPct,
    avgLatencyMs,
    totalCheckpoints,
    scores: combinedScores,
    // Failure tracking
    failedCheckpoints: totalFailedCheckpoints,
    tooManyFailures,
  };
}

async function saveResults(result: ModelBenchmarkResult, dryRun: boolean): Promise<number | null> {
  if (dryRun) {
    console.log(`  [DRY RUN] Would save results for ${result.model.name}`);
    return null;
  }

  // Don't save results if too many checkpoints failed
  if (result.tooManyFailures) {
    console.log(`  ⏭️  Skipping save for ${result.model.name} due to too many failures`);
    return null;
  }

  try {
    // Calculate total deals evaluated
    const totalDeals = result.publicDealResults.length + result.privateDealScores.length;

    // Save combined benchmark run to database
    // Note: mode="public" means this appears on the main leaderboard
    const runId = await saveBenchmarkRun({
      agentId: `openrouter_${result.model.id}`,
      agentEndpoint: `openrouter://${result.model.openrouterId}`,
      agentName: result.model.name,
      mode: "public", // Leaderboard queries mode=public
      aggregateScore: result.aggregateScore,
      maxPossibleScore: result.maxPossibleScore,
      dealsEvaluated: totalDeals,
      checkpointsEvaluated: result.totalCheckpoints,
      avgLatencyMs: result.avgLatencyMs,
      runTimestamp: new Date().toISOString(),
      scores: {
        riskIdentification: Math.round(result.scores.riskIdentification * 10) / 10,
        nextStepQuality: Math.round(result.scores.nextStepQuality * 10) / 10,
        prioritization: Math.round(result.scores.prioritization * 10) / 10,
        outcomeAlignment: Math.round(result.scores.outcomeAlignment * 10) / 10,
      },
    });

    // Save judge evaluations for PUBLIC deals only (full feedback visible)
    for (const dealResult of result.publicDealResults) {
      for (const cpResult of dealResult.checkpointResults) {
        if (cpResult.evaluation.judgeEvaluations) {
          for (const judgeEval of cpResult.evaluation.judgeEvaluations) {
            await saveJudgeEvaluation({
              runId,
              checkpointId: cpResult.checkpointId,
              judgeModel: judgeEval.judgeModel,
              scores: judgeEval.scores,
              feedback: judgeEval.feedback,
              risksIdentified: judgeEval.risksIdentified,
              risksMissed: judgeEval.risksMissed,
              helpfulRecommendations: judgeEval.helpfulRecommendations,
              unhelpfulRecommendations: judgeEval.unhelpfulRecommendations,
            });
          }
        }
      }
    }

    // Note: Private deal scores are included in the aggregate but we don't
    // store detailed feedback to prevent gaming. Users can only see:
    // - Combined score (public + private)
    // - Detailed feedback for public deals only

    console.log(`  ✅ Saved to database (run ID: ${runId})`);
    return runId;
  } catch (error) {
    console.error(`  ❌ Failed to save results:`, error);
    return null;
  }
}

// Clear all benchmark data from the database
async function resetDatabase(): Promise<void> {
  console.log("Resetting database (clearing all benchmark data)...");
  try {
    // Delete in order respecting foreign key constraints
    await sql`DELETE FROM judge_evaluations`;
    await sql`DELETE FROM dimension_scores`;
    await sql`DELETE FROM benchmark_runs`;
    await sql`DELETE FROM agents`;
    console.log("Database cleared successfully.");
  } catch (error) {
    console.error("Failed to reset database:", error);
    throw error;
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("Sales Agent Benchmark - Full Dataset");
  console.log("====================================\n");

  // Parse command line arguments
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const singleJudge = args.includes("--single-judge");
  const multiJudge = !singleJudge;
  const resetDb = args.includes("--reset");
  const publicOnly = args.includes("--public-only");
  const resumeMode = args.includes("--resume");

  // Parse --parallel=N flag (default: 1 for serial, max: MAX_PARALLEL)
  const parallelArg = args.find((a) => a.startsWith("--parallel="));
  let parallelCount = 1;
  if (parallelArg) {
    const parsed = parseInt(parallelArg.split("=")[1] ?? "1", 10);
    parallelCount = Math.max(1, Math.min(parsed, MAX_PARALLEL));
  }

  // Filter models if specified
  let modelsToRun: ModelConfig[] = [...BENCHMARK_MODELS];
  const modelsArg = args.find((a) => a.startsWith("--models="));
  if (modelsArg) {
    const modelIds = modelsArg.split("=")[1]?.split(",") ?? [];
    modelsToRun = modelsToRun.filter((m) => modelIds.includes(m.id));
    console.log(`Running selected models: ${modelIds.join(", ")}`);
  }

  // Check for required environment variables
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("Error: OPENROUTER_API_KEY is required");
    console.error("Set it in .env.local or via environment variable");
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY && multiJudge) {
    console.error("Error: ANTHROPIC_API_KEY is required for multi-judge evaluation");
    console.error("Set it in .env.local or use --single-judge flag");
    process.exit(1);
  }

  if (!process.env.POSTGRES_URL && !dryRun) {
    console.error("Error: POSTGRES_URL is required to save results");
    console.error("Set it in .env.local or use --dry-run flag");
    process.exit(1);
  }

  // Initialize/reset database if not dry run
  if (!dryRun) {
    console.log("Initializing database...");
    await initDatabase();

    if (resetDb) {
      await resetDatabase();
    }
  }

  // Load deals
  console.log("Loading deals...");
  const { publicDeals, privateDeals } = await loadAllDeals();
  const publicCheckpoints = publicDeals.reduce((sum, d) => sum + d.checkpoints.length, 0);
  const privateCheckpoints = privateDeals.reduce((sum, d) => sum + d.checkpoints.length, 0);

  console.log(`Public deals: ${publicDeals.length} (${publicCheckpoints} checkpoints) - FULL FEEDBACK`);
  if (!publicOnly) {
    console.log(`Private deals: ${privateDeals.length} (${privateCheckpoints} checkpoints) - SCORES ONLY`);
    console.log(`Total: ${publicDeals.length + privateDeals.length} deals (${publicCheckpoints + privateCheckpoints} checkpoints)`);
  } else {
    console.log(`[--public-only mode] Skipping private deals`);
  }

  if (dryRun) {
    console.log("\n[DRY RUN MODE - Results will not be saved]\n");
  }

  if (resumeMode) {
    console.log("[RESUME MODE - Will skip already-completed models]\n");
  }

  if (multiJudge) {
    console.log("Using multi-judge evaluation (Claude, GPT, Gemini)");
  } else {
    console.log("Using single-judge evaluation (Claude Sonnet)");
  }

  if (parallelCount > 1) {
    console.log(`Running ${parallelCount} models in parallel\n`);
  } else {
    console.log("Running models serially\n");
  }

  // Get completed models if in resume mode
  const expectedCheckpoints = publicOnly
    ? publicCheckpoints
    : publicCheckpoints + privateCheckpoints;
  let completedModels = new Set<string>();
  if (resumeMode && !dryRun) {
    console.log("Checking for already-completed models...");
    completedModels = await getCompletedModels(expectedCheckpoints);
    if (completedModels.size > 0) {
      console.log(`Found ${completedModels.size} completed model(s) in last 24 hours`);
    }
  }

  // Run benchmarks
  const results: ModelBenchmarkResult[] = [];
  const skippedModels: string[] = [];
  const failedModels: string[] = [];
  const startTime = Date.now();

  // Mutex for thread-safe array operations
  const resultsMutex = { locked: false };
  const lockResults = async () => {
    while (resultsMutex.locked) await Bun.sleep(10);
    resultsMutex.locked = true;
  };
  const unlockResults = () => {
    resultsMutex.locked = false;
  };

  // Process a single model (used by both serial and parallel paths)
  const processModel = async (model: ModelConfig, index: number) => {
    const agentId = `openrouter_${model.id}`;

    // Skip already-completed models in resume mode
    if (resumeMode && completedModels.has(agentId)) {
      console.log(`\n[${index + 1}/${modelsToRun.length}] ⏭️  Skipping ${model.name} (already completed)`);
      await lockResults();
      skippedModels.push(model.name);
      unlockResults();
      return;
    }

    console.log(`\n[${index + 1}/${modelsToRun.length}] Benchmarking ${model.name}...`);

    try {
      const result = await benchmarkModel(
        model,
        publicDeals,
        publicOnly ? [] : privateDeals,
        { multiJudge, dryRun, publicOnly }
      );

      await lockResults();
      results.push(result);
      unlockResults();

      // Save results IMMEDIATELY after each model completes
      // This ensures leaderboard updates as models finish (no waiting for all)
      const saved = await saveResults(result, dryRun);

      // Track models that weren't saved due to failures
      if (!dryRun && saved === null && result.tooManyFailures) {
        await lockResults();
        failedModels.push(model.name);
        unlockResults();
      }

      console.log(`\n✅ Completed ${model.name}`);
    } catch (error) {
      console.error(`  Failed to benchmark ${model.name}:`, error);
      await lockResults();
      failedModels.push(model.name);
      unlockResults();
    }
  };

  // Run models either serially or in parallel
  if (parallelCount > 1) {
    console.log(`\nStarting parallel benchmark (${parallelCount} concurrent)...`);
    await runWithConcurrency(modelsToRun, parallelCount, processModel);
  } else {
    // Serial execution (original behavior)
    for (let i = 0; i < modelsToRun.length; i++) {
      const model = modelsToRun[i];
      if (!model) continue;
      await processModel(model, i);
    }
  }

  const totalTime = Math.round((Date.now() - startTime) / 1000);

  // Print summary
  console.log("\n====================================");
  console.log("Benchmark Complete!");
  console.log(`Total time: ${Math.floor(totalTime / 60)}m ${totalTime % 60}s`);
  console.log(`Models tested: ${results.length}/${modelsToRun.length}`);

  if (skippedModels.length > 0) {
    console.log(`Models skipped (already complete): ${skippedModels.length}`);
    skippedModels.forEach((name) => console.log(`  - ${name}`));
  }

  if (failedModels.length > 0) {
    console.log(`\n⚠️  Models with failures (not saved): ${failedModels.length}`);
    failedModels.forEach((name) => console.log(`  - ${name}`));
  }

  if (results.length > 0) {
    console.log("\nResults by combined score:");
    console.log("------------------------------------");

    // Sort by percentage
    results.sort((a, b) => b.percentage - a.percentage);

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (!r) continue;
      const rank = i + 1;
      const pubPct = r.publicMaxScore > 0 ? Math.round((r.publicScore / r.publicMaxScore) * 100) : 0;
      const privPct = r.privateMaxScore > 0 ? Math.round((r.privateScore / r.privateMaxScore) * 100) : 0;
      const failWarning = r.tooManyFailures ? " ❌" : "";
      console.log(
        `${rank}. ${r.model.name.padEnd(25)} ${r.percentage}% (${r.aggregateScore}/${r.maxPossibleScore})${failWarning}`
      );
      console.log(`   Public: ${pubPct}% | Private: ${privPct}% | Latency: ${r.avgLatencyMs}ms avg`);
      if (r.failedCheckpoints > 0) {
        console.log(`   ⚠️  ${r.failedCheckpoints} checkpoint(s) failed`);
      }
    }
  }

  if (!dryRun) {
    console.log("\nView results: https://sales-agent-benchmarks.fly.dev/benchmark");
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
