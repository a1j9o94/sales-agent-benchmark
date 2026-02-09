#!/usr/bin/env bun
/**
 * Artifact-Based Multi-Model Benchmark Script
 *
 * Runs the Artifact-Based Sales Agent Benchmark against multiple LLM models using OpenRouter.
 * Evaluates responses with task-specific multi-judge panel and saves results to DB.
 *
 * Usage:
 *   bun scripts/benchmark-models-artifact.ts                              # All models, all deals
 *   bun scripts/benchmark-models-artifact.ts --models=claude-4.5-sonnet,gpt-5.2
 *   bun scripts/benchmark-models-artifact.ts --deals=horizon-ventures     # Single deal
 *   bun scripts/benchmark-models-artifact.ts --dry-run                    # No DB save
 *   bun scripts/benchmark-models-artifact.ts --single-judge               # 1 judge (faster)
 *   bun scripts/benchmark-models-artifact.ts --resume                     # Skip completed
 *   bun scripts/benchmark-models-artifact.ts --parallel=3                 # 3 models at once
 */

import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type {
  ArtifactDeal,
  ArtifactCheckpoint,
  ArtifactAgentRequest,
  ArtifactAgentResponse,
  EvaluationTask,
  Artifact,
  ArtifactScoringDimensions,
  ArtifactTaskEvaluation,
  ScoringDimensionKey,
  TranscriptArtifact,
  EmailArtifact,
  CrmSnapshotArtifact,
  DocumentArtifact,
  SlackThreadArtifact,
  CalendarEventArtifact,
} from "../src/types/benchmark-artifact";
import { evaluateArtifactTask } from "../api/evaluate-response-artifact";
import {
  saveBenchmarkRun,
  saveArtifactTaskEvaluation,
  saveArtifactDimensionScores,
  initDatabase,
} from "../api/results";
import { sql } from "@vercel/postgres";
import { BENCHMARK_MODELS, type ModelConfig } from "./benchmark-models";

// ============================================================================
// Configuration
// ============================================================================

const openrouter = createOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  headers: {
    "HTTP-Referer": "https://sales-agent-benchmarks.fly.dev",
    "X-Title": "Sales Agent Benchmark Artifact-Based",
  },
});

const API_TIMEOUT_MS = 90000; // Artifact-based prompts are larger
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_PARALLEL = 3;

// Artifact-based system prompt
const ARTIFACT_SYSTEM_PROMPT = `You are an expert sales analyst evaluating deal situations. Your role is to:

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

You are analyzing real deal artifacts — transcripts, emails, CRM data, documents, etc.
Synthesize information across all provided artifacts to form your analysis.
Reference specific artifacts and evidence when identifying risks and recommending actions.

IMPORTANT: Return your analysis as JSON in this exact format:
{
  "reasoning": "2-3 sentences explaining your analytical process and key observations",
  "answer": "Your complete analysis — synthesizing insights across all artifacts",
  "risks": [
    {"description": "specific risk with evidence from artifacts", "severity": "high|medium|low"}
  ],
  "nextSteps": [
    {"action": "specific action to take", "priority": 1, "rationale": "why this matters based on evidence"}
  ],
  "confidence": 0.0-1.0,
  "artifactRequests": [],
  "isComplete": true
}`;

// ============================================================================
// Helper Functions
// ============================================================================

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

// ============================================================================
// Deal Loading
// ============================================================================

async function loadArtifactDealsFromDir(dirPath: string): Promise<ArtifactDeal[]> {
  const deals: ArtifactDeal[] = [];
  try {
    const dir = await Bun.$`ls ${dirPath}/*.json`.text();
    const files = dir.trim().split("\n").filter(Boolean);
    for (const filePath of files) {
      try {
        const file = Bun.file(filePath.trim());
        const content = await file.json();
        if (content.version === 2) {
          deals.push(content as ArtifactDeal);
        }
      } catch {
        // skip non-deal files like summary.json
      }
    }
  } catch {
    // directory doesn't exist
  }
  return deals;
}

// ============================================================================
// Artifact Formatting
// ============================================================================

