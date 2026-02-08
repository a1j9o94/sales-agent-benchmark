/**
 * Parse context.md files from deal directories into CrmSnapshotArtifact objects.
 *
 * Reuses parsing patterns from scripts/extract_checkpoints.ts but outputs v2 types.
 * Anonymization is NOT applied here — that is a separate transform step.
 */

import type {
  CrmSnapshotArtifact,
  CrmActivityEntry,
  MeddpiccState,
  MeddpiccElement,
  V2Stakeholder,
} from "../../../src/types/benchmark-v2";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface ParsedContext {
  dealProperties: CrmSnapshotArtifact["dealProperties"];
  contacts: CrmSnapshotArtifact["contacts"];
  notes: string[];
  activityLog: CrmActivityEntry[];
  meddpicc?: MeddpiccState;
  stakeholders?: V2Stakeholder[];
  hypothesis?: {
    whyTheyWillBuy: string[];
    whyTheyMightNot: string[];
    whatNeedsToBeTrue: string[];
  };
  painPoints: string[];
  rawContent: string;
}

// ---------------------------------------------------------------------------
// Section extraction helpers
// ---------------------------------------------------------------------------

/** Extract text between a ## heading and the next ## heading (or EOF). */
function extractSection(content: string, heading: string): string | null {
  const regex = new RegExp(
    `## ${heading}\\n\\n([\\s\\S]*?)(?=\\n## |$)`,
  );
  const match = content.match(regex);
  return match?.[1] ? match[1].trim() : null;
}

// ---------------------------------------------------------------------------
// Deal properties (top-of-file metadata)
// ---------------------------------------------------------------------------

function extractDealProperties(content: string): ParsedContext["dealProperties"] {
  const props: ParsedContext["dealProperties"] = { stage: "Unknown" };

  const stageMatch = content.match(/\*\*Stage\*\*:\s*(.+?)(?:\n|$)/);
  if (stageMatch?.[1]) props.stage = stageMatch[1].trim();

  const amountMatch = content.match(
    /\*\*(?:Amount|Current ARR|Potential Amount)\*\*:\s*(.+?)(?:\n|$)/,
  );
  if (amountMatch?.[1]) props.amount = amountMatch[1].trim();

  const closeMatch = content.match(/\*\*Close Date\*\*:\s*(.+?)(?:\n|$)/);
  if (closeMatch?.[1]) props.closeDate = closeMatch[1].trim();

  const pipelineMatch = content.match(/\*\*Pipeline\*\*:\s*(.+?)(?:\n|$)/);
  if (pipelineMatch?.[1]) props.pipeline = pipelineMatch[1].trim();

  const lastContactedMatch = content.match(
    /\*\*Last (?:Updated|Contacted)\*\*:\s*(.+?)(?:\n|$)/,
  );
  if (lastContactedMatch?.[1]) props.lastContactedDate = lastContactedMatch[1].trim();

  return props;
}

// ---------------------------------------------------------------------------
// Activity log → CrmActivityEntry[]
// ---------------------------------------------------------------------------

function parseActivityLog(content: string): CrmActivityEntry[] {
  const entries: CrmActivityEntry[] = [];
  const logSection = extractSection(content, "Activity Log");
  if (!logSection) return entries;

  const lines = logSection.split("\n");
  let currentEntry: { date: string; description: string } | null = null;

  for (const line of lines) {
    // Match date patterns like "- 2026-01-29:" or "- **2026-01-29**:" or "- **Jan 30**:"
    const dateMatch = line.match(
      /^-\s+\*?\*?(\d{4}-\d{2}-\d{2}|\w+ \d{1,2})\*?\*?:?\s*(.*)$/,
    );
    if (dateMatch) {
      if (currentEntry) entries.push(toCrmActivity(currentEntry));
      currentEntry = {
        date: dateMatch[1] ?? "",
        description: dateMatch[2] ?? "",
      };
    } else if (currentEntry && line.trim().startsWith("-")) {
      currentEntry.description += " " + line.trim().substring(1).trim();
    } else if (currentEntry && line.trim()) {
      currentEntry.description += " " + line.trim();
    }
  }

  if (currentEntry) entries.push(toCrmActivity(currentEntry));
  return entries;
}

