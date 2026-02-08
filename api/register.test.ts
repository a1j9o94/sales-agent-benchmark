import { test, expect, describe, beforeEach } from "bun:test";
import {
  getRegisteredAgent,
  getAgentById,
  getAllAgents,
  handleRegisterEndpoint,
  handleUnregisterEndpoint,
  handleTestEndpoint,
} from "./register";

// Helper to register an agent and return the parsed response body
async function registerAgent(
  overrides: Record<string, unknown> = {}
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const payload = {
    endpoint: `http://example.com/agent-${Date.now()}-${Math.random()}`,
    name: "Test Agent",
    ...overrides,
  };
  const req = new Request("http://localhost/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const response = await handleRegisterEndpoint(req);
  const body = (await response.json()) as Record<string, unknown>;
  return { response, body };
}

// Helper to clear all agents between tests by unregistering them
async function clearAllAgents(): Promise<void> {
  const agents = getAllAgents();
  for (const agent of agents) {
    const req = new Request("http://localhost/api/unregister", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${agent.apiKey}` },
    });
    await handleUnregisterEndpoint(req);
  }
}

// ─── generateApiKey() ──────────────────────────────────────────────────────────

describe("generateApiKey()", () => {
  test("generated key has sab_ prefix", async () => {
    const { body } = await registerAgent();
    const agent = body.agent as Record<string, unknown>;
    const apiKey = agent.apiKey as string;
    expect(apiKey.startsWith("sab_")).toBe(true);

    // cleanup
    const delReq = new Request("http://localhost/api/unregister", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    await handleUnregisterEndpoint(delReq);
  });

  test("generated key has correct total length (4 prefix + 32 random = 36)", async () => {
    const { body } = await registerAgent();
    const agent = body.agent as Record<string, unknown>;
    const apiKey = agent.apiKey as string;
    expect(apiKey.length).toBe(36);

    const delReq = new Request("http://localhost/api/unregister", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    await handleUnregisterEndpoint(delReq);
  });

  test("generated key random part contains only alphanumeric characters", async () => {
    const { body } = await registerAgent();
    const agent = body.agent as Record<string, unknown>;
    const apiKey = agent.apiKey as string;
    const randomPart = apiKey.slice(4); // everything after "sab_"
    expect(randomPart).toMatch(/^[A-Za-z0-9]+$/);

    const delReq = new Request("http://localhost/api/unregister", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    await handleUnregisterEndpoint(delReq);
  });

  test("each generated key is unique", async () => {
    const results = await Promise.all([
      registerAgent({ endpoint: "http://unique1.com/agent" }),
      registerAgent({ endpoint: "http://unique2.com/agent" }),
      registerAgent({ endpoint: "http://unique3.com/agent" }),
    ]);
    const keys = results.map(
      (r) => (r.body.agent as Record<string, unknown>).apiKey as string
    );
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(3);

    // cleanup
    for (const key of keys) {
      const delReq = new Request("http://localhost/api/unregister", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${key}` },
      });
      await handleUnregisterEndpoint(delReq);
    }
  });
});

// ─── generateAgentId() ─────────────────────────────────────────────────────────

