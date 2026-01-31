# Sales Agent Benchmark v2: Real-World Deal Intelligence

## Executive Summary

v1 benchmarks models against synthetic deal scenarios with expert-crafted ground truth. v2 shifts to **real sales data** - actual call transcripts, email threads, and CRM records - tied to **verified outcomes** (won/lost/stalled). This creates a dataset that:

1. Tests models on messy, real-world complexity
2. Enables fine-tuning for sales-specific tasks
3. Provides ground truth from actual outcomes, not expert opinion

---

## Why v2?

### Limitations of v1 (Synthetic Scenarios)

| Aspect | v1 Synthetic | v2 Real Data |
|--------|--------------|--------------|
| Ground truth | Expert-crafted "ideal" responses | Actual deal outcomes |
| Complexity | Curated, consistent formatting | Messy, incomplete, contradictory |
| Volume | 36 checkpoints | 10,000+ deal snapshots |
| Signal | "Would an expert agree?" | "Did this approach work?" |
| Training value | Evaluation only | Evaluation + fine-tuning |

### The Core Insight

In v1, we ask: *"Does the model identify risks an expert would identify?"*

In v2, we ask: *"Does the model identify patterns that correlate with deals actually closing?"*

This is a fundamentally different (and more valuable) question.

---

## Data Architecture

### Source Systems

```
┌─────────────────────────────────────────────────────────────────┐
│                        DATA SOURCES                              │
├─────────────────┬─────────────────┬─────────────────────────────┤
│   Call Recordings│   Email/Calendar │      CRM Records           │
│   (Gong, Chorus) │   (Gmail, O365)  │   (Salesforce, HubSpot)    │
├─────────────────┼─────────────────┼─────────────────────────────┤
│ • Transcripts    │ • Thread history │ • Stage transitions        │
│ • Speaker labels │ • Attachments    │ • Close dates (actual)     │
│ • Talk ratios    │ • Response times │ • Deal amounts             │
│ • Sentiment      │ • CC/BCC patterns│ • Win/loss reasons         │
│ • Key moments    │ • Meeting invites│ • Competitor mentions      │
└─────────────────┴─────────────────┴─────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     UNIFIED DEAL GRAPH                           │
│                                                                  │
│  Deal ─────┬───── Stakeholders (extracted from comms)           │
│            ├───── Timeline Events (calls, emails, meetings)     │
│            ├───── Sentiment Trajectory (per stakeholder)        │
│            ├───── Competitive Mentions                          │
│            └───── OUTCOME (won/lost/stalled + days to close)    │
└─────────────────────────────────────────────────────────────────┘
```

### Deal Snapshot Schema

Each "checkpoint" in v2 is a **point-in-time snapshot** of a real deal:

```typescript
interface DealSnapshot {
  // Identity
  id: string;
  anonymizedCompany: string;  // "TechCorp-7A3F"
  industry: string;
  dealSize: "smb" | "mid-market" | "enterprise";

  // Point-in-time context
  snapshotDate: Date;
  currentStage: string;
  daysInPipeline: number;

  // Communications (up to snapshot date)
  calls: CallTranscript[];
  emails: EmailThread[];
  meetings: MeetingRecord[];

  // Extracted intelligence
  stakeholders: ExtractedStakeholder[];
  sentimentTrajectory: SentimentPoint[];
  competitorMentions: CompetitorMention[];
  objections: ExtractedObjection[];
  commitments: ExtractedCommitment[];  // "I'll get back to you Monday"

  // GROUND TRUTH (hidden from model during eval)
  outcome: {
    result: "won" | "lost" | "stalled";
    daysToOutcome: number;
    lossReason?: string;  // From CRM
    winFactors?: string[];
  };
}

interface CallTranscript {
  date: Date;
  duration: number;
  participants: Participant[];
  transcript: TranscriptSegment[];

  // Derived metrics
  talkRatio: Record<string, number>;  // participant -> % of talk time
  questionCount: Record<string, number>;
  sentimentBySegment: number[];
}

interface EmailThread {
  subject: string;
  messages: Email[];

  // Derived
  avgResponseTime: number;
  initiator: "rep" | "prospect";
  sentiment: number;
}
```

---

## Evaluation Framework