/** Infer the activity type from the description text. */
function inferActivityType(description: string): string {
  const lower = description.toLowerCase();
  if (lower.includes("call") || lower.includes("spoke with") || lower.includes("transcript"))
    return "call";
  if (lower.includes("email") || lower.includes("sent") || lower.includes("outreach"))
    return "email";
  if (lower.includes("meeting") || lower.includes("synced") || lower.includes("coaching") || lower.includes("1:1"))
    return "meeting";
  if (lower.includes("stage") || lower.includes("pipeline") || lower.includes("upgrade"))
    return "stage_change";
  if (lower.includes("slack") || lower.includes("messaged") || lower.includes("pinged"))
    return "message";
  return "note";
}

function toCrmActivity(entry: { date: string; description: string }): CrmActivityEntry {
  return {
    date: entry.date,
    type: inferActivityType(entry.description),
    description: entry.description.trim(),
  };
}

// ---------------------------------------------------------------------------
// MEDDPICC → MeddpiccState
// ---------------------------------------------------------------------------

function parseMEDDPICC(content: string): MeddpiccState | undefined {
  const tableMatch = content.match(
    /\| Element \| Status \| Notes \|\n\|[-\s|]+\|\n([\s\S]*?)(?=\n\n|\n##)/,
  );
  if (!tableMatch) return undefined;

  const state: MeddpiccState = {};
  const rows = tableMatch[1]!.split("\n").filter((r) => r.trim());

  const emojiToStatus: Record<string, MeddpiccElement["status"]> = {
    "\u{1F7E2}": "green", // 🟢
    "\u{1F7E1}": "yellow", // 🟡
    "\u{1F534}": "red", // 🔴
  };

  for (const row of rows) {
    const cells = row
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length < 3) continue;

    const element = (cells[0] ?? "").toLowerCase();
    const rawStatus = cells[1] ?? "";
    const notes = cells[2] ?? "";

    const status: MeddpiccElement["status"] = emojiToStatus[rawStatus] || "unknown";
    const entry: MeddpiccElement = { status, notes };

    switch (element) {
      case "metrics":
        state.metrics = entry;
        break;
      case "economic buyer":
        state.economicBuyer = entry;
        break;
      case "decision criteria":
        state.decisionCriteria = entry;
        break;
      case "decision process":
        state.decisionProcess = entry;
        break;
      case "paper process":
        state.paperProcess = entry;
        break;
      case "pain":
        state.pain = entry;
        break;
      case "champion":
        state.champion = entry;
        break;
      case "competition":
        state.competition = entry;
        break;
    }
  }

  return Object.keys(state).length > 0 ? state : undefined;
}

// ---------------------------------------------------------------------------
// Stakeholder Map → V2Stakeholder[]
// ---------------------------------------------------------------------------