describe("generateAgentId()", () => {
  test("generated id has agent_ prefix", async () => {
    const { body } = await registerAgent();
    const agent = body.agent as Record<string, unknown>;
    const id = agent.id as string;
    expect(id.startsWith("agent_")).toBe(true);

    const delReq = new Request("http://localhost/api/unregister", {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${agent.apiKey as string}`,
      },
    });
    await handleUnregisterEndpoint(delReq);
  });

  test("generated id contains a timestamp component", async () => {
    const before = Date.now();
    const { body } = await registerAgent();
    const after = Date.now();
    const agent = body.agent as Record<string, unknown>;
    const id = agent.id as string;

    // Format: agent_{timestamp}_{random}
    const parts = id.split("_");
    expect(parts.length).toBe(3);
    const timestamp = parseInt(parts[1], 10);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);

    const delReq = new Request("http://localhost/api/unregister", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${agent.apiKey as string}` },
    });
    await handleUnregisterEndpoint(delReq);
  });

  test("generated ids are unique across multiple registrations", async () => {
    const results = await Promise.all([
      registerAgent({ endpoint: "http://uid1.com/agent" }),
      registerAgent({ endpoint: "http://uid2.com/agent" }),
      registerAgent({ endpoint: "http://uid3.com/agent" }),
    ]);
    const ids = results.map(
      (r) => (r.body.agent as Record<string, unknown>).id as string
    );
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(3);

    // cleanup
    for (const r of results) {
      const agent = r.body.agent as Record<string, unknown>;
      const delReq = new Request("http://localhost/api/unregister", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${agent.apiKey as string}` },
      });
      await handleUnregisterEndpoint(delReq);
    }
  });
});

// ─── Agent registration/lookup functions ────────────────────────────────────────

describe("agent lookup functions", () => {
  beforeEach(async () => {
    await clearAllAgents();
  });

  test("getRegisteredAgent() returns agent by apiKey", async () => {
    const { body } = await registerAgent({
      endpoint: "http://lookup-test.com/agent",
    });
    const agent = body.agent as Record<string, unknown>;
    const apiKey = agent.apiKey as string;

    const found = getRegisteredAgent(apiKey);
    expect(found).toBeDefined();
    expect(found!.id).toBe(agent.id);
    expect(found!.endpoint).toBe(agent.endpoint);
  });

  test("getRegisteredAgent() returns undefined for unknown key", () => {
    const found = getRegisteredAgent("sab_nonexistent_key_12345678901234");
    expect(found).toBeUndefined();
  });

  test("getAgentById() returns agent by id", async () => {
    const { body } = await registerAgent({
      endpoint: "http://byid-test.com/agent",
    });
    const agent = body.agent as Record<string, unknown>;
    const id = agent.id as string;

    const found = getAgentById(id);
    expect(found).toBeDefined();
    expect(found!.apiKey).toBe(agent.apiKey);
  });

  test("getAgentById() returns undefined for unknown id", () => {
    const found = getAgentById("agent_0_unknown");
    expect(found).toBeUndefined();
  });

  test("getAllAgents() returns all registered agents", async () => {
    await registerAgent({ endpoint: "http://all1.com/agent" });
    await registerAgent({ endpoint: "http://all2.com/agent" });
    await registerAgent({ endpoint: "http://all3.com/agent" });

    const agents = getAllAgents();
    expect(agents.length).toBe(3);
  });

  test("getAllAgents() returns empty array when no agents registered", () => {
    const agents = getAllAgents();
    expect(agents.length).toBe(0);
  });
});

// ─── handleRegisterEndpoint ─────────────────────────────────────────────────────

describe("handleRegisterEndpoint", () => {
  beforeEach(async () => {
    await clearAllAgents();
  });

  test("POST with valid endpoint registers successfully", async () => {
    const { response, body } = await registerAgent({
      endpoint: "http://valid.com/agent",
      name: "Valid Agent",
    });

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toContain("Agent registered successfully");

    const agent = body.agent as Record<string, unknown>;
    expect(agent.id).toBeDefined();
    expect(agent.endpoint).toBe("http://valid.com/agent");
    expect(agent.name).toBe("Valid Agent");
    expect(agent.registeredAt).toBeDefined();
    expect(agent.apiKey).toBeDefined();
  });

  test("POST accepts 'url' field as alias for 'endpoint'", async () => {
    const req = new Request("http://localhost/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "http://alias-test.com/agent", name: "Alias" }),
    });
    const response = await handleRegisterEndpoint(req);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    const agent = body.agent as Record<string, unknown>;
    expect(agent.endpoint).toBe("http://alias-test.com/agent");
  });

  test("POST without name registers with undefined name", async () => {
    const req = new Request("http://localhost/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: "http://noname.com/agent" }),
    });
    const response = await handleRegisterEndpoint(req);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("POST without endpoint returns 400", async () => {
    const req = new Request("http://localhost/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "No Endpoint" }),
    });
    const response = await handleRegisterEndpoint(req);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(400);
    expect(body.error).toBe("endpoint is required");
  });

  test("POST with invalid URL returns 400", async () => {
    const req = new Request("http://localhost/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: "not-a-url" }),
    });
    const response = await handleRegisterEndpoint(req);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid endpoint URL");
  });

  test("POST with non-string endpoint returns 400", async () => {
    const req = new Request("http://localhost/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: 12345 }),
    });
    const response = await handleRegisterEndpoint(req);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(400);
    expect(body.error).toBe("endpoint is required");
  });

  test("POST with duplicate endpoint returns 409", async () => {
    const endpoint = "http://duplicate.com/agent";
    await registerAgent({ endpoint });

    const { response, body } = await registerAgent({ endpoint });

    expect(response.status).toBe(409);
    expect(body.error).toBe("Endpoint already registered");
    expect(body.agentId).toBeDefined();
  });

  test("POST with invalid JSON returns 500", async () => {
    const req = new Request("http://localhost/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json at all",
    });
    const response = await handleRegisterEndpoint(req);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(body.error).toBeDefined();
  });

  test("GET returns list of agents without apiKeys", async () => {
    await registerAgent({ endpoint: "http://list1.com/agent", name: "Agent 1" });
    await registerAgent({ endpoint: "http://list2.com/agent", name: "Agent 2" });

    const req = new Request("http://localhost/api/register", { method: "GET" });
    const response = await handleRegisterEndpoint(req);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    const agents = body.agents as Record<string, unknown>[];
    expect(agents.length).toBe(2);

    // Verify apiKey is not exposed in the listing
    for (const agent of agents) {
      expect(agent.id).toBeDefined();
      expect(agent.endpoint).toBeDefined();
      expect(agent.name).toBeDefined();
      expect(agent.registeredAt).toBeDefined();
      expect(agent.apiKey).toBeUndefined();
    }
  });

  test("PUT returns 405 method not allowed", async () => {
    const req = new Request("http://localhost/api/register", { method: "PUT" });
    const response = await handleRegisterEndpoint(req);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(405);
    expect(body.error).toBe("Method not allowed");
  });

  test("DELETE returns 405 method not allowed", async () => {
    const req = new Request("http://localhost/api/register", {
      method: "DELETE",
    });
    const response = await handleRegisterEndpoint(req);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(405);
    expect(body.error).toBe("Method not allowed");
  });

  test("registeredAt is a valid ISO date string", async () => {
    const { body } = await registerAgent({
      endpoint: "http://datecheck.com/agent",
    });
    const agent = body.agent as Record<string, unknown>;
    const registeredAt = agent.registeredAt as string;
    const parsed = new Date(registeredAt);
    expect(parsed.toISOString()).toBe(registeredAt);
  });
});

// ─── handleUnregisterEndpoint ───────────────────────────────────────────────────

describe("handleUnregisterEndpoint", () => {
  beforeEach(async () => {
    await clearAllAgents();
  });

  test("DELETE with valid API key unregisters agent", async () => {
    const { body: regBody } = await registerAgent({
      endpoint: "http://unreg.com/agent",
    });
    const agent = regBody.agent as Record<string, unknown>;
    const apiKey = agent.apiKey as string;
    const agentId = agent.id as string;

    const req = new Request("http://localhost/api/unregister", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const response = await handleUnregisterEndpoint(req);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toContain(agentId);

    // Verify agent is actually gone
    const found = getAgentById(agentId);
    expect(found).toBeUndefined();
  });

  test("DELETE without API key returns 401", async () => {
    const req = new Request("http://localhost/api/unregister", {
      method: "DELETE",
    });
    const response = await handleUnregisterEndpoint(req);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(401);
    expect(body.error).toBe("API key required");
  });

  test("DELETE with invalid API key returns 401", async () => {
    const req = new Request("http://localhost/api/unregister", {
      method: "DELETE",
      headers: { Authorization: "Bearer sab_invalid_key_that_does_not_exist" },
    });
    const response = await handleUnregisterEndpoint(req);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(401);
    expect(body.error).toBe("Invalid API key");
  });

  test("POST returns 405 method not allowed", async () => {
    const req = new Request("http://localhost/api/unregister", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const response = await handleUnregisterEndpoint(req);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(405);
    expect(body.error).toBe("Method not allowed");
  });

  test("GET returns 405 method not allowed", async () => {
    const req = new Request("http://localhost/api/unregister", {
      method: "GET",
    });
    const response = await handleUnregisterEndpoint(req);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(405);
    expect(body.error).toBe("Method not allowed");
  });

  test("agent is not findable by apiKey after unregistration", async () => {
    const { body: regBody } = await registerAgent({
      endpoint: "http://gone.com/agent",
    });
    const agent = regBody.agent as Record<string, unknown>;
    const apiKey = agent.apiKey as string;

    // Unregister
    const delReq = new Request("http://localhost/api/unregister", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    await handleUnregisterEndpoint(delReq);

    // Confirm the apiKey lookup returns undefined
    const found = getRegisteredAgent(apiKey);
    expect(found).toBeUndefined();
  });

  test("unregistering does not affect other agents", async () => {
    const { body: reg1 } = await registerAgent({
      endpoint: "http://keep.com/agent",
    });
    const { body: reg2 } = await registerAgent({
      endpoint: "http://remove.com/agent",
    });
    const agent1 = reg1.agent as Record<string, unknown>;
    const agent2 = reg2.agent as Record<string, unknown>;

    const delReq = new Request("http://localhost/api/unregister", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${agent2.apiKey as string}` },
    });
    await handleUnregisterEndpoint(delReq);

    // Agent 1 should still exist
    const found = getAgentById(agent1.id as string);
    expect(found).toBeDefined();
    expect(found!.endpoint).toBe("http://keep.com/agent");

    // Agent 2 should be gone
    const gone = getAgentById(agent2.id as string);
    expect(gone).toBeUndefined();
  });
});