### Task Types

#### 1. Outcome Prediction
Given deal state at snapshot, predict outcome.

```typescript
interface OutcomePredictionTask {
  type: "outcome_prediction";
  snapshot: DealSnapshot;  // outcome hidden

  expectedOutput: {
    prediction: "win" | "lose" | "stall";
    confidence: number;
    reasoning: string;
    keyFactors: string[];
  };

  scoring: {
    // Primary: did you predict correctly?
    accuracyWeight: 0.5;
    // Secondary: was confidence calibrated?
    calibrationWeight: 0.3;
    // Tertiary: were reasons valid?
    reasoningWeight: 0.2;
  };
}
```

#### 2. Risk Identification (v1 evolution)
Identify risks that **actually materialized** in lost deals.

```typescript
interface RiskIdentificationTask {
  type: "risk_identification";
  snapshot: DealSnapshot;  // from a LOST deal

  groundTruth: {
    // Extracted from loss reason + post-mortem
    actualRisks: string[];
    visibleInData: boolean[];  // Was this detectable?
  };

  scoring: {
    // Did you identify risks that were actually present?
    recall: number;
    // Did you avoid false alarms?
    precision: number;
  };
}
```

#### 3. Next Best Action
Recommend actions; score based on what **actually worked** in similar deals.

```typescript
interface NextActionTask {
  type: "next_action";
  snapshot: DealSnapshot;

  groundTruth: {
    // What the rep actually did
    actionTaken: string;
    // What happened after
    outcomeAfterAction: "progressed" | "stalled" | "regressed";
    // Actions from similar won deals
    actionsInSimilarWins: string[];
  };
}
```

#### 4. Stakeholder Mapping
Extract stakeholders from transcripts; validate against CRM + outcome.

```typescript
interface StakeholderTask {
  type: "stakeholder_extraction";
  calls: CallTranscript[];
  emails: EmailThread[];

  groundTruth: {
    // From CRM contact roles
    actualStakeholders: Stakeholder[];
    // Who was the actual decision maker? (from win/loss analysis)
    actualDecisionMaker: string;
    // Who blocked the deal? (from loss reasons)
    blocker?: string;
  };
}
```

#### 5. Commitment Tracking
Extract commitments from calls; check if they were kept.

```typescript
interface CommitmentTask {
  type: "commitment_tracking";
  transcript: CallTranscript;

  groundTruth: {
    commitments: {
      statement: string;
      speaker: string;
      fulfilled: boolean;  // From subsequent data
      fulfillmentDate?: Date;
    }[];
  };
}
```

---

## Data Collection Pipeline

### Phase 1: Partnership & Access (Months 1-2)

**Option A: Direct Partnerships**
- Partner with 3-5 companies willing to share anonymized data
- Requires: NDA, data processing agreement, IRB-style review
- Benefit: High quality, full context
- Challenge: Legal complexity, small N

**Option B: Sales Tool Integrations**
- Build integrations with Gong, Chorus, Salesloft, Outreach
- User-authorized data export for benchmark contribution
- Benefit: Scalable, user-controlled
- Challenge: Integration engineering, incentive design

**Option C: Synthetic-Real Hybrid**
- Use real structure/patterns, synthetic content
- Train generative model on real data, generate benchmark scenarios
- Benefit: Privacy-safe, unlimited scale
- Challenge: May not capture real-world messiness

**Recommendation:** Start with Option A (2-3 design partners), build toward Option B.

### Phase 2: Data Processing (Months 2-4)

```
Raw Data → Anonymization → Extraction → Validation → Benchmark
```

#### Anonymization Pipeline

```typescript
interface AnonymizationConfig {
  // Entity replacement
  companyNames: "hash";      // TechCorp → TC-7A3F
  personNames: "role-based"; // "John" → "Champion-1"
  emails: "domain-swap";     // @techcorp.com → @company-7a3f.test

  // Content sanitization
  removePII: true;
  removeProductNames: "genericize";  // "Salesforce" → "[CRM Platform]"
  removePricing: "bucket";   // $847,000 → "$500K-$1M range"

  // Temporal fuzzing
  dateShift: "random-30-days";
  preserveSequence: true;    // Maintain relative ordering
}
```

#### Extraction Pipeline