function parseStakeholders(content: string): V2Stakeholder[] {
  const stakeholders: V2Stakeholder[] = [];
  const mapSection = extractSection(content, "Stakeholder Map");
  if (!mapSection) return stakeholders;

  const lines = mapSection.split("\n").filter((l) => l.trim().startsWith("- **"));

  for (const line of lines) {
    // Extract name from bold markers first
    const nameMatch = line.match(/^-\s+\*\*([^*]+)\*\*\s*-\s*(.*)/);
    if (!nameMatch) continue;

    const name = nameMatch[1]!.trim();
    // Split remainder on " - " (space-dash-space) to avoid breaking on hyphens in words
    const parts = nameMatch[2]!.split(" - ").map((p) => p.trim());

    if (parts.length >= 3) {
      // 4-part format: Title - Description - Sentiment label
      const title = parts[0] ?? "";
      const description = parts.slice(1, -1).join(" - ");
      const lastPart = parts[parts.length - 1] ?? "";
      stakeholders.push({
        name,
        title,
        role: normalizeRole(lastPart) !== lastPart.toLowerCase().replace(/\s+/g, "_")
          ? normalizeRole(lastPart)
          : inferRole(title, description + " " + lastPart),
        sentiment: inferSentiment(lastPart),
        notes: description + (lastPart ? " - " + lastPart : "") || undefined,
      });
    } else if (parts.length === 2) {
      // 3-part format: Title - Notes/Description
      const title = parts[0] ?? "";
      const rest = parts[1] ?? "";
      stakeholders.push({
        name,
        title,
        role: inferRole(title, rest),
        sentiment: inferSentiment(rest),
        notes: rest || undefined,
      });
    } else {
      // Just a title
      stakeholders.push({
        name,
        title: parts[0] || undefined,
        role: inferRole(parts[0] || "", ""),
        sentiment: "unknown",
      });
    }
  }

  return stakeholders;
}

function inferSentiment(text: string): V2Stakeholder["sentiment"] {
  const lower = text.toLowerCase();
  if (
    lower.includes("positive") ||
    lower.includes("engaged") ||
    lower.includes("strong") ||
    lower.includes("champion") ||
    lower.includes("warm") ||
    lower.includes("supportive")
  )
    return "positive";
  if (
    lower.includes("negative") ||
    lower.includes("block") ||
    lower.includes("concern") ||
    lower.includes("reluctant") ||
    lower.includes("resistant")
  )
    return "negative";
  if (
    lower.includes("neutral") ||
    lower.includes("cautious") ||
    lower.includes("unknown")
  )
    return "neutral";
  // Default: if they are mentioned, assume at least neutral
  return "unknown";
}

function normalizeRole(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("economic buyer")) return "economic_buyer";
  if (lower.includes("champion")) return "champion";
  if (lower.includes("technical") || lower.includes("engineer")) return "technical_evaluator";
  if (lower.includes("blocker") || lower.includes("block")) return "blocker";
  if (lower.includes("coach") || lower.includes("internal")) return "coach";
  if (lower.includes("decision") || lower.includes("executive") || lower.includes("exec"))
    return "decision_maker";
  if (lower.includes("user") || lower.includes("ops") || lower.includes("operational"))
    return "end_user";
  if (lower.includes("influencer") || lower.includes("partner")) return "influencer";
  return raw.toLowerCase().replace(/\s+/g, "_");
}

function inferRole(title: string, notes: string): string {
  const combined = (title + " " + notes).toLowerCase();
  if (combined.includes("ceo") || combined.includes("founder") || combined.includes("executive"))
    return "decision_maker";
  if (combined.includes("champion")) return "champion";
  if (combined.includes("engineer") || combined.includes("technical")) return "technical_evaluator";
  if (combined.includes("ops") || combined.includes("operations")) return "end_user";
  if (combined.includes("solutions architect") || combined.includes("internal")) return "coach";
  if (combined.includes("partner")) return "influencer";
  return "stakeholder";
}

// ---------------------------------------------------------------------------
// Contacts — extracted from Stakeholder Map (external only)
// ---------------------------------------------------------------------------

function extractContacts(
  stakeholders: V2Stakeholder[],
): CrmSnapshotArtifact["contacts"] {
  return stakeholders.map((s) => ({
    name: s.name,
    title: s.title,
    role: s.role,
  }));
}

// ---------------------------------------------------------------------------
// Hypothesis
// ---------------------------------------------------------------------------

