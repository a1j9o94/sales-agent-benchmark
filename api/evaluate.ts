import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

export const config = {
  runtime: "edge",
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

const JUDGE_RUBRIC = `You are evaluating a sales AI agent's output for quality and effectiveness.

## Scoring Dimensions (0-2 each)
- 0: Not addressed or wrong
- 1: Mentioned but shallow or generic
- 2: Specific, actionable, shows sales intelligence

## Dimensions to Evaluate

**specificity**: Does the output address the specific situation, not generic advice?
**actionability**: Are there clear next steps someone could actually take?
**sales_iq**: Does it show understanding of sales dynamics (power, urgency, competition)?
**completeness**: Does it cover the key aspects of the task?
**conciseness**: Is it appropriately scoped, not padded or rambling?

## Output Format
Return ONLY valid JSON with this structure:
{
  "scores": {
    "specificity": 0-2,
    "actionability": 0-2,
    "sales_iq": 0-2,
    "completeness": 0-2,
    "conciseness": 0-2
  },
  "total": sum of scores,
  "maxScore": 10,
  "passed": true if total >= 7,
  "reasoning": "2-3 sentences explaining the evaluation"
}`;

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

    // Step 1: Run the sales agent
    const agentResult = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      system: SALES_AGENT_CONTEXT,
      prompt: scenario,
    });

    const agentOutput = agentResult.text;

    // Step 2: Judge the output
    const judgeResult = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      system: JUDGE_RUBRIC,
      prompt: `## Scenario\n${scenario}\n\n## Agent Output\n${agentOutput}`,
    });

    // Parse the judge's evaluation
    let evaluation;
    try {
      // Extract JSON from the response (handle potential markdown code blocks)
      const jsonMatch = judgeResult.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in judge response");
      }
      evaluation = JSON.parse(jsonMatch[0]);
    } catch {
      // Fallback if parsing fails
      evaluation = {
        scores: {
          specificity: 1,
          actionability: 1,
          sales_iq: 1,
          completeness: 1,
          conciseness: 1,
        },
        total: 5,
        maxScore: 10,
        passed: false,
        reasoning: "Could not parse evaluation. Raw response: " + judgeResult.text.slice(0, 200),
      };
    }

    return Response.json({
      agentOutput,
      evaluation,
    });
  } catch (error) {
    console.error("Evaluation error:", error);
    const errorMessage = error instanceof Error ? error.message : "Evaluation failed";
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
