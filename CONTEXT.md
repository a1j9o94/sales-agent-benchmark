# Project Context for Next Agent

This file contains the current state and pending tasks for the Sales Agent Benchmark project.

## Current State (Feb 7, 2026)

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

### Pending Benchmarks (7 models)

Claude Opus 4.6 has been added to BENCHMARK_MODELS. Run with:
```bash
bun scripts/benchmark-models.ts --parallel=4 --models=claude-4.6-opus,grok-4.1-fast,kimi-k2.5,deepseek-v3.2,qwen3-coder-480b,claude-4.5-haiku,gemini-2.5-flash-lite
```

Note: Some models had timeout issues in previous runs. You may want to:
- Run them individually with longer timeouts
- Or accept that some may fail and proceed with the ones that work

---

## Recently Completed Features (Feb 7, 2026)

### TASK A: Live Benchmark Progress & Results Viewer - DONE

**Files created:**
- `api/benchmark-stream.ts` - SSE endpoint for streaming benchmark progress
- `api/agent-results.ts` - GET endpoint for detailed results
- `src/components/BenchmarkProgressPage.tsx` - Live progress UI
- `src/components/ResultsPage.tsx` - Detailed results view

**Files modified:**
- `src/components/AgentRegistration.tsx` - Redirects to progress page after registration
- `src/components/Leaderboard.tsx` - "View Full Results" link in selected entry panel
- `src/App.tsx` - Routes for /run/* and /results/*
- `src/index.ts` - API routes for stream, results, reference-agent

### TASK B: Hosted Reference Agent Implementations - DONE

**Files created:**
- `api/reference-agent.ts` - Wraps any OpenRouter model as benchmark API contract
- `examples/python-flask/app.py` - Example Python implementation
- `examples/typescript-bun/index.ts` - Example Bun implementation
- `examples/node-express/index.js` - Example Node.js implementation

### Claude Opus 4.6 Added to Benchmark

Added to `scripts/benchmark-models.ts` as `claude-4.6-opus` with OpenRouter ID `anthropic/claude-opus-4-6` in the frontier tier.

---

## Key Code Locations

- **Main server**: `src/index.ts`
- **React app**: `src/App.tsx`
- **Components**: `src/components/`
- **Benchmark logic**: `scripts/benchmark-models.ts`
- **Evaluation**: `api/evaluate-response.ts`
- **Database queries**: `api/results.ts`
- **SSE streaming**: `api/benchmark-stream.ts`
- **Reference agent**: `api/reference-agent.ts`
- **Agent results**: `api/agent-results.ts`
- **Examples**: `examples/`
- **Deal/checkpoint data**: `data/` directory

## Environment

- Uses Bun (not Node.js)
- Database: Neon Postgres via `@vercel/postgres`
- Deploys to Fly.io with `fly deploy`
- OpenRouter API for model access