function parseHypothesis(content: string): ParsedContext["hypothesis"] | undefined {
  const hypothesis: NonNullable<ParsedContext["hypothesis"]> = {
    whyTheyWillBuy: [],
    whyTheyMightNot: [],
    whatNeedsToBeTrue: [],
  };

  // "Why they'll buy:" — may be wrapped in ** bold markers
  const buyMatch = content.match(
    /\*?\*?(?:Why they'?ll buy|They will buy because):?\*?\*?\n([\s\S]*?)(?=\*?\*?(?:Why they might not|They might not buy)|$)/i,
  );
  if (buyMatch?.[1]) {
    hypothesis.whyTheyWillBuy = extractBullets(buyMatch[1]);
  }

  // "Why they might not:" — may be wrapped in ** bold markers
  const notBuyMatch = content.match(
    /\*?\*?(?:Why they might not|They might not buy(?: because)?):?\*?\*?\n([\s\S]*?)(?=\*?\*?What needs to be true|$)/i,
  );
  if (notBuyMatch?.[1]) {
    hypothesis.whyTheyMightNot = extractBullets(notBuyMatch[1]);
  }

  // "What needs to be true:" — may be wrapped in ** bold markers
  const needsMatch = content.match(
    /\*?\*?What needs to be true:?\*?\*?\n([\s\S]*?)(?=\n## |$)/i,
  );
  if (needsMatch?.[1]) {
    hypothesis.whatNeedsToBeTrue = extractBullets(needsMatch[1]);
  }

  const hasContent =
    hypothesis.whyTheyWillBuy.length > 0 ||
    hypothesis.whyTheyMightNot.length > 0 ||
    hypothesis.whatNeedsToBeTrue.length > 0;

  return hasContent ? hypothesis : undefined;
}

function extractBullets(text: string): string[] {
  return text
    .split("\n")
    .filter((l) => l.trim().startsWith("-"))
    .map((l) => l.replace(/^-\s*/, "").trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Pain points
// ---------------------------------------------------------------------------

function extractPainPoints(content: string): string[] {
  const painPoints: string[] = [];

  // From MEDDPICC Pain row — use .+? for emoji (multi-byte chars)
  const painMatch = content.match(
    /\| Pain \| .+? \| ([^|]+) \|/,
  );
  if (painMatch?.[1]) {
    painPoints.push(painMatch[1].trim());
  }

  // From hypothesis "why they'll buy" (first 2 items are typically pain-adjacent)
  const hypothesis = parseHypothesis(content);
  if (hypothesis && hypothesis.whyTheyWillBuy.length > 0) {
    painPoints.push(...hypothesis.whyTheyWillBuy.slice(0, 2));
  }

  return painPoints;
}

// ---------------------------------------------------------------------------
// Notes — Current Status section content
// ---------------------------------------------------------------------------

function extractNotes(content: string): string[] {
  const notes: string[] = [];

  const statusSection = extractSection(content, "Current Status");
  if (statusSection) {
    // Split on bold-marked entries or significant paragraphs
    const paragraphs = statusSection
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter(Boolean);
    notes.push(...paragraphs);
  }

  return notes;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseContextMd(content: string): ParsedContext {
  const stakeholders = parseStakeholders(content);

  return {
    dealProperties: extractDealProperties(content),
    contacts: extractContacts(stakeholders),
    notes: extractNotes(content),
    activityLog: parseActivityLog(content),
    meddpicc: parseMEDDPICC(content),
    stakeholders: stakeholders.length > 0 ? stakeholders : undefined,
    hypothesis: parseHypothesis(content),
    painPoints: extractPainPoints(content),
    rawContent: content,
  };
}

export function contextToCrmArtifact(
  parsed: ParsedContext,
  dealId: string,
): CrmSnapshotArtifact {
  return {
    id: `${dealId}_crm_snapshot`,
    dealId,
    type: "crm_snapshot",
    sourceFile: "context.md",
    createdAt: parsed.dealProperties.lastContactedDate || new Date().toISOString().slice(0, 10),
    anonymized: false,
    dealProperties: parsed.dealProperties,
    contacts: parsed.contacts,
    notes: parsed.notes,
    activityLog: parsed.activityLog,
  };
}