// ─── handleTestEndpoint ─────────────────────────────────────────────────────────

describe("handleTestEndpoint", () => {
  test("non-POST method returns 405", async () => {
    const req = new Request("http://localhost/api/test", { method: "GET" });
    const response = await handleTestEndpoint(req);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(405);
    expect(body.error).toBe("Method not allowed");
  });

  test("POST without endpoint returns 400", async () => {
    const req = new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "no endpoint" }),
    });
    const response = await handleTestEndpoint(req);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(400);
    expect(body.error).toBe("endpoint is required");
  });

  test("POST accepts 'url' field as alias for 'endpoint'", async () => {
    // This will fail to connect to a non-existent server, but should not
    // return a 400 for missing endpoint
    const req = new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "http://127.0.0.1:1/nonexistent" }),
    });
    const response = await handleTestEndpoint(req);
    const body = (await response.json()) as Record<string, unknown>;

    // It should try to fetch and fail with a connection error, not a 400
    expect(body.error).not.toBe("endpoint is required");
    expect(body.success).toBe(false);
  });

  test("POST with unreachable endpoint returns error gracefully", async () => {
    const req = new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: "http://127.0.0.1:1/nonexistent" }),
    });
    const response = await handleTestEndpoint(req);
    const body = (await response.json()) as Record<string, unknown>;

    // Should not crash -- returns a JSON error
    expect(response.status).toBe(200); // the wrapper returns 200 with success: false
    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
  });

  test("POST with invalid JSON body returns error gracefully", async () => {
    const req = new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "this is not json",
    });
    const response = await handleTestEndpoint(req);
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
  });

  test("PUT returns 405 method not allowed", async () => {
    const req = new Request("http://localhost/api/test", { method: "PUT" });
    const response = await handleTestEndpoint(req);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(405);
    expect(body.error).toBe("Method not allowed");
  });
});

