# Project Context for Next Agent

This file contains the current state and pending tasks for the Sales Agent Benchmark project.

## Current State (Feb 8, 2026)

### What This Project Is

A benchmark for evaluating AI models as sales agents. Currently uses 15 anonymized deals (5 public, 10 private) with LLM-generated checkpoint snapshots. Models are scored on their ability to analyze deal context and recommend next actions.

### What's Been Built (v1 - complete)

- Web UI with leaderboard, live benchmark streaming, results viewer
- Multi-judge evaluation system (4 judges per checkpoint)
- Reference agent wrapper (any OpenRouter model can be benchmarked)
- 15 deals with 36 total checkpoints, all using codename identifiers
- Database with benchmark results for 6+ models

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

---

## Next Phase: Real-World Evaluation Dataset (v2)

The current benchmark uses LLM-extracted checkpoint summaries from a single user's deals. The next step is building a larger, more rigorous evaluation using **real deal artifacts** - call transcripts, email threads, CRM logs, meeting notes, etc.

### Why

- Current checkpoints are LLM-summarized, losing nuance and signal
- Real transcripts test whether models can extract insight from messy, unstructured data
- Multi-source context (calls + emails + CRM) tests information synthesis
- Larger dataset = more statistically meaningful model comparisons

### Strategy

- **Open-source public benchmark** - "MMLU for sales." Public leaderboard, open dataset, community adoption
- **Private evaluation tier** - Paid service for companies implementing sales agents. Uses held-out private problems to avoid contamination. This is the business
- **Build with own data first** - Use Adrian's deals from sales-workspace as the v2 foundation (same approach as v1). Working examples make it easy to recruit data partners later
- **Data partners come last** - Once the pipeline exists and produces compelling output, use that to pitch Gong, Chorus, sales orgs, etc. to contribute data

### Key Tasks (in order)

1. **Design the v2 evaluation schema**
   - What does a v2 checkpoint look like with real artifacts?
   - Raw inputs: call transcripts, email threads, CRM snapshots, meeting notes
   - Ground truth: what actually happened next, which risks materialized
   - Multi-turn evaluation: test agent's ability to ask clarifying questions
   - Expanded dimensions: risk identification, stakeholder mapping, deal qualification, objection handling

2. **Build the data pipeline** - Using Adrian's deals as source
   - Ingest real artifacts from sales-workspace (call recordings/transcripts, emails, HubSpot data)
   - Anonymization across all artifact types (names, companies, amounts, dates)
   - Cross-referencing between artifacts (same deal, same stakeholders)
   - Quality bar: each checkpoint should have enough context for a human seller to form an opinion

3. **Expand the evaluation system**
   - Current: single-turn next-action recommendation, 4-judge scoring
   - Add: multi-turn dialogue (agent asks questions before recommending)
   - Add: time-series evaluation (same deal at multiple points)
   - Add: artifact-specific tasks (summarize this call, draft this follow-up email)

4. **Legal / licensing framework**
   - Open-source license for public benchmark
   - Data contribution agreement template for partners
   - GDPR / privacy framework for real conversation data
   - Clear separation: public problems (open) vs. private problems (held-out)

5. **Recruit data partners** (after pipeline is proven)
   - Revenue intelligence platforms (Gong, Chorus, Clari)
   - CRM providers with research programs
   - Sales training organizations with recorded call libraries
   - Academic datasets (if any exist for B2B sales)
   - Target: 50+ deals, 200+ checkpoints from diverse sources

---

## Recently Completed (Feb 8, 2026)

### Codename Migration
- All 15 checkpoint files renamed from real company names to codenames
- All IDs updated (deal IDs, checkpoint IDs, display names)
- DB migrated: 882 rows in judge_evaluations updated
- Fixed bugs: "Summit Learning-prep-academy" -> "Summit Learning", "Eastpoint-group" -> "Eastpoint Capital"
- Code updated: ResultsPage.tsx, run-benchmark.ts, extract_checkpoints.ts

### Previous Features (Feb 7, 2026)

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
