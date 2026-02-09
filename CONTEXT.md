# Project Context for Next Agent

This file contains the current state and pending tasks for the Sales Agent Benchmark project.

## Current State (Feb 9, 2026)

### What This Project Is

A benchmark for evaluating AI models as sales agents. Two evaluation modes:
- **Summary benchmark**: Uses LLM-generated checkpoint summaries from 15 anonymized deals (5 public, 10 private). Models scored on next-action recommendations.
- **Artifact-based benchmark**: Uses real deal artifacts (call transcripts, email threads, CRM snapshots, documents). Models scored on 8 dimensions including stakeholder mapping, deal qualification, and information synthesis.

### Architecture

- **Summary benchmark** (original): Single-turn evaluation, 4 scoring dimensions, 15 deals / 36 checkpoints
- **Artifact-based benchmark**: Multi-turn evaluation, 8 scoring dimensions, 14 deals / 65 checkpoints / 148 tasks
- Unified leaderboard with tab toggle between Summary and Artifact-Based views
- API routes: `/api/` for summary, `/api/artifact/` for artifact-based

### Database Schema

Unified tables:
- `benchmark_runs` — stores both summary and artifact-based runs
- `agents` — agent registry
- `judge_evaluations` — per-judge scores
- `dimension_scores` — 4 summary dimensions + 4 nullable artifact dimensions (stakeholder_mapping, deal_qualification, information_synthesis, communication_quality)
- `task_evaluations` — artifact-based task-level evaluations

### Benchmark Results

**Summary benchmark (6+ agents):**
| Agent | Score | % |
|-------|-------|---|
| GPT-5.2 | 1136/1440 | 79% |
| Claude 4.5 Opus | 1114/1440 | 77% |
| Claude 4.5 Sonnet | 1101/1440 | 76% |
| Gemini 3 Pro Preview | 1069/1440 | 74% |
| Gemini 3 Flash Preview | 1063/1440 | 74% |
| Devstral 2512 | 977/1440 | 68% |

**Artifact-based benchmark (13 agents, top 5):**
| Agent | Score | % |
|-------|-------|---|
| Claude Opus 4.6 | — | 38% |
| GPT-5.2 | — | 37% |
| Claude 4.5 Opus | — | 35% |
| Kimi K2.5 | — | 35% |
| Grok 4.1 Fast | — | 34% |

---

## Roadmap

### Completed
- Summary benchmark with leaderboard, streaming, multi-judge evaluation
- Artifact-based benchmark pipeline: 14 deals processed from real artifacts
- Unified leaderboard with Summary + Artifact-Based tabs
- Codename migration (real company names → codenames)
- V2 → Artifact-Based terminology refactor (all "v2" references removed)

### Next Steps

1. **Recruit data partners** — More diverse deals from Gong, Chorus, sales orgs
2. **Legal / licensing** — Open-source license, data contribution agreements, GDPR framework
3. **External data ingestion** — HubSpot, Gmail, Slack, Calendar via Zapier MCP
4. **Public launch** — Open-source benchmark ("MMLU for sales") with private held-out problems

---

## Key Code Locations

- **Main server**: `src/index.ts`
- **React app**: `src/App.tsx`
- **Components**: `src/components/` (summary in root, artifact-based in `artifact/`)
- **Unified leaderboard**: `src/components/UnifiedBenchmarkPage.tsx`
- **Summary benchmark script**: `scripts/benchmark-models.ts`
- **Artifact-based benchmark script**: `scripts/benchmark-models-artifact.ts`
- **Artifact pipeline**: `scripts/artifact-pipeline/`
- **Summary evaluation**: `api/evaluate-response.ts`
- **Artifact-based evaluation**: `api/evaluate-response-artifact.ts`
- **Artifact task evaluators**: `api/evaluate-tasks/`
- **Artifact-based streaming**: `api/benchmark-stream-artifact.ts`
- **Database queries**: `api/results.ts`
- **Summary SSE streaming**: `api/benchmark-stream.ts`
- **Reference agent**: `api/reference-agent.ts`
- **Type definitions**: `src/types/benchmark.ts` (summary), `src/types/benchmark-artifact.ts` (artifact-based)
- **Deal data**: `data/checkpoints/` (summary), `data/artifact/checkpoints/` (artifact-based)
- **DB migration**: `scripts/migrate-v2-to-artifact.ts`
- **Examples**: `examples/`

## Environment

- Uses Bun (not Node.js)
- Database: Neon Postgres via `@vercel/postgres`
- Deploys to Fly.io with `fly deploy`
- OpenRouter API for model access
