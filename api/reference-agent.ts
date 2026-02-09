/**
 * Reference Agent Endpoint (OpenRouter)
 *
 * Wraps any benchmarked model via OpenRouter to implement the benchmark API contract.
 * Users can test any model in BENCHMARK_MODELS by hitting:
 *   POST /api/reference-agent/:modelId
 *
 * This uses the same system prompt and response parsing as api/agent.ts,
 * but routes through OpenRouter so any model can be used.
 */

import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { BENCHMARK_MODELS, type ModelConfig } from "../scripts/benchmark-models";
import type { AgentRequest, AgentResponse } from "../src/types/benchmark";
import type {
  ArtifactAgentRequest,
  ArtifactAgentResponse,
  Artifact,
  TranscriptArtifact,
  EmailArtifact,
  CrmSnapshotArtifact,
  DocumentArtifact,
  SlackThreadArtifact,
  CalendarEventArtifact,
} from "../src/types/benchmark-artifact";

export interface ReferenceAgentDeps {
  generateText: typeof generateText;
  openrouter: ReturnType<typeof createOpenAI>;
  benchmarkModels: readonly ModelConfig[];
}

// Lazy OpenRouter client creation (avoid side effects at import time)
let _openrouter: ReturnType<typeof createOpenAI> | null = null;
function getOpenRouter() {
  if (!_openrouter) {
    _openrouter = createOpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
      headers: {
        "HTTP-Referer": "https://sales-agent-benchmarks.fly.dev",
        "X-Title": "Sales Agent Benchmark",
      },
    });
  }
  return _openrouter;
}

function getDefaultReferenceAgentDeps(): ReferenceAgentDeps {
  return { generateText, openrouter: getOpenRouter(), benchmarkModels: BENCHMARK_MODELS };
}

// Same system prompt as api/agent.ts and scripts/benchmark-models.ts
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

/**
 * Build the deal context prompt from an AgentRequest (same logic as api/agent.ts)
 */
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

  if (request.dealContext.meddpicc) {
    const m = request.dealContext.meddpicc;
    contextParts.push("", "### MEDDPICC Status:");
    if (m.metrics) contextParts.push(`- **Metrics:** ${m.metrics.status} - ${m.metrics.notes}`);
    if (m.economicBuyer)
      contextParts.push(`- **Economic Buyer:** ${m.economicBuyer.status} - ${m.economicBuyer.notes}`);
    if (m.decisionCriteria)
      contextParts.push(`- **Decision Criteria:** ${m.decisionCriteria.status} - ${m.decisionCriteria.notes}`);
    if (m.decisionProcess)
      contextParts.push(`- **Decision Process:** ${m.decisionProcess.status} - ${m.decisionProcess.notes}`);
    if (m.paperProcess)
      contextParts.push(`- **Paper Process:** ${m.paperProcess.status} - ${m.paperProcess.notes}`);
    if (m.pain) contextParts.push(`- **Pain:** ${m.pain.status} - ${m.pain.notes}`);
    if (m.champion) contextParts.push(`- **Champion:** ${m.champion.status} - ${m.champion.notes}`);
    if (m.competition)
      contextParts.push(`- **Competition:** ${m.competition.status} - ${m.competition.notes}`);
  }

  if (request.dealContext.history) {
    contextParts.push("", "### Deal History:", request.dealContext.history);
  }

  const contextString = contextParts.filter(Boolean).join("\n");

  return `${contextString}

---

**Question:** ${request.question}

Analyze this deal situation and provide your assessment as JSON.`;
}

// ---------------------------------------------------------------------------
// Artifact-Based Reference Agent
// ---------------------------------------------------------------------------