function formatArtifactForPrompt(artifact: Artifact): string {
  switch (artifact.type) {
    case "transcript": {
      const t = artifact as TranscriptArtifact;
      const turns = t.turns.length > 30
        ? t.turns.slice(0, 15).map((turn) => `[${turn.speaker}] ${turn.text}`).join("\n") +
          `\n... (${t.turns.length - 30} turns omitted) ...\n` +
          t.turns.slice(-15).map((turn) => `[${turn.speaker}] ${turn.text}`).join("\n")
        : t.turns.map((turn) => `[${turn.speaker}] ${turn.text}`).join("\n");
      return `### Transcript: ${t.title} (${t.date})\nAttendees: ${t.attendees.join(", ")}\n${turns}`;
    }
    case "email": {
      const e = artifact as EmailArtifact;
      const msgs = e.messages.map(
        (m) => `From: ${m.from} | To: ${m.to.join(", ")} | ${m.date}\n${m.body.slice(0, 500)}`
      ).join("\n---\n");
      return `### Email Thread: ${e.subject}\n${msgs}`;
    }
    case "crm_snapshot": {
      const c = artifact as CrmSnapshotArtifact;
      const props = c.dealProperties;
      const contacts = c.contacts.map((ct) => `  - ${ct.name} (${ct.title ?? ct.role ?? "unknown"})`).join("\n");
      const activity = c.activityLog.slice(-10).map((a) => `  - [${a.date}] ${a.type}: ${a.description}`).join("\n");
      return `### CRM Snapshot\nStage: ${props.stage} | Amount: ${props.amount ?? "N/A"}\nContacts:\n${contacts}\nActivity Log:\n${activity}`;
    }
    case "document": {
      const d = artifact as DocumentArtifact;
      const content = d.content.length > 2000 ? d.content.slice(0, 2000) + "\n... (truncated)" : d.content;
      return `### Document: ${d.title} (${d.documentType})\n${content}`;
    }
    case "slack_thread": {
      const s = artifact as SlackThreadArtifact;
      const msgs = s.messages.map((m) => `[${m.author}] ${m.text}`).join("\n");
      return `### Slack: #${s.channel}\n${msgs}`;
    }
    case "calendar_event": {
      const cal = artifact as CalendarEventArtifact;
      return `### Calendar: ${cal.title} (${cal.date}, ${cal.duration}min)\nAttendees: ${cal.attendees.join(", ")}\n${cal.description ?? ""}`;
    }
    default:
      return `### Artifact\n[Unknown type]`;
  }
}

function buildArtifactPrompt(
  deal: ArtifactDeal,
  checkpoint: ArtifactCheckpoint,
  task: EvaluationTask,
  artifacts: Artifact[]
): string {
  const parts: string[] = [
    `## Deal: ${deal.name}`,
    `**Industry:** ${deal.industry}`,
    "",
  ];

  // Add checkpoint context
  if (checkpoint.dealSnapshot) {
    parts.push(`**Stage:** ${checkpoint.dealSnapshot.stage}`);
    if (checkpoint.dealSnapshot.amount) parts.push(`**Deal Size:** ${checkpoint.dealSnapshot.amount}`);
    parts.push(`**Days Since First Contact:** ${checkpoint.dealSnapshot.daysSinceFirstContact}`);
    parts.push("");
  }

  // Add stakeholders
  if (checkpoint.stakeholders && checkpoint.stakeholders.length > 0) {
    parts.push("### Stakeholders:");
    for (const s of checkpoint.stakeholders) {
      parts.push(`- **${s.name}** (${s.role}${s.title ? `, ${s.title}` : ""}) — ${s.sentiment} sentiment${s.notes ? `: ${s.notes}` : ""}`);
    }
    parts.push("");
  }

  // Add MEDDPICC
  if (checkpoint.meddpicc) {
    const m = checkpoint.meddpicc;
    parts.push("### MEDDPICC Status:");
    if (m.metrics) parts.push(`- **Metrics:** ${m.metrics.status} — ${m.metrics.notes}`);
    if (m.economicBuyer) parts.push(`- **Economic Buyer:** ${m.economicBuyer.status} — ${m.economicBuyer.notes}`);
    if (m.decisionCriteria) parts.push(`- **Decision Criteria:** ${m.decisionCriteria.status} — ${m.decisionCriteria.notes}`);
    if (m.decisionProcess) parts.push(`- **Decision Process:** ${m.decisionProcess.status} — ${m.decisionProcess.notes}`);
    if (m.paperProcess) parts.push(`- **Paper Process:** ${m.paperProcess.status} — ${m.paperProcess.notes}`);
    if (m.pain) parts.push(`- **Pain:** ${m.pain.status} — ${m.pain.notes}`);
    if (m.champion) parts.push(`- **Champion:** ${m.champion.status} — ${m.champion.notes}`);
    if (m.competition) parts.push(`- **Competition:** ${m.competition.status} — ${m.competition.notes}`);
    parts.push("");
  }

  // Add artifacts
  parts.push("### Artifacts:");
  for (const artifact of artifacts) {
    parts.push(formatArtifactForPrompt(artifact));
    parts.push("");
  }

  parts.push("---");
  parts.push(`**Task:** ${task.prompt}`);
  parts.push("");
  parts.push("Analyze this deal situation using all provided artifacts and respond as JSON.");

  return parts.filter((p) => p !== undefined).join("\n");
}

