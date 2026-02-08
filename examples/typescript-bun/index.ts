/**
 * Sales Agent Benchmark - Bun/TypeScript Reference Implementation
 *
 * This implements the benchmark API contract for evaluating sales agents.
 * Your agent receives deal context and must return risk analysis + next steps.
 *
 * Run:
 *   export OPENAI_API_KEY=sk-...
 *   bun index.ts
 *
 * Test:
 *   curl -X POST http://localhost:3000/analyze \
 *     -H "Content-Type: application/json" \
 *     -d '{"checkpoint_id": "test-1", "deal_context": {"company": "Acme Corp", "stage": "Discovery", "last_interaction": "Demo call", "pain_points": ["Manual processes"], "stakeholders": [{"name": "Jane", "role": "champion"}], "history": "Initial outreach"}, "question": "What are the top risks?"}'
 */

const SYSTEM_PROMPT = `You are an expert sales analyst. Analyze the deal and return JSON:
{
  "risks": [{"description": "...", "severity": "high|medium|low"}],
  "nextSteps": [{"action": "...", "priority": 1, "rationale": "..."}],
  "confidence": 0.0-1.0,
  "reasoning": "2-3 sentences"
}
Be specific to the deal context. Reference actual stakeholders and dynamics.`;

// Use any OpenAI-compatible API endpoint
const API_KEY = process.env.OPENAI_API_KEY;
const API_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1/chat/completions";
const MODEL = process.env.MODEL || "gpt-4o";

Bun.serve({
  port: 3000,
  routes: {
    "/analyze": {
      POST: async (req) => {
        const body = await req.json();

        // Validate required fields
        if (!body.checkpoint_id && !body.checkpointId) {
          return Response.json({ error: "checkpoint_id is required" }, { status: 400 });
        }
        if (!body.deal_context && !body.dealContext) {
          return Response.json({ error: "deal_context is required" }, { status: 400 });
        }

        const ctx = body.deal_context || body.dealContext;
        const question = body.question || "What are the top risks and recommended next steps?";

        // Build prompt from deal context
        const painPoints = (ctx.pain_points || ctx.painPoints || []) as string[];
        const stakeholders = (ctx.stakeholders || []) as { name: string; role: string }[];
        const prompt = `## Deal: ${ctx.company || "Unknown"}
Stage: ${ctx.stage || "Unknown"}
Last Interaction: ${ctx.last_interaction || ctx.lastInteraction || "N/A"}

Pain Points:
${painPoints.map((p: string) => `- ${p}`).join("\n")}

Stakeholders:
${stakeholders.map((s) => `- ${s.name} (${s.role})`).join("\n")}

History: ${ctx.history || "N/A"}

---
Question: ${question}

Analyze this deal and provide your assessment as JSON.`;

        // Call the LLM
        const llmResponse = await fetch(API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${API_KEY}`,
          },
          body: JSON.stringify({
            model: MODEL,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: prompt },
            ],
            temperature: 0.3,
          }),
        });

        const llmData = await llmResponse.json();
        const text = llmData.choices?.[0]?.message?.content || "";

        // Parse JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

        // Return normalized response (snake_case for API compatibility)
        return Response.json({
          risks: parsed.risks || [],
          next_steps: parsed.nextSteps || parsed.next_steps || [],
          confidence: parsed.confidence ?? 0.5,
          reasoning: parsed.reasoning || "Unable to parse response",
        });
      },
    },
  },
});

console.log("Sales agent listening on http://localhost:3000/analyze");
