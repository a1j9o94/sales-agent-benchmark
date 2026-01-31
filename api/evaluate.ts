import { streamText, generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

export const config = {
  runtime: "edge",
  maxDuration: 60,
};

const SALES_AGENT_CONTEXT = `You are an expert sales analyst and strategist. Your role is to help with:

- Deal preparation and account research
- Competitive positioning and objection handling
- Outreach and follow-up messaging
- MEDDPICC qualification analysis
- ROI calculations and value propositions

When given a sales scenario, provide actionable, specific guidance. Be concise but thorough.
Focus on what will actually help close the deal, not generic advice.

Always consider:
- Who is the economic buyer and how do we reach them?
- What is the specific pain driving urgency?
- Who is our competition and how do we differentiate?
- What are the likely objections and how do we address them?
- What is the next concrete action?`;

const JUDGE_RUBRIC = `You are evaluating a sales AI agent's output. Be concise.

Score each dimension 0-2 (0=missing, 1=shallow, 2=strong):
- specificity: Addresses specific situation vs generic advice
- actionability: Clear next steps someone could take
- sales_iq: Understanding of sales dynamics (power, urgency, competition)
- completeness: Covers key aspects of the task
- conciseness: Appropriately scoped, not padded

Return ONLY JSON:
{"scores":{"specificity":X,"actionability":X,"sales_iq":X,"completeness":X,"conciseness":X},"total":X,"maxScore":10,"passed":true/false,"reasoning":"1-2 sentences"}`;

interface EvalRequest {
  scenario: string;
}

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = (await req.json()) as EvalRequest;
    const scenario = body.scenario;

    if (!scenario || typeof scenario !== "string") {
      return Response.json({ error: "Scenario is required" }, { status: 400 });
    }

    // Step 1: Run the sales agent (use streaming to avoid timeout)
    const agentResult = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      system: SALES_AGENT_CONTEXT,
      prompt: scenario,
    });

    const agentOutput = agentResult.text;

    // Step 2: Judge the output (use faster model)
    const judgeResult = await generateText({
      model: anthropic("claude-3-5-haiku-20241022"),
      system: JUDGE_RUBRIC,
      prompt: `Scenario:\n${scenario.slice(0, 1000)}\n\nAgent Output:\n${agentOutput.slice(0, 2000)}`,
    });

    // Parse the judge's evaluation
    let evaluation;
    try {
      const jsonMatch = judgeResult.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found");
      }
      evaluation = JSON.parse(jsonMatch[0]);
    } catch {
      evaluation = {
        scores: { specificity: 1, actionability: 1, sales_iq: 1, completeness: 1, conciseness: 1 },
        total: 5,
        maxScore: 10,
        passed: false,
        reasoning: "Could not parse evaluation",
      };
    }

    return Response.json({ agentOutput, evaluation });
  } catch (error) {
    console.error("Evaluation error:", error);
    const errorMessage = error instanceof Error ? error.message : "Evaluation failed";
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