// ============================================================================
// Model Runner
// ============================================================================

async function callModelForTask(
  model: ModelConfig,
  deal: ArtifactDeal,
  checkpoint: ArtifactCheckpoint,
  task: EvaluationTask
): Promise<{ response: ArtifactAgentResponse; latencyMs: number }> {
  // Resolve artifacts for this task
  const artifacts = task.requiredArtifacts
    .map((id) => deal.artifacts[id])
    .filter((a): a is Artifact => a !== undefined);

  const prompt = buildArtifactPrompt(deal, checkpoint, task, artifacts);
  const startTime = Date.now();

  const result = await withTimeout(
    withRetry(
      async () => {
        const genResult = await generateText({
          model: openrouter(model.openrouterId),
          system: ARTIFACT_SYSTEM_PROMPT,
          prompt,
        });
        return genResult;
      },
      `${model.id} → ${task.type}`,
    ),
    API_TIMEOUT_MS,
    `${model.id} → ${task.type}`
  );

  const latencyMs = Date.now() - startTime;

  const jsonMatch = result.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON found in model response");
  }

  const parsed = JSON.parse(jsonMatch[0]);

  const response: ArtifactAgentResponse = {
    version: 2,
    reasoning: String(parsed.reasoning || "No reasoning provided"),
    answer: typeof parsed.answer === "object" && parsed.answer !== null
      ? JSON.stringify(parsed.answer, null, 2)
      : String(parsed.answer || parsed.reasoning || "No answer provided"),
    artifactRequests: [],
    isComplete: true,
    risks: (parsed.risks || []).map((r: Record<string, unknown>) => ({
      description: String(r.description || "Unknown risk"),
      severity: ["high", "medium", "low"].includes(r.severity as string)
        ? (r.severity as "high" | "medium" | "low")
        : "medium",
    })),
    nextSteps: (parsed.nextSteps || parsed.next_steps || []).map(
      (s: Record<string, unknown>, idx: number) => ({
        action: String(s.action || ""),
        priority: typeof s.priority === "number" ? s.priority : idx + 1,
        rationale: s.rationale as string | undefined,
      })
    ),
    confidence: typeof parsed.confidence === "number"
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0.5,
  };

  return { response, latencyMs };
}

// ============================================================================
// Resume Support
// ============================================================================

async function getCompletedTaskIds(agentId: string): Promise<Set<string>> {
  const result = await sql`
    SELECT DISTINCT te.task_id
    FROM task_evaluations te
    JOIN benchmark_runs br ON te.run_id = br.id
    WHERE br.agent_id = ${agentId}
  `;
  return new Set(result.rows.map((r) => r.task_id));
}

// ============================================================================
// Main Runner
// ============================================================================