```typescript
// Run extraction models to structure raw transcripts
const extractionTasks = [
  "stakeholder_identification",
  "sentiment_per_speaker",
  "objection_detection",
  "commitment_extraction",
  "competition_mentions",
  "next_step_agreements",
  "pain_point_mentions",
  "decision_process_signals",
];

// Human validation on 10% sample
const validationQueue = extractedData.sample(0.1);
await humanReview(validationQueue);
```

### Phase 3: Ground Truth Labeling (Months 3-5)

**Outcome labels** come directly from CRM:
- Won/Lost/Stalled (primary)
- Days to close
- Win/loss reason (when available)

**Quality labels** require human review:
- Was this a "good" sales process? (regardless of outcome)
- What were the actual key factors?
- What should the rep have done differently?

**Labeling workforce:**
- Sales managers (domain expertise)
- Sales ops (data familiarity)
- External annotators (scale)

---

## Benchmark Harness v2

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      BENCHMARK HARNESS v2                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │   Context   │    │    Model    │    │  Evaluator  │         │
│  │  Assembler  │───▶│   Runner    │───▶│   Suite     │         │
│  └─────────────┘    └─────────────┘    └─────────────┘         │
│         │                  │                  │                  │
│         ▼                  ▼                  ▼                  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │ Deal Graph  │    │   Prompt    │    │   Metrics   │         │
│  │   Store     │    │  Templates  │    │   Store     │         │
│  └─────────────┘    └─────────────┘    └─────────────┘         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Context Assembly

Key difference from v1: Models receive **raw-ish data**, not pre-digested summaries.

```typescript
interface ContextAssemblyConfig {
  // How much history to include
  lookbackDays: number;
  maxCalls: number;
  maxEmails: number;

  // What format
  transcriptFormat: "full" | "summary" | "key-moments";
  emailFormat: "full" | "summary";

  // What to include
  includeMetrics: boolean;  // talk ratios, response times
  includeSentiment: boolean;  // pre-computed sentiment
  includeCRM: boolean;  // stage, amount, close date
}

// Example: "Full context" mode
const fullContext: ContextAssemblyConfig = {
  lookbackDays: 90,
  maxCalls: 10,
  maxEmails: 50,
  transcriptFormat: "full",
  emailFormat: "full",
  includeMetrics: false,  // Let model compute
  includeSentiment: false,
  includeCRM: true,
};

// Example: "Summarized" mode (tests reasoning over compression)
const summarizedContext: ContextAssemblyConfig = {
  lookbackDays: 90,
  maxCalls: 10,
  maxEmails: 50,
  transcriptFormat: "summary",
  emailFormat: "summary",
  includeMetrics: true,
  includeSentiment: true,
  includeCRM: true,
};
```

### Evaluation Metrics

```typescript
interface V2Metrics {
  // Outcome prediction
  outcomeAccuracy: number;        // % correct predictions
  outcomeAUC: number;             // Area under ROC
  calibration: number;            // Confidence vs. accuracy

  // Risk identification
  riskRecall: number;             // % of actual risks identified
  riskPrecision: number;          // % of identified risks that were real
  riskF1: number;

  // Action recommendation
  actionRelevance: number;        // Rated by human reviewers
  actionNovelty: number;          // Not just "follow up"
  actionSpecificity: number;      // Concrete vs. generic

  // Extraction accuracy
  stakeholderF1: number;
  commitmentF1: number;
  objectionF1: number;

  // Calibration
  confidenceCalibration: number;  // Are 80% confidence predictions right 80%?

  // Business value proxy
  simulatedWinRate: number;       // If we followed model's advice
}
```

---

## Training Data Generation

### For Fine-Tuning

v2 dataset can generate training data for:

#### 1. Outcome Prediction Model
```typescript
// Input: deal snapshot
// Output: {prediction, confidence, reasoning}
// Label: actual outcome

const trainingExample = {
  input: formatDealContext(snapshot),
  output: {
    prediction: snapshot.outcome.result,
    confidence: computeIdealConfidence(snapshot),
    reasoning: snapshot.outcome.lossReason || "Deal closed successfully",
  },
};
```

