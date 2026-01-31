#!/usr/bin/env bun
/**
 * Test script for the Sales Agent Benchmark API
 */

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

async function testHello() {
  console.log("\n1. Testing /api/hello...");
  const res = await fetch(`${BASE_URL}/api/hello`);
  const data = await res.json();
  console.log("   Response:", data);
  return res.ok;
}

async function testDeals() {
  console.log("\n2. Testing /api/benchmark/deals...");
  const res = await fetch(`${BASE_URL}/api/benchmark/deals?mode=public`);
  const data = await res.json();
  console.log(`   Found ${data.count} public deals:`, data.deals.map((d: any) => d.name).join(", "));
  return res.ok && data.count > 0;
}

async function testAgent() {
  console.log("\n3. Testing /api/agent (reference agent)...");
  const res = await fetch(`${BASE_URL}/api/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      checkpoint_id: "test_001",
      deal_context: {
        company: "Test Corp",
        stage: "Discovery",
        last_interaction: "Initial call yesterday",
        pain_points: ["Manual process taking 20 hours/week"],
        stakeholders: [{ name: "John", role: "VP Ops", sentiment: "positive" }],
        history: "Strong initial interest",
      },
      question: "What are the risks?",
    }),
  });
  const data = await res.json();
  console.log("   Risks:", data.risks?.slice(0, 2).map((r: any) => r.description));
  console.log("   Next steps:", data.next_steps?.slice(0, 2).map((s: any) => s.action));
  console.log("   Confidence:", data.confidence);
  return res.ok && data.risks && data.next_steps;
}

async function testRegister() {
  console.log("\n4. Testing /api/register...");
  const res = await fetch(`${BASE_URL}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: `${BASE_URL}/api/agent`,
      name: "Reference Agent (Test)",
    }),
  });
  const data = await res.json();
  console.log("   Agent ID:", data.agent?.id);
  console.log("   API Key:", data.agent?.apiKey?.slice(0, 15) + "...");
  return res.ok && data.agent?.apiKey;
}

async function testBenchmarkRun() {
  console.log("\n5. Testing /api/benchmark/run (with 1 deal limit)...");
  const res = await fetch(`${BASE_URL}/api/benchmark/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "public",
      endpoint: `${BASE_URL}/api/agent`,
      limit: 1,
    }),
  });
  const data = await res.json();
  console.log("   Aggregate Score:", data.aggregateScore, "/", data.maxPossibleScore);
  console.log("   Deals evaluated:", data.dealResults?.length);
  if (data.dealResults?.[0]) {
    console.log("   First deal:", data.dealResults[0].dealId);
    console.log("   Deal score:", data.dealResults[0].dealScore);
  }
  return res.ok && data.aggregateScore !== undefined;
}

async function main() {
  console.log("🧪 Testing Sales Agent Benchmark API");
  console.log("   Base URL:", BASE_URL);

  const results: [string, boolean][] = [];

  // Run tests
  results.push(["Hello", await testHello()]);
  results.push(["Deals", await testDeals()]);
  results.push(["Agent", await testAgent()]);
  results.push(["Register", await testRegister()]);
  results.push(["Benchmark", await testBenchmarkRun()]);

  // Summary
  console.log("\n" + "=".repeat(50));
  console.log("Results:");
  for (const [name, passed] of results) {
    console.log(`  ${passed ? "✅" : "❌"} ${name}`);
  }

  const allPassed = results.every(([, passed]) => passed);
  console.log("\n" + (allPassed ? "✅ All tests passed!" : "❌ Some tests failed"));

  process.exit(allPassed ? 0 : 1);
}

main().catch((e) => {
  console.error("Test error:", e);
  process.exit(1);
});
