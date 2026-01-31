/**
 * Reference Sales Agent API
 *
 * This is the reference implementation of a sales agent that implements
 * the benchmark API contract. Users can use this as a template for their
 * own agents, or test against it as a baseline.
 */

import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import type { AgentRequest, AgentResponse, Risk, NextStep } from "../src/types/benchmark";

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

export async function handleAgentRequest(request: AgentRequest): Promise<AgentResponse> {
  // Build context string from the deal context
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
      (s) => `- **${s.name}** (${s.role}${s.title ? `, ${s.title}` : ""}) - ${s.sentiment || "unknown"} sentiment${s.notes ? `: ${s.notes}` : ""}`
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
    if (m.economicBuyer) contextParts.push(`- **Economic Buyer:** ${m.economicBuyer.status} - ${m.economicBuyer.notes}`);
    if (m.decisionCriteria) contextParts.push(`- **Decision Criteria:** ${m.decisionCriteria.status} - ${m.decisionCriteria.notes}`);
    if (m.decisionProcess) contextParts.push(`- **Decision Process:** ${m.decisionProcess.status} - ${m.decisionProcess.notes}`);
    if (m.paperProcess) contextParts.push(`- **Paper Process:** ${m.paperProcess.status} - ${m.paperProcess.notes}`);
    if (m.pain) contextParts.push(`- **Pain:** ${m.pain.status} - ${m.pain.notes}`);
    if (m.champion) contextParts.push(`- **Champion:** ${m.champion.status} - ${m.champion.notes}`);
    if (m.competition) contextParts.push(`- **Competition:** ${m.competition.status} - ${m.competition.notes}`);
  }

  // Add history
  if (request.dealContext.history) {
    contextParts.push("", "### Deal History:", request.dealContext.history);
  }

  const contextString = contextParts.filter(Boolean).join("\n");

  const prompt = `${contextString}

---

**Question:** ${request.question}

Analyze this deal situation and provide your assessment as JSON.`;

  try {
    const result = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      system: SALES_AGENT_SYSTEM_PROMPT,
      prompt,
    });

    // Parse the JSON response
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in agent response");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate and normalize the response
    const response: AgentResponse = {
      risks: (parsed.risks || []).map((r: any, idx: number) => ({
        description: String(r.description || "Unknown risk"),
        severity: ["high", "medium", "low"].includes(r.severity) ? r.severity : "medium",
      })),
      nextSteps: (parsed.nextSteps || parsed.next_steps || []).map((s: any, idx: number) => ({
        action: String(s.action || "No action specified"),
        priority: typeof s.priority === "number" ? s.priority : idx + 1,
        rationale: s.rationale,
      })),
      confidence: typeof parsed.confidence === "number" ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
      reasoning: String(parsed.reasoning || "No reasoning provided"),
    };

    return response;
  } catch (error) {
    console.error("Agent error:", error);

    // Return a fallback response on error
    return {
      risks: [{ description: "Unable to analyze deal - error in processing", severity: "high" }],
      nextSteps: [{ action: "Review deal context and try again", priority: 1 }],
      confidence: 0,
      reasoning: `Error processing request: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

interface AgentEndpointBody {
  checkpoint_id?: string;
  checkpointId?: string;
  deal_context?: Record<string, unknown>;
  dealContext?: Record<string, unknown>;
  question?: string;
}

// HTTP handler for Vercel Edge + Bun server
export async function handleAgentEndpoint(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body: AgentEndpointBody = await req.json();

    // Validate request
    if (!body.checkpoint_id && !body.checkpointId) {
      return Response.json({ error: "checkpoint_id is required" }, { status: 400 });
    }
    if (!body.deal_context && !body.dealContext) {
      return Response.json({ error: "deal_context is required" }, { status: 400 });
    }

    // Normalize the request format (support both snake_case and camelCase)
    const rawContext = (body.deal_context || body.dealContext) as Record<string, unknown>;

    // Normalize deal context fields from snake_case to camelCase
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

    const request: AgentRequest = {
      checkpointId: body.checkpoint_id || body.checkpointId,
      dealContext,
      question: body.question || "What are the top risks and recommended next steps?",
    };

    const response = await handleAgentRequest(request);

    // Return response in snake_case for API compatibility
    return Response.json({
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
    console.error("Agent endpoint error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}

// Vercel Edge Runtime
export const config = { runtime: "edge" };
export default handleAgentEndpoint;