const ARTIFACT_SALES_AGENT_SYSTEM_PROMPT = `${SALES_AGENT_SYSTEM_PROMPT}

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

function formatArtifactForPrompt(artifact: Artifact): string {
  switch (artifact.type) {
    case "transcript": {
      const t = artifact as TranscriptArtifact;
      const turns = t.turns.map((turn) => `[${turn.speaker}] ${turn.text}`).join("\n");
      return `### Transcript: ${t.title} (${t.date})\nAttendees: ${t.attendees.join(", ")}\n${turns}`;
    }
    case "email": {
      const e = artifact as EmailArtifact;
      const msgs = e.messages.map(
        (m) => `From: ${m.from} | To: ${m.to.join(", ")} | ${m.date}\n${m.body}`
      ).join("\n---\n");
      return `### Email Thread: ${e.subject}\n${msgs}`;
    }
    case "crm_snapshot": {
      const c = artifact as CrmSnapshotArtifact;
      const props = c.dealProperties;
      const contacts = c.contacts.map((ct) => `  - ${ct.name} (${ct.title ?? ct.role ?? "unknown"})`).join("\n");
      const activity = c.activityLog.map((a) => `  - [${a.date}] ${a.type}: ${a.description}`).join("\n");
      return `### CRM Snapshot\nStage: ${props.stage} | Amount: ${props.amount ?? "N/A"}\nContacts:\n${contacts}\nActivity Log:\n${activity}`;
    }
    case "document": {
      const d = artifact as DocumentArtifact;
      return `### Document: ${d.title} (${d.documentType})\n${d.content}`;
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

function buildArtifactPrompt(request: ArtifactAgentRequest): string {
  const parts: string[] = [
    `## Deal: ${request.dealSnapshot.company}`,
    `**Stage:** ${request.dealSnapshot.stage}`,
    request.dealSnapshot.amount ? `**Deal Size:** ${request.dealSnapshot.amount}` : "",
    `**Days Since First Contact:** ${request.dealSnapshot.daysSinceFirstContact}`,
    "",
  ];

  if (request.stakeholders.length > 0) {
    parts.push("### Stakeholders:");
    for (const s of request.stakeholders) {
      parts.push(`- **${s.name}** (${s.role}${s.title ? `, ${s.title}` : ""}) — ${s.sentiment} sentiment${s.notes ? `: ${s.notes}` : ""}`);
    }
    parts.push("");
  }

  if (request.meddpicc) {
    const m = request.meddpicc;
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

  parts.push("### Artifacts:");
  for (const artifact of request.artifacts) {
    parts.push(formatArtifactForPrompt(artifact));
    parts.push("");
  }

  parts.push("---");
  parts.push(`**Task (Turn ${request.turnNumber}/${request.maxTurns}):** ${request.prompt}`);
  parts.push("");
  parts.push("Analyze this deal situation using all provided artifacts and respond as JSON.");

  return parts.filter((p) => p !== undefined).join("\n");
}

async function handleArtifactReferenceAgent(
  body: ArtifactAgentRequest,
  model: ModelConfig,
  deps: ReferenceAgentDeps
): Promise<Response> {
  const prompt = buildArtifactPrompt(body);

  try {
    const result = await deps.generateText({
      model: deps.openrouter(model.openrouterId),
      system: ARTIFACT_SALES_AGENT_SYSTEM_PROMPT,
      prompt,
    });

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
          action: String(s.action || "No action specified"),
          priority: typeof s.priority === "number" ? s.priority : idx + 1,
          rationale: s.rationale as string | undefined,
        })
      ),
      confidence:
        typeof parsed.confidence === "number"
          ? Math.min(1, Math.max(0, parsed.confidence))
          : 0.5,
    };

    return Response.json({
      model: model.id,
      model_name: model.name,
      ...response,
    });
  } catch (error) {
    console.error(`Artifact-based reference agent error (${model.name}):`, error);

    return Response.json(
      {
        model: model.id,
        model_name: model.name,
        version: 2,
        reasoning: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        answer: "Unable to analyze deal - error in processing",
        artifactRequests: [],
        isComplete: true,
        risks: [{ description: "Unable to analyze deal - error in processing", severity: "high" }],
        nextSteps: [{ action: "Review deal context and try again", priority: 1 }],
        confidence: 0,
      },
      { status: 500 }
    );
  }
}

interface ReferenceAgentBody {
  version?: number;
  checkpoint_id?: string;
  checkpointId?: string;
  deal_context?: Record<string, unknown>;
  dealContext?: Record<string, unknown>;
  question?: string;
  // Artifact-based fields
  taskId?: string;
  taskType?: string;
  prompt?: string;
  artifacts?: Artifact[];
  dealSnapshot?: ArtifactAgentRequest["dealSnapshot"];
  stakeholders?: ArtifactAgentRequest["stakeholders"];
  meddpicc?: ArtifactAgentRequest["meddpicc"];
  turnNumber?: number;
  maxTurns?: number;
}

