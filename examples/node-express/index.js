/**
 * Sales Agent Benchmark - Node.js Express Reference Implementation
 *
 * This implements the benchmark API contract for evaluating sales agents.
 * Your agent receives deal context and must return risk analysis + next steps.
 *
 * Run:
 *   npm install express
 *   export OPENAI_API_KEY=sk-...
 *   node index.js
 *
 * Test:
 *   curl -X POST http://localhost:3000/analyze \
 *     -H "Content-Type: application/json" \
 *     -d '{"checkpoint_id": "test-1", "deal_context": {"company": "Acme Corp", "stage": "Discovery", "last_interaction": "Demo call", "pain_points": ["Manual processes"], "stakeholders": [{"name": "Jane", "role": "champion"}], "history": "Initial outreach"}, "question": "What are the top risks?"}'
 */

const express = require("express");
const app = express();
app.use(express.json());

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
const API_URL =
  process.env.OPENAI_BASE_URL || "https://api.openai.com/v1/chat/completions";
const MODEL = process.env.MODEL || "gpt-4o";

app.post("/analyze", async (req, res) => {
  const body = req.body;

  // Validate required fields
  if (!body.checkpoint_id && !body.checkpointId) {
    return res.status(400).json({ error: "checkpoint_id is required" });
  }
  if (!body.deal_context && !body.dealContext) {
    return res.status(400).json({ error: "deal_context is required" });
  }

  const ctx = body.deal_context || body.dealContext;
  const question =
    body.question || "What are the top risks and recommended next steps?";

  // Build prompt from deal context
  const painPoints = ctx.pain_points || ctx.painPoints || [];
  const stakeholders = ctx.stakeholders || [];
  const prompt = `## Deal: ${ctx.company || "Unknown"}
Stage: ${ctx.stage || "Unknown"}
Last Interaction: ${ctx.last_interaction || ctx.lastInteraction || "N/A"}

Pain Points:
${painPoints.map((p) => `- ${p}`).join("\n")}

Stakeholders:
${stakeholders.map((s) => `- ${s.name} (${s.role})`).join("\n")}

History: ${ctx.history || "N/A"}

---
Question: ${question}

Analyze this deal and provide your assessment as JSON.`;

  try {
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
    res.json({
      risks: parsed.risks || [],
      next_steps: parsed.nextSteps || parsed.next_steps || [],
      confidence: parsed.confidence ?? 0.5,
      reasoning: parsed.reasoning || "Unable to parse response",
    });
  } catch (error) {
    console.error("Agent error:", error);
    res.status(500).json({
      risks: [
        {
          description: "Unable to analyze deal - error in processing",
          severity: "high",
        },
      ],
      next_steps: [{ action: "Review deal context and try again", priority: 1 }],
      confidence: 0,
      reasoning: `Error: ${error.message || "Unknown error"}`,
    });
  }
});

app.listen(3000, () => {
  console.log("Sales agent listening on http://localhost:3000/analyze");
});