async function runBenchmarkForModel(
  model: ModelConfig,
  deals: ArtifactDeal[],
  opts: {
    dryRun: boolean;
    singleJudge: boolean;
    resume: boolean;
  }
): Promise<{
  model: ModelConfig;
  tasksCompleted: number;
  tasksFailed: number;
  tasksSkipped: number;
  totalLatencyMs: number;
  scores: Record<string, number[]>;
  overallPercentage: number;
}> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🤖 ${model.name} (${model.id})`);
  console.log(`${"=".repeat(60)}`);

  const scores: Record<string, number[]> = {};
  let tasksCompleted = 0;
  let tasksFailed = 0;
  let tasksSkipped = 0;
  let totalLatencyMs = 0;

  const summaryDimAccum = { riskIdentification: 0, nextStepQuality: 0, prioritization: 0, outcomeAlignment: 0 };
  const artifactDimAccum: Record<string, { sum: number; count: number }> = {};

  const storedEvals: Array<{
    checkpointId: string;
    evaluation: ArtifactTaskEvaluation;
  }> = [];

  // Load completed tasks for resume mode
  let completedTaskIds = new Set<string>();
  if (opts.resume) {
    completedTaskIds = await getCompletedTaskIds(`artifact_${model.id}`);
    if (completedTaskIds.size > 0) {
      console.log(`  ⏩ Resume: found ${completedTaskIds.size} completed tasks, skipping them`);
    }
  }

  for (const deal of deals) {
    console.log(`\n  📁 Deal: ${deal.name} (${Object.keys(deal.artifacts).length} artifacts, ${deal.checkpoints.length} checkpoints)`);

    for (const checkpoint of deal.checkpoints) {
      for (const task of checkpoint.tasks) {
        const taskLabel = `${task.type} [${task.id}]`;

        // Skip already-completed tasks in resume mode
        if (opts.resume && completedTaskIds.has(task.id)) {
          console.log(`    ⏩ ${taskLabel} (already completed)`);
          tasksSkipped++;
          continue;
        }

        process.stdout.write(`    🔄 ${taskLabel}... `);

        try {
          // Generate response
          const { response, latencyMs } = await callModelForTask(model, deal, checkpoint, task);
          totalLatencyMs += latencyMs;

          // Evaluate
          const resolvedArtifacts = task.requiredArtifacts
            .map((id) => deal.artifacts[id])
            .filter((a): a is Artifact => a !== undefined);

          const evaluation = await evaluateArtifactTask(
            task,
            response,
            checkpoint.groundTruth,
            resolvedArtifacts,
            1, // single turn
            [] // no artifact requests
          );

          // Accumulate scores
          for (const [dim, score] of Object.entries(evaluation.scores)) {
            if (typeof score === "number") {
              if (!scores[dim]) scores[dim] = [];
              scores[dim]!.push(score);

              // Summary dimensions
              if (dim in summaryDimAccum) {
                (summaryDimAccum as Record<string, number>)[dim]! += score;
              }
              // Artifact dimensions
              if (!artifactDimAccum[dim]) artifactDimAccum[dim] = { sum: 0, count: 0 };
              artifactDimAccum[dim]!.sum += score;
              artifactDimAccum[dim]!.count++;
            }
          }

          storedEvals.push({ checkpointId: checkpoint.id, evaluation });
          tasksCompleted++;

          // Show inline score
          const avgScore = Object.values(evaluation.scores)
            .filter((v): v is number => typeof v === "number");
          const avg = avgScore.length > 0
            ? (avgScore.reduce((a, b) => a + b, 0) / avgScore.length).toFixed(1)
            : "?";
          console.log(`✅ avg: ${avg}/10 (${latencyMs}ms)`);

        } catch (error) {
          tasksFailed++;
          const msg = error instanceof Error ? error.message : String(error);
          console.log(`❌ ${msg.slice(0, 80)}`);
        }
      }
    }
  }

  // Calculate overall percentage
  const allScoreValues = Object.values(scores).flat();
  const overallPercentage = allScoreValues.length > 0
    ? (allScoreValues.reduce((a, b) => a + b, 0) / (allScoreValues.length * 10)) * 100
    : 0;

  // Save to database
  if (!opts.dryRun && tasksCompleted > 0) {
    try {
      // Aggregate summary scores
      const summaryAvgs = {
        riskIdentification: tasksCompleted > 0 ? summaryDimAccum.riskIdentification / tasksCompleted : 0,
        nextStepQuality: tasksCompleted > 0 ? summaryDimAccum.nextStepQuality / tasksCompleted : 0,
        prioritization: tasksCompleted > 0 ? summaryDimAccum.prioritization / tasksCompleted : 0,
        outcomeAlignment: tasksCompleted > 0 ? summaryDimAccum.outcomeAlignment / tasksCompleted : 0,
      };

      const aggregateScore = storedEvals.reduce((sum, e) => {
        const s = e.evaluation.scores;
        return sum + (s.riskIdentification ?? 0) + (s.nextStepQuality ?? 0)
          + (s.prioritization ?? 0) + (s.outcomeAlignment ?? 0);
      }, 0);

      const runId = await saveBenchmarkRun({
        agentId: `artifact_${model.id}`,
        agentEndpoint: `openrouter:${model.openrouterId}`,
        agentName: model.name,
        mode: "public",
        aggregateScore: Math.round(aggregateScore),
        maxPossibleScore: tasksCompleted * 40,
        dealsEvaluated: deals.length,
        checkpointsEvaluated: deals.reduce((s, d) => s + d.checkpoints.length, 0),
        avgLatencyMs: Math.round(totalLatencyMs / tasksCompleted),
        runTimestamp: new Date().toISOString(),
        scores: {
          riskIdentification: Math.round(summaryAvgs.riskIdentification * 10) / 10,
          nextStepQuality: Math.round(summaryAvgs.nextStepQuality * 10) / 10,
          prioritization: Math.round(summaryAvgs.prioritization * 10) / 10,
          outcomeAlignment: Math.round(summaryAvgs.outcomeAlignment * 10) / 10,
        },
      });

      if (runId) {
        // Save artifact dimension scores
        const artifactAvgs: Record<string, number | undefined> = {};
        for (const [dim, acc] of Object.entries(artifactDimAccum)) {
          if (acc.count > 0 && !["riskIdentification", "nextStepQuality", "prioritization", "outcomeAlignment"].includes(dim)) {
            artifactAvgs[dim] = Math.round((acc.sum / acc.count) * 10) / 10;
          }
        }
        await saveArtifactDimensionScores(runId, artifactAvgs as Record<string, number | undefined>);

        // Save individual task evaluations
        for (const stored of storedEvals) {
          await saveArtifactTaskEvaluation({
            runId,
            checkpointId: stored.checkpointId,
            taskId: stored.evaluation.taskId,
            taskType: stored.evaluation.taskType,
            turnsUsed: stored.evaluation.turnsUsed,
            scores: stored.evaluation.scores as unknown as Record<string, number>,
            feedback: stored.evaluation.feedback,
            artifactsRequested: stored.evaluation.artifactsRequested,
            judgeModel: stored.evaluation.judgeModel,
          });
        }

        console.log(`  💾 Saved run #${runId} to database`);
      }
    } catch (dbError) {
      console.error(`  ⚠️  DB save failed:`, dbError);
    }
  }

  return { model, tasksCompleted, tasksFailed, tasksSkipped, totalLatencyMs, scores, overallPercentage };
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  const dryRun = args.includes("--dry-run");
  const singleJudge = args.includes("--single-judge");
  const resume = args.includes("--resume");

  // Parse --models
  let modelsToRun: ModelConfig[] = [...BENCHMARK_MODELS];
  const modelsArg = args.find((a) => a.startsWith("--models="));
  if (modelsArg) {
    const modelIds = modelsArg.split("=")[1]?.split(",") ?? [];
    modelsToRun = BENCHMARK_MODELS.filter((m) => modelIds.includes(m.id));
    if (modelsToRun.length === 0) {
      console.error(`No matching models found. Available: ${BENCHMARK_MODELS.map((m) => m.id).join(", ")}`);
      process.exit(1);
    }
  }

  // Parse --deals
  const dealsArg = args.find((a) => a.startsWith("--deals="));
  const dealFilter = dealsArg ? dealsArg.split("=")[1]?.split(",") : null;

  // Parse --parallel
  const parallelArg = args.find((a) => a.startsWith("--parallel="));
  const parallelCount = parallelArg ? parseInt(parallelArg.split("=")[1] || "1") : 1;

  // Load artifact-based deals
  console.log("📂 Loading artifact-based deals...");
  const [publicDeals, privateDeals] = await Promise.all([
    loadArtifactDealsFromDir("data/artifact/checkpoints/public"),
    loadArtifactDealsFromDir("data/artifact/checkpoints/private"),
  ]);

  let allDeals = [...publicDeals, ...privateDeals];

  if (dealFilter) {
    allDeals = allDeals.filter((d) => dealFilter.some((f) => d.id.includes(f) || d.name.toLowerCase().includes(f.toLowerCase())));
  }

  const totalTasks = allDeals.reduce(
    (sum, d) => sum + d.checkpoints.reduce((s, cp) => s + cp.tasks.length, 0), 0
  );

  console.log(`\n=== Artifact-Based Benchmark Runner ===`);
  console.log(`Deals: ${allDeals.length} (${allDeals.map((d) => d.name).join(", ")})`);
  console.log(`Total checkpoints: ${allDeals.reduce((s, d) => s + d.checkpoints.length, 0)}`);
  console.log(`Total tasks: ${totalTasks}`);
  console.log(`Models: ${modelsToRun.map((m) => m.id).join(", ")}`);
  console.log(`Dry run: ${dryRun}`);
  console.log(`Parallel: ${parallelCount}`);

  if (totalTasks === 0) {
    console.error("No artifact-based tasks found. Run the pipeline first.");
    process.exit(1);
  }

  // Init database
  if (!dryRun) {
    await initDatabase();
  }

  // Run benchmark for each model
  const results: Awaited<ReturnType<typeof runBenchmarkForModel>>[] = [];

  if (parallelCount > 1) {
    const executing: Promise<void>[] = [];
    for (const model of modelsToRun) {
      const p = runBenchmarkForModel(model, allDeals, { dryRun, singleJudge, resume }).then((r) => {
        results.push(r);
        executing.splice(executing.indexOf(p), 1);
      });
      executing.push(p);
      if (executing.length >= parallelCount) {
        await Promise.race(executing);
      }
    }
    await Promise.all(executing);
  } else {
    for (const model of modelsToRun) {
      const result = await runBenchmarkForModel(model, allDeals, { dryRun, singleJudge, resume });
      results.push(result);
    }
  }

  // Print summary
  console.log(`\n\n${"=".repeat(60)}`);
  console.log("📊 ARTIFACT-BASED BENCHMARK RESULTS SUMMARY");
  console.log(`${"=".repeat(60)}\n`);

  // Sort by overall percentage
  results.sort((a, b) => b.overallPercentage - a.overallPercentage);

  for (const r of results) {
    const status = r.tasksFailed > 0 ? `(${r.tasksFailed} failed)` : "";
    const avgLatency = r.tasksCompleted > 0 ? Math.round(r.totalLatencyMs / r.tasksCompleted) : 0;

    console.log(`  ${r.overallPercentage.toFixed(1)}%  ${r.model.name} ${status}`);

    // Print per-dimension averages
    const dimAvgs: string[] = [];
    for (const [dim, values] of Object.entries(r.scores)) {
      if (values.length > 0) {
        const avg = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1);
        dimAvgs.push(`${dim}: ${avg}`);
      }
    }
    if (dimAvgs.length > 0) {
      console.log(`         ${dimAvgs.join(" | ")}`);
    }
    const skippedStr = r.tasksSkipped > 0 ? ` | Skipped: ${r.tasksSkipped}` : "";
    console.log(`         Tasks: ${r.tasksCompleted}/${r.tasksCompleted + r.tasksFailed}${skippedStr} | Avg latency: ${avgLatency}ms`);
    console.log("");
  }

  console.log("Done.");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
