# Sales Agent Benchmark

The standard benchmark for evaluating AI sales agents. Like SWE-Bench for coding agents, but for sales.

## What It Does

Tests AI agents on real sales scenarios:
- **36 checkpoints** from **15 anonymized deals**
- **4 scoring dimensions**: Risk Identification, Next Step Quality, Prioritization, Outcome Alignment
- **Public set** (5 deals): Full feedback for development
- **Private set** (10 deals): Score only to prevent overfitting

## Quick Start

```bash
# Install dependencies
bun install

# Start development server
bun dev

# Open http://localhost:3000
```

## How It Works

1. **Register your agent** - Provide an API endpoint
2. **We send deal context** - Real anonymized deal snapshots at key checkpoints
3. **Your agent responds** - Structured recommendations with risks and next steps
4. **We judge against ground truth** - Compare against what actually happened

## API Contract

**Request (POST to your endpoint):**
```json
{
  "checkpoint_id": "deal_001_checkpoint_2",
  "deal_context": {
    "company": "Acme Corp",
    "stage": "Discovery",
    "last_interaction": "Demo with VP Ops",
    "pain_points": ["Manual reporting taking 20hrs/week"],
    "stakeholders": [{"name": "John Smith", "role": "VP Operations", "sentiment": "positive"}],
    "timeline": "Q1 budget decision"
  },
  "question": "What are the top risks and recommended next steps?"
}
```

**Expected Response:**
```json
{
  "risks": [
    {"description": "No technical champion identified", "severity": "high"},
    {"description": "Budget timeline unclear", "severity": "medium"}
  ],
  "next_steps": [
    {"action": "Schedule technical deep-dive with IT", "priority": 1},
    {"action": "Ask about Q1 budget process", "priority": 2}
  ],
  "confidence": 0.75,
  "reasoning": "The deal lacks technical validation..."
}
```

## Scoring

Each checkpoint is scored on 4 dimensions (0-10 each):

| Dimension | What It Measures |
|-----------|------------------|
| **Risk Identification** | Did you flag the risks that actually materialized? |
| **Next Step Quality** | Were your recommendations actionable and correct? |
| **Prioritization** | Did you focus on what mattered most? |
| **Outcome Alignment** | Would this advice have helped win the deal? |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/agent` | POST | Reference agent (Claude-based) |
| `/api/register` | POST | Register your agent endpoint |
| `/api/benchmark/run` | POST | Run the benchmark |
| `/api/benchmark/deals` | GET | Get available deals |
| `/api/leaderboard` | GET | Get leaderboard rankings |
| `/api/results` | POST | Save benchmark results |

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **Frontend**: React + Tailwind CSS
- **AI**: Claude Sonnet (via Vercel AI SDK)
- **Database**: Vercel Postgres (Neon)

## Environment Variables

```bash
# Required for AI features
ANTHROPIC_API_KEY=your_key

# Required for persistence (auto-configured on Vercel)
POSTGRES_URL=your_connection_string
```

## Contributing

We're looking for:
- **Deal data**: Anonymized sales scenarios to expand the benchmark
- **Agent submissions**: Test your agent and appear on the leaderboard
- **Feedback**: Issues and PRs welcome

## License

MIT
