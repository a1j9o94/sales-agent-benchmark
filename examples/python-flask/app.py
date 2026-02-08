"""
Sales Agent Benchmark - Python Flask Reference Implementation

This implements the benchmark API contract for evaluating sales agents.
Your agent receives deal context and must return risk analysis + next steps.

Run:
  pip install flask openai
  export OPENAI_API_KEY=sk-...
  python app.py

Test:
  curl -X POST http://localhost:5000/analyze \
    -H "Content-Type: application/json" \
    -d '{"checkpoint_id": "test-1", "deal_context": {"company": "Acme Corp", "stage": "Discovery", "last_interaction": "Demo call last week", "pain_points": ["Manual processes"], "stakeholders": [{"name": "Jane", "role": "champion"}], "history": "Initial outreach"}, "question": "What are the top risks?"}'
"""

import json
import os
from flask import Flask, request, jsonify
from openai import OpenAI

app = Flask(__name__)

# Use any OpenAI-compatible API (OpenAI, OpenRouter, local models, etc.)
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

SYSTEM_PROMPT = """You are an expert sales analyst. Analyze the deal and return JSON:
{
  "risks": [{"description": "...", "severity": "high|medium|low"}],
  "nextSteps": [{"action": "...", "priority": 1, "rationale": "..."}],
  "confidence": 0.0-1.0,
  "reasoning": "2-3 sentences"
}
Be specific to the deal context. Reference actual stakeholders and dynamics."""


@app.route("/analyze", methods=["POST"])
def analyze():
    body = request.get_json()

    # Validate required fields
    if not body.get("checkpoint_id") and not body.get("checkpointId"):
        return jsonify({"error": "checkpoint_id is required"}), 400
    if not body.get("deal_context") and not body.get("dealContext"):
        return jsonify({"error": "deal_context is required"}), 400

    # Build the prompt from deal context
    ctx = body.get("deal_context") or body.get("dealContext")
    question = body.get("question", "What are the top risks and recommended next steps?")

    prompt = f"""## Deal: {ctx.get('company', 'Unknown')}
Stage: {ctx.get('stage', 'Unknown')}
Last Interaction: {ctx.get('last_interaction') or ctx.get('lastInteraction', 'N/A')}

Pain Points:
{chr(10).join('- ' + p for p in (ctx.get('pain_points') or ctx.get('painPoints', [])))}

Stakeholders:
{chr(10).join('- ' + s.get('name', '?') + ' (' + s.get('role', '?') + ')' for s in ctx.get('stakeholders', []))}

History: {ctx.get('history', 'N/A')}

---
Question: {question}

Analyze this deal and provide your assessment as JSON."""

    # Call the LLM
    response = client.chat.completions.create(
        model="gpt-4o",  # Change to your preferred model
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        temperature=0.3,
    )

    # Parse JSON from response
    text = response.choices[0].message.content or ""
    try:
        # Extract JSON from potential markdown code blocks
        import re
        json_match = re.search(r"\{[\s\S]*\}", text)
        parsed = json.loads(json_match.group()) if json_match else {}
    except (json.JSONDecodeError, AttributeError):
        parsed = {}

    # Return normalized response (snake_case for API compatibility)
    return jsonify({
        "risks": parsed.get("risks", []),
        "next_steps": parsed.get("nextSteps", parsed.get("next_steps", [])),
        "confidence": parsed.get("confidence", 0.5),
        "reasoning": parsed.get("reasoning", "Unable to parse response"),
    })


if __name__ == "__main__":
    app.run(port=5000, debug=True)
