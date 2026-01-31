# Project Context for Next Agent

This file contains the current state and pending tasks for the Sales Agent Benchmark project.

## Current State (Jan 31, 2026)

### Database Status

**Completed Benchmarks (6 agents saved):**
| Agent | Score | % | Run ID |
|-------|-------|---|--------|
| GPT-5.2 | 1136/1440 | 79% | 6 |
| Claude 4.5 Opus | 1114/1440 | 77% | 3 |
| Claude 4.5 Sonnet | 1101/1440 | 76% | 5 |
| Gemini 3 Pro Preview | 1069/1440 | 74% | 4 |
| Gemini 3 Flash Preview | 1063/1440 | 74% | 7 |
| Devstral 2512 | 977/1440 | 68% | 8 |

### Pending Benchmarks (6 models)

These models need to be benchmarked. Run with:
```bash
bun scripts/benchmark-models.ts --parallel=4 --models=grok-4.1-fast,kimi-k2.5,deepseek-v3.2,qwen3-coder-480b,claude-4.5-haiku,gemini-2.5-flash-lite
```

Note: These models had timeout issues in previous runs. You may want to:
- Run them individually with longer timeouts
- Or accept that some may fail and proceed with the ones that work

---

## Pending Implementation Plan

Two independent workstreams to implement:

### TASK A: Live Benchmark Progress & Results Viewer

When a user registers their agent, auto-run the full benchmark and show live progress with results streaming in.

**Files to create:**
1. `api/benchmark-stream.ts` - SSE endpoint for streaming benchmark progress
2. `api/agent-results.ts` - GET endpoint for detailed results
3. `src/components/BenchmarkProgressPage.tsx` - Live progress UI
4. `src/components/ResultsPage.tsx` - Detailed results view

**Files to modify:**
- `src/components/AgentRegistration.tsx` - Redirect to progress page after registration
- `src/components/Leaderboard.tsx` - Add "View Full Results" link
- `src/App.tsx` - Add routes for /run/:runId and /results/:agentId
- `src/index.ts` - Add API routes

**API Specs:**

`POST /api/benchmark/stream` - SSE stream:
```typescript
// Request
{ "endpoint": "https://my-agent.example.com/api", "agentName": "My Agent" }

// SSE Events
data: { "type": "checkpoint", "checkpointId": "moxie_cp_001", "score": 32, "maxScore": 40, "feedback": "..." | null, "progress": { "completed": 5, "total": 36 } }
data: { "type": "complete", "runId": 123, "finalScore": 1114, "maxScore": 1440 }
```

`GET /api/agent-results/:agentId` - Returns detailed results with judge evaluations (public checkpoints only show feedback).

### TASK B: Hosted Reference Agent Implementations

Host reference agent endpoints that wrap OpenRouter.

**Files to create:**
1. `api/reference-agent.ts` - Wraps OpenRouter models as our API contract
2. `examples/python-flask/app.py` - Example Python implementation
3. `examples/typescript-bun/index.ts` - Example Bun implementation
4. `examples/node-express/index.js` - Example Node.js implementation

**Files to modify:**
- `src/index.ts` - Add route for /api/reference-agent/:modelId
- `src/App.tsx` - Update DocsPage with reference endpoints and examples

**Reference Agent Endpoint:**
```typescript
POST /api/reference-agent/gpt-5.2
POST /api/reference-agent/claude-4.5-sonnet
POST /api/reference-agent/gemini-3-pro

// Uses same request/response format as user agents
```

---

## Key Code Locations

- **Main server**: `src/index.ts`
- **React app**: `src/App.tsx`
- **Components**: `src/components/`
- **Benchmark logic**: `scripts/benchmark-models.ts`
- **Evaluation**: `src/evaluation.ts`
- **Database queries**: `src/db.ts`
- **Deal/checkpoint data**: `data/` directory

## Environment

- Uses Bun (not Node.js)
- Database: Neon Postgres via `@vercel/postgres`
- Deploys to Fly.io with `fly deploy`
- OpenRouter API for model access

## Verification Steps

After implementing:

**Task A:**
1. Register agent → auto-redirects to `/run/new?endpoint=...`
2. Progress page shows checkpoints completing via SSE
3. Public checkpoints show feedback, private show score only
4. "View Full Results" link works from leaderboard

**Task B:**
1. `curl -X POST .../api/reference-agent/gpt-5.2 -d '{...}'` returns valid response
2. Can run benchmark against reference agent via UI
3. Example code in `examples/` is runnable
