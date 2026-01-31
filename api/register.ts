/**
 * Agent Registration API
 *
 * Register external agent API endpoints to participate in the benchmark.
 */

import type { RegisteredAgent } from "../src/types/benchmark";

// In-memory storage for registered agents (would use a database in production)
const registeredAgents = new Map<string, RegisteredAgent>();

function generateApiKey(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "sab_"; // sales-agent-benchmark prefix
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateAgentId(): string {
  return `agent_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

export function getRegisteredAgent(apiKey: string): RegisteredAgent | undefined {
  for (const agent of registeredAgents.values()) {
    if (agent.apiKey === apiKey) {
      return agent;
    }
  }
  return undefined;
}

export function getAgentById(id: string): RegisteredAgent | undefined {
  return registeredAgents.get(id);
}

export function getAllAgents(): RegisteredAgent[] {
  return Array.from(registeredAgents.values());
}

export async function handleRegisterEndpoint(req: Request): Promise<Response> {
  if (req.method === "GET") {
    // List all registered agents (without API keys)
    const agents = getAllAgents().map(({ id, endpoint, name, registeredAt }) => ({
      id,
      endpoint,
      name,
      registeredAt,
    }));
    return Response.json({ agents });
  }

  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await req.json();

    // Validate endpoint
    const endpoint = body.endpoint || body.url;
    if (!endpoint || typeof endpoint !== "string") {
      return Response.json({ error: "endpoint is required" }, { status: 400 });
    }

    // Validate URL format
    try {
      new URL(endpoint);
    } catch {
      return Response.json({ error: "Invalid endpoint URL" }, { status: 400 });
    }

    // Check if endpoint is already registered
    for (const agent of registeredAgents.values()) {
      if (agent.endpoint === endpoint) {
        return Response.json(
          { error: "Endpoint already registered", agentId: agent.id },
          { status: 409 }
        );
      }
    }

    // Create new agent registration
    const agent: RegisteredAgent = {
      id: generateAgentId(),
      endpoint,
      name: body.name || undefined,
      registeredAt: new Date().toISOString(),
      apiKey: generateApiKey(),
    };

    registeredAgents.set(agent.id, agent);

    console.log(`Registered new agent: ${agent.id} -> ${agent.endpoint}`);

    return Response.json({
      success: true,
      agent: {
        id: agent.id,
        endpoint: agent.endpoint,
        name: agent.name,
        registeredAt: agent.registeredAt,
        apiKey: agent.apiKey, // Only returned on registration
      },
      message: "Agent registered successfully. Save your API key - it won't be shown again.",
    });
  } catch (error) {
    console.error("Registration error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Registration failed" },
      { status: 500 }
    );
  }
}

// Delete an agent registration
export async function handleUnregisterEndpoint(req: Request): Promise<Response> {
  if (req.method !== "DELETE") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const apiKey = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!apiKey) {
    return Response.json({ error: "API key required" }, { status: 401 });
  }

  const agent = getRegisteredAgent(apiKey);
  if (!agent) {
    return Response.json({ error: "Invalid API key" }, { status: 401 });
  }

  registeredAgents.delete(agent.id);

  return Response.json({
    success: true,
    message: `Agent ${agent.id} unregistered successfully`,
  });
}

// Test an agent endpoint
export async function handleTestEndpoint(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await req.json();
    const endpoint = body.endpoint || body.url;

    if (!endpoint) {
      return Response.json({ error: "endpoint is required" }, { status: 400 });
    }

    // Send a test request to the agent
    const testRequest = {
      checkpoint_id: "test_checkpoint_001",
      deal_context: {
        company: "Test Corp",
        stage: "Discovery",
        last_interaction: "Initial discovery call yesterday",
        pain_points: ["Manual process taking 20 hours per week", "Scaling concerns"],
        stakeholders: [
          { name: "John Smith", role: "VP Operations", sentiment: "positive" },
          { name: "Jane Doe", role: "CFO", sentiment: "neutral" },
        ],
        timeline: "Q1 decision",
        history: "First call went well. Champion is engaged.",
      },
      question: "What are the top risks and recommended next steps?",
    };

    const startTime = Date.now();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testRequest),
    });
    const latency = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      return Response.json({
        success: false,
        error: `Agent returned status ${response.status}`,
        details: errorText.slice(0, 500),
        latency,
      });
    }

    const agentResponse = await response.json();

    // Validate response structure
    const validationErrors: string[] = [];
    if (!Array.isArray(agentResponse.risks)) {
      validationErrors.push("Response missing 'risks' array");
    }
    if (!Array.isArray(agentResponse.next_steps) && !Array.isArray(agentResponse.nextSteps)) {
      validationErrors.push("Response missing 'next_steps' array");
    }
    if (typeof agentResponse.confidence !== "number") {
      validationErrors.push("Response missing 'confidence' number");
    }
    if (typeof agentResponse.reasoning !== "string") {
      validationErrors.push("Response missing 'reasoning' string");
    }

    return Response.json({
      success: validationErrors.length === 0,
      latency,
      validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
      response: agentResponse,
    });
  } catch (error) {
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : "Test failed",
    });
  }
}