// ─── Integration: full registration lifecycle ──────────────────────────────────

describe("full registration lifecycle", () => {
  beforeEach(async () => {
    await clearAllAgents();
  });

  test("register -> lookup -> list -> unregister -> verify gone", async () => {
    // 1. Register
    const { body: regBody } = await registerAgent({
      endpoint: "http://lifecycle.com/agent",
      name: "Lifecycle Agent",
    });
    expect(regBody.success).toBe(true);
    const agent = regBody.agent as Record<string, unknown>;
    const apiKey = agent.apiKey as string;
    const agentId = agent.id as string;

    // 2. Lookup by API key
    const foundByKey = getRegisteredAgent(apiKey);
    expect(foundByKey).toBeDefined();
    expect(foundByKey!.id).toBe(agentId);

    // 3. Lookup by ID
    const foundById = getAgentById(agentId);
    expect(foundById).toBeDefined();
    expect(foundById!.endpoint).toBe("http://lifecycle.com/agent");

    // 4. List all (via GET)
    const listReq = new Request("http://localhost/api/register", {
      method: "GET",
    });
    const listResp = await handleRegisterEndpoint(listReq);
    const listBody = (await listResp.json()) as Record<string, unknown>;
    const agents = listBody.agents as Record<string, unknown>[];
    expect(agents.length).toBe(1);
    expect(agents[0].id).toBe(agentId);
    expect(agents[0].apiKey).toBeUndefined(); // should not expose key

    // 5. Unregister
    const delReq = new Request("http://localhost/api/unregister", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const delResp = await handleUnregisterEndpoint(delReq);
    const delBody = (await delResp.json()) as Record<string, unknown>;
    expect(delResp.status).toBe(200);
    expect(delBody.success).toBe(true);

    // 6. Verify gone
    expect(getAgentById(agentId)).toBeUndefined();
    expect(getRegisteredAgent(apiKey)).toBeUndefined();
    expect(getAllAgents().length).toBe(0);
  });

  test("re-registering after unregister succeeds with same endpoint", async () => {
    const endpoint = "http://reregister.com/agent";

    // Register
    const { body: reg1 } = await registerAgent({ endpoint });
    const agent1 = reg1.agent as Record<string, unknown>;

    // Unregister
    const delReq = new Request("http://localhost/api/unregister", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${agent1.apiKey as string}` },
    });
    await handleUnregisterEndpoint(delReq);

    // Re-register with the same endpoint
    const { response, body: reg2 } = await registerAgent({ endpoint });
    expect(response.status).toBe(200);
    expect(reg2.success).toBe(true);

    // Should get a new agent ID and API key
    const agent2 = reg2.agent as Record<string, unknown>;
    expect(agent2.id).not.toBe(agent1.id);
    expect(agent2.apiKey).not.toBe(agent1.apiKey);
  });
});
