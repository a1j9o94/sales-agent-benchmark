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

interface ReferenceAgentBody {
  checkpoint_id?: string;
  checkpointId?: string;
  deal_context?: Record<string, unknown>;
  dealContext?: Record<string, unknown>;
  question?: string;
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