#### 2. Risk Extraction Model
```typescript
// Input: call transcript
// Output: identified risks
// Label: risks that materialized (from lost deals)

const trainingExample = {
  input: transcript,
  output: extractVisibleRisks(deal.outcome),
};
```

#### 3. Action Recommendation Model
```typescript
// Input: deal snapshot
// Output: recommended actions
// Label: actions taken in similar WINNING deals

const trainingExample = {
  input: formatDealContext(snapshot),
  output: findActionsInSimilarWins(snapshot),
};
```

### Dataset Splits

```
Total Deals: 10,000+
├── Training: 7,000 (70%)
│   └── Fine-tuning, pattern learning
├── Validation: 1,500 (15%)
│   └── Hyperparameter tuning, early stopping
└── Test: 1,500 (15%)
    └── Final benchmark evaluation
    └── HELD OUT - never used for training
```

---

## Privacy & Compliance

### Data Handling

| Data Type | Handling | Retention |
|-----------|----------|-----------|
| Raw transcripts | Process → anonymize → delete raw | 30 days max |
| Anonymized snapshots | Encrypted at rest | Indefinite |
| PII mappings | Never stored | N/A |
| Model outputs | Logged for eval | 1 year |

### Compliance Checklist

- [ ] GDPR Article 6 basis (legitimate interest or consent)
- [ ] CCPA disclosure in privacy policy
- [ ] Data processing agreements with partners
- [ ] SOC 2 Type II for infrastructure
- [ ] Annual third-party audit

### Anonymization Validation

Before any data enters the benchmark:

```typescript
async function validateAnonymization(snapshot: DealSnapshot): Promise<boolean> {
  const checks = [
    // No real company names
    !containsKnownCompanies(snapshot),
    // No real person names
    !containsKnownNames(snapshot),
    // No email addresses
    !containsEmailPattern(snapshot),
    // No phone numbers
    !containsPhonePattern(snapshot),
    // No addresses
    !containsAddressPattern(snapshot),
    // Manual spot check passed
    snapshot.humanReviewed === true,
  ];

  return checks.every(Boolean);
}
```

---

## Roadmap

### Phase 1: Foundation (Q1)
- [ ] Design partner agreements (2-3 companies)
- [ ] Data pipeline architecture
- [ ] Anonymization pipeline v1
- [ ] Basic extraction models

### Phase 2: Data Collection (Q2)
- [ ] Ingest first partner data
- [ ] Human labeling workflow
- [ ] Quality validation
- [ ] 1,000 deal snapshots

### Phase 3: Benchmark v2.0 (Q3)
- [ ] Harness implementation
- [ ] Outcome prediction task
- [ ] Risk identification task
- [ ] Initial model evaluations
- [ ] 5,000 deal snapshots

### Phase 4: Scale & Train (Q4)
- [ ] 10,000+ deal snapshots
- [ ] All task types implemented
- [ ] Fine-tuning experiments
- [ ] Public benchmark launch

---

## Success Metrics

| Metric | Target | Why It Matters |
|--------|--------|----------------|
| Deal snapshots | 10,000+ | Statistical significance |
| Outcome accuracy (best model) | >75% | Proves signal exists |
| Industry coverage | 5+ verticals | Generalization |
| Partner retention | >80% | Sustainable data flow |
| Fine-tuned model lift | +10% accuracy | Training value proven |

---

## Open Questions

1. **Incentive design**: How do we get companies to contribute data? Credits? Early access? Revenue share?

2. **Temporal dynamics**: How do we handle deals that span 6+ months? Rolling snapshots? Key moments only?

3. **Multi-threaded deals**: Enterprise deals have parallel workstreams. How do we represent this?

4. **Competitive sensitivity**: Companies may not want to reveal their sales playbook. How do we handle?

5. **Outcome attribution**: If a deal was lost, was it the sales process or the product? How do we separate?

---

## Next Steps

1. **Validate interest**: Talk to 5 potential data partners
2. **Legal review**: Draft data sharing agreement template
3. **Technical spike**: Build anonymization pipeline prototype with synthetic data
4. **Extraction models**: Evaluate existing NER/extraction models on sales transcripts
5. **Funding**: Estimate costs, identify funding sources (grants? enterprise sponsors?)

---

*Draft v0.1 - January 2026*