/**
 * HTTP handler for the reference agent endpoint.
 * Route: POST /api/reference-agent/:modelId
 */
export async function handleReferenceAgent(req: Request, deps: ReferenceAgentDeps = getDefaultReferenceAgentDeps()): Promise<Response> {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // Extract modelId from URL path
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/");
  const modelId = pathParts[pathParts.length - 1];

  if (!modelId) {
    return Response.json({ error: "modelId is required in URL path" }, { status: 400 });
  }

  // Find the model in benchmarkModels
  const model = deps.benchmarkModels.find((m) => m.id === modelId);
  if (!model) {
    const available = deps.benchmarkModels.map((m) => m.id).join(", ");
    return Response.json(
      { error: `Model "${modelId}" not found. Available models: ${available}` },
      { status: 404 }
    );
  }

  // Check for OpenRouter API key
  if (!process.env.OPENROUTER_API_KEY) {
    return Response.json(
      { error: "OPENROUTER_API_KEY not configured on server" },
      { status: 500 }
    );
  }

  try {
    const body = (await req.json()) as ReferenceAgentBody;

    // Route artifact-based requests to the artifact handler
    if (body.version === 2) {
      return handleArtifactReferenceAgent(body as unknown as ArtifactAgentRequest, model, deps);
    }

    // Validate request
    if (!body.checkpoint_id && !body.checkpointId) {
      return Response.json({ error: "checkpoint_id is required" }, { status: 400 });
    }
    if (!body.deal_context && !body.dealContext) {
      return Response.json({ error: "deal_context is required" }, { status: 400 });
    }

    // Normalize the request format (support both snake_case and camelCase)
    const rawContext = (body.deal_context || body.dealContext) as Record<string, unknown>;

    const dealContext = {
      company: rawContext.company,
      stage: rawContext.stage,
      amount: rawContext.amount,
      closeDate: rawContext.close_date || rawContext.closeDate,
      lastInteraction: rawContext.last_interaction || rawContext.lastInteraction,
      painPoints: rawContext.pain_points || rawContext.painPoints || [],
      stakeholders: rawContext.stakeholders || [],
      timeline: rawContext.timeline,
      hypothesis: rawContext.hypothesis,
      meddpicc: rawContext.meddpicc,
      competitiveLandscape: rawContext.competitive_landscape || rawContext.competitiveLandscape,
      techStack: rawContext.tech_stack || rawContext.techStack,
      useCases: rawContext.use_cases || rawContext.useCases,
      history: rawContext.history,
    };

    const agentRequest: AgentRequest = {
      checkpointId: (body.checkpoint_id || body.checkpointId) as string,
      dealContext: dealContext as AgentRequest["dealContext"],
      question: body.question || "What are the top risks and recommended next steps?",
    };

    // Build prompt and call OpenRouter
    const prompt = buildDealContextPrompt(agentRequest);

    const result = await deps.generateText({
      model: deps.openrouter(model.openrouterId),
      system: SALES_AGENT_SYSTEM_PROMPT,
      prompt,
    });

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
        typeof parsed.confidence === "number"
          ? Math.min(1, Math.max(0, parsed.confidence))
          : 0.5,
      reasoning: String(parsed.reasoning || "No reasoning provided"),
    };

    // Return response in snake_case for API compatibility
    return Response.json({
      model: model.id,
      model_name: model.name,
      risks: response.risks,
      next_steps: response.nextSteps.map((s) => ({
        action: s.action,
        priority: s.priority,
        rationale: s.rationale,
      })),
      confidence: response.confidence,
      reasoning: response.reasoning,
    });
  } catch (error) {
    console.error(`Reference agent error (${model.name}):`, error);

    return Response.json(
      {
        model: model.id,
        model_name: model.name,
        risks: [{ description: "Unable to analyze deal - error in processing", severity: "high" }],
        next_steps: [{ action: "Review deal context and try again", priority: 1 }],
        confidence: 0,
        reasoning: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
      { status: 500 }
    );
  }
}
