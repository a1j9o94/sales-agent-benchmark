#!/usr/bin/env bun
/**
 * Extract checkpoints from deal context files for the Sales Agent Benchmark.
 *
 * This script parses all deals from ~/sales-workspace/deals/ and creates
 * checkpoint snapshots at key moments with ground truth for what happened next.
 */

import { readdir, readFile, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import type { Deal, Checkpoint, DealContext, GroundTruth, Stakeholder } from "../src/types/benchmark";

const DEALS_DIR = join(process.env.HOME || "", "sales-workspace", "deals");
const OUTPUT_DIR = join(process.cwd(), "data", "checkpoints");

// Company name replacements for anonymization
const COMPANY_REPLACEMENTS: Record<string, string> = {
  "flagship": "Horizon Ventures",
  "flagship pioneering": "Horizon Ventures",
  "moxie": "Velocity Systems",
  "granola": "NoteFlow AI",
  "zenith prep academy": "Summit Learning",
  "zenith": "Summit Learning",
  "eaton group": "Eastpoint Capital",
  "eaton": "Eastpoint",
  "anisa": "Artisan Brands",
  "genea": "LifeGen Labs",
  "pronet": "NetPro Solutions",
  "hometime": "DwellTech",
  "patoma": "PathMark Analytics",
  "avmedia": "StreamCore Media",
  "scg-security": "SecureGuard Systems",
  "scg": "SecureGuard",
  "cool-rooms": "ChillSpace Tech",
  "xpansiv": "GreenMarket Exchange",
  "finera": "FinEdge Solutions",
  "zapier": "AutomateFlow",
  "workato": "IntegrateHub",
  "make": "FlowBuilder",
  "hubspot": "SalesCloud",
  "salesforce": "CRMPlatform",
  "slack": "TeamChat",
  "coupa": "ProcureSoft",
  "clickup": "TaskBoard",
  "intercom": "ChatSupport",
  "snowflake": "DataVault",
  "airtable": "GridBase",
  "notion": "DocSpace",
  "stripe": "PayFlow",
  "attio": "RelateSync",
};

// Person name replacements
const PERSON_REPLACEMENTS: Record<string, string> = {
  "adrian": "Alex",
  "sam": "Jordan",
  "amy": "Sarah",
  "feng": "David",
  "bryan": "Mike",
  "fred": "Robert",
  "sonia": "Lisa",
  "sonya": "Lisa",
  "derek": "Kevin",
  "julia": "Emma",
  "emily": "Rachel",
  "will": "James",
  "caroline": "Katie",
  "clementine": "Claire",
  "nyal": "Nathan",
  "shre": "Steve",
  "tracy": "Taylor",
  "wade": "Walter",
  "chris": "Charles",
  "kyle": "Kurt",
  "frank": "Francis",
  "carl": "Craig",
};

function anonymizeText(text: string): string {
  let result = text;

  // Replace company names (case-insensitive, whole word)
  for (const [real, fake] of Object.entries(COMPANY_REPLACEMENTS)) {
    const regex = new RegExp(`\\b${real}\\b`, "gi");
    result = result.replace(regex, fake);
  }

  // Replace person names (case-insensitive, whole word)
  for (const [real, fake] of Object.entries(PERSON_REPLACEMENTS)) {
    const regex = new RegExp(`\\b${real}\\b`, "gi");
    result = result.replace(regex, fake);
  }

  // Anonymize emails
  result = result.replace(/[\w.-]+@[\w.-]+\.\w+/g, "user@company.example.com");

  // Anonymize phone numbers
  result = result.replace(/(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, "555-XXX-XXXX");

  // Anonymize file paths
  result = result.replace(/\/Users\/[\w-]+/g, "/Users/username");

  // Anonymize specific dollar amounts to ranges
  result = result.replace(/\$(\d{1,3}),?(\d{3})/g, (match, first, second) => {
    const amount = parseInt(first + second);
    if (amount >= 100000) return "$100K+";
    if (amount >= 50000) return "$50-100K";
    if (amount >= 20000) return "$20-50K";
    return "$10-20K";
  });

  // Anonymize URLs
  result = result.replace(/https?:\/\/[^\s<>"]+/g, "https://example.com/...");

  return result;
}

interface ActivityLogEntry {
  date: string;
  content: string;
}

function parseActivityLog(content: string): ActivityLogEntry[] {
  const entries: ActivityLogEntry[] = [];
  const logSection = content.match(/## Activity Log\n\n([\s\S]*?)(?=\n## |$)/);

  if (!logSection) return entries;

  const lines = logSection[1].split("\n");
  let currentEntry: ActivityLogEntry | null = null;

  for (const line of lines) {
    // Match date patterns like "- **2026-01-29**:" or "- **Jan 30**:"
    const dateMatch = line.match(/^-\s+\*\*(\d{4}-\d{2}-\d{2}|\w+ \d{1,2})\*\*:?\s*(.*)$/);
    if (dateMatch) {
      if (currentEntry) entries.push(currentEntry);
      currentEntry = {
        date: dateMatch[1],
        content: dateMatch[2] || "",
      };
    } else if (currentEntry && line.trim().startsWith("-")) {
      currentEntry.content += " " + line.trim().substring(1).trim();
    } else if (currentEntry && line.trim()) {
      currentEntry.content += " " + line.trim();
    }
  }

  if (currentEntry) entries.push(currentEntry);

  return entries;
}

function parseMEDDPICC(content: string): DealContext["meddpicc"] {
  const meddpicc: DealContext["meddpicc"] = {};

  const tableMatch = content.match(/\| Element \| Status \| Notes \|\n\|[-\s|]+\|\n([\s\S]*?)(?=\n\n|\n##)/);
  if (!tableMatch) return meddpicc;

  const rows = tableMatch[1].split("\n").filter((r) => r.trim());

  for (const row of rows) {
    const cells = row.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length >= 3) {
      const element = cells[0].toLowerCase();
      const status = cells[1];
      const notes = cells[2];

      const statusMap: Record<string, string> = {
        "🟢": "green",
        "🟡": "yellow",
        "🔴": "red",
      };

      const statusValue = statusMap[status] || status;

      switch (element) {
        case "metrics":
          meddpicc.metrics = { status: statusValue, notes };
          break;
        case "economic buyer":
          meddpicc.economicBuyer = { status: statusValue, notes };
          break;
        case "decision criteria":
          meddpicc.decisionCriteria = { status: statusValue, notes };
          break;
        case "decision process":
          meddpicc.decisionProcess = { status: statusValue, notes };
          break;
        case "paper process":
          meddpicc.paperProcess = { status: statusValue, notes };
          break;
        case "pain":
          meddpicc.pain = { status: statusValue, notes };
          break;
        case "champion":
          meddpicc.champion = { status: statusValue, notes };
          break;
        case "competition":
          meddpicc.competition = { status: statusValue, notes };
          break;
      }
    }
  }

  return meddpicc;
}

function parseStakeholders(content: string): Stakeholder[] {
  const stakeholders: Stakeholder[] = [];

  const mapMatch = content.match(/## Stakeholder Map\n\n([\s\S]*?)(?=\n## |$)/);
  if (!mapMatch) return stakeholders;

  const lines = mapMatch[1].split("\n").filter((l) => l.trim().startsWith("-"));

  for (const line of lines) {
    // Parse lines like "- **Fred** - CIO - Economic Buyer - Cautious. Won't pay..."
    const match = line.match(/^-\s+\*\*([^*]+)\*\*\s*-\s*([^-]+)\s*-\s*([^-]+)\s*-\s*(.*)$/);
    if (match) {
      const sentiment = match[4].toLowerCase();
      let sentimentValue: Stakeholder["sentiment"] = "unknown";
      if (sentiment.includes("positive") || sentiment.includes("engaged") || sentiment.includes("strong")) {
        sentimentValue = "positive";
      } else if (sentiment.includes("negative") || sentiment.includes("block") || sentiment.includes("concern")) {
        sentimentValue = "negative";
      } else if (sentiment.includes("neutral") || sentiment.includes("cautious")) {
        sentimentValue = "neutral";
      }

      stakeholders.push({
        name: anonymizeText(match[1].trim()),
        title: anonymizeText(match[2].trim()),
        role: anonymizeText(match[3].trim()),
        sentiment: sentimentValue,
        notes: anonymizeText(match[4].trim()),
      });
    }
  }

  return stakeholders;
}

function parseHypothesis(content: string): DealContext["hypothesis"] {
  const hypothesis: DealContext["hypothesis"] = {
    whyTheyWillBuy: [],
    whyTheyMightNot: [],
    whatNeedsToBeTrue: [],
  };

  // Parse "They will buy because:"
  const buyMatch = content.match(/They will buy because:\n([\s\S]*?)(?=They might not buy|Why they might not|$)/i);
  if (buyMatch) {
    const lines = buyMatch[1].split("\n").filter((l) => l.trim().startsWith("-"));
    hypothesis.whyTheyWillBuy = lines.map((l) => anonymizeText(l.replace(/^-\s*/, "").trim()));
  }

  // Parse "They might not buy because:" or "Why they might not:"
  const notBuyMatch = content.match(/(?:They might not buy because|Why they might not):\n([\s\S]*?)(?=What needs to be true|$)/i);
  if (notBuyMatch) {
    const lines = notBuyMatch[1].split("\n").filter((l) => l.trim().startsWith("-"));
    hypothesis.whyTheyMightNot = lines.map((l) => anonymizeText(l.replace(/^-\s*/, "").trim()));
  }

  // Parse "What needs to be true:"
  const needsMatch = content.match(/What needs to be true:\n([\s\S]*?)(?=\n## |$)/i);
  if (needsMatch) {
    const lines = needsMatch[1].split("\n").filter((l) => l.trim().startsWith("-"));
    hypothesis.whatNeedsToBeTrue = lines.map((l) => anonymizeText(l.replace(/^-\s*/, "").trim()));
  }

  return hypothesis;
}

function extractPainPoints(content: string): string[] {
  const painPoints: string[] = [];

  // From MEDDPICC Pain section
  const painMatch = content.match(/\| Pain \| [🟢🟡🔴] \| ([^|]+) \|/);
  if (painMatch) {
    painPoints.push(anonymizeText(painMatch[1].trim()));
  }

  // From hypothesis section
  const hypothesis = parseHypothesis(content);
  if (hypothesis.whyTheyWillBuy.length > 0) {
    painPoints.push(...hypothesis.whyTheyWillBuy.slice(0, 2));
  }

  return painPoints;
}

async function generateCheckpointsWithLLM(
  dealName: string,
  contextContent: string,
  transcripts: string[]
): Promise<Checkpoint[]> {
  const prompt = `Analyze this sales deal and create 2-4 checkpoints representing key moments in the deal timeline.

DEAL NAME: ${dealName}

CONTEXT.MD:
${contextContent.slice(0, 8000)}

${transcripts.length > 0 ? `TRANSCRIPTS AVAILABLE: ${transcripts.length} files` : "NO TRANSCRIPTS"}

For each checkpoint, extract:
1. The timestamp (date from activity log)
2. The deal context at that moment (stage, stakeholders known, pain points identified)
3. What actually happened AFTER that checkpoint (ground truth)

Return ONLY valid JSON:
{
  "checkpoints": [
    {
      "timestamp": "2026-01-16",
      "contextSummary": "After leadership demo, champion engaged, CIO cautious",
      "stage": "Discovery",
      "lastEvent": "Leadership demo with VP Ops",
      "painPointsKnown": ["Manual process taking 20hrs/week", "Previous bad software purchases"],
      "whatHappenedNext": "Working session scheduled, technical validation successful",
      "risksAtThisPoint": ["CIO reluctant to commit", "Competitor already embedded"],
      "outcomeAtCheckpoint": "progressing"
    }
  ],
  "finalOutcome": "won|lost|stalled|active"
}`;

  try {
    const result = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      prompt,
      maxTokens: 4000,
    });

    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.checkpoints.map((cp: any, idx: number) => ({
      id: `${dealName.toLowerCase().replace(/\s+/g, "_")}_cp_${String(idx + 1).padStart(3, "0")}`,
      dealId: dealName.toLowerCase().replace(/\s+/g, "_"),
      timestamp: cp.timestamp,
      context: {
        company: anonymizeText(dealName),
        stage: cp.stage,
        lastInteraction: anonymizeText(cp.lastEvent),
        painPoints: (cp.painPointsKnown || []).map(anonymizeText),
        stakeholders: [],
        history: anonymizeText(cp.contextSummary),
      },
      groundTruth: {
        whatHappenedNext: anonymizeText(cp.whatHappenedNext),
        actualRisksThatMaterialized: (cp.risksAtThisPoint || []).map(anonymizeText),
        outcomeAtThisPoint: cp.outcomeAtCheckpoint || "progressing",
      },
    }));
  } catch (error) {
    console.error(`  LLM extraction failed for ${dealName}:`, error);
    return [];
  }
}

function extractBasicDealInfo(content: string): Partial<DealContext> {
  const info: Partial<DealContext> = {};

  // Extract stage
  const stageMatch = content.match(/\*\*Stage\*\*:\s*(.+?)(?:\n|$)/);
  if (stageMatch) info.stage = anonymizeText(stageMatch[1].trim());

  // Extract amount
  const amountMatch = content.match(/\*\*(?:Amount|Current ARR|Potential Amount)\*\*:\s*(.+?)(?:\n|$)/);
  if (amountMatch) info.amount = anonymizeText(amountMatch[1].trim());

  // Extract close date
  const closeMatch = content.match(/\*\*Close Date\*\*:\s*(.+?)(?:\n|$)/);
  if (closeMatch) info.closeDate = anonymizeText(closeMatch[1].trim());

  return info;
}

async function processDeal(dealDir: string): Promise<Deal | null> {
  const dealName = dealDir.split("/").pop() || "unknown";
  console.log(`  Processing: ${dealName}`);

  try {
    // Read context.md
    const contextPath = join(dealDir, "context.md");
    let contextContent: string;
    try {
      contextContent = await readFile(contextPath, "utf-8");
    } catch {
      console.log(`    No context.md found, skipping`);
      return null;
    }

    // Read transcripts
    const transcriptsDir = join(dealDir, "transcripts");
    let transcripts: string[] = [];
    try {
      const transcriptFiles = await readdir(transcriptsDir);
      for (const file of transcriptFiles.filter((f) => f.endsWith(".md"))) {
        const content = await readFile(join(transcriptsDir, file), "utf-8");
        transcripts.push(content);
      }
    } catch {
      // No transcripts directory
    }

    // Extract basic info from context
    const basicInfo = extractBasicDealInfo(contextContent);
    const stakeholders = parseStakeholders(contextContent);
    const meddpicc = parseMEDDPICC(contextContent);
    const hypothesis = parseHypothesis(contextContent);
    const painPoints = extractPainPoints(contextContent);
    const activityLog = parseActivityLog(contextContent);

    // Generate checkpoints with LLM
    const checkpoints = await generateCheckpointsWithLLM(dealName, contextContent, transcripts);

    // Enhance checkpoints with parsed data
    for (const cp of checkpoints) {
      cp.context.stakeholders = stakeholders;
      cp.context.meddpicc = meddpicc;
      cp.context.hypothesis = hypothesis;
      if (basicInfo.amount) cp.context.amount = basicInfo.amount;
      if (basicInfo.closeDate) cp.context.closeDate = basicInfo.closeDate;
      if (painPoints.length > cp.context.painPoints.length) {
        cp.context.painPoints = painPoints;
      }
    }

    // Determine final outcome from content
    let finalOutcome: Deal["finalOutcome"] = "active";
    const contentLower = contextContent.toLowerCase();
    if (contentLower.includes("won") || contentLower.includes("closed won") || contentLower.includes("paid pilot")) {
      finalOutcome = "won";
    } else if (contentLower.includes("lost") || contentLower.includes("closed lost")) {
      finalOutcome = "lost";
    } else if (contentLower.includes("stalled") || contentLower.includes("went quiet")) {
      finalOutcome = "stalled";
    }

    return {
      id: dealName.toLowerCase().replace(/\s+/g, "_"),
      name: anonymizeText(dealName),
      checkpoints,
      finalOutcome,
    };
  } catch (error) {
    console.error(`    Error processing ${dealName}:`, error);
    return null;
  }
}

async function main() {
  console.log("🎯 Extracting deal checkpoints for Sales Agent Benchmark\n");

  // Create output directories
  await mkdir(join(OUTPUT_DIR, "public"), { recursive: true });
  await mkdir(join(OUTPUT_DIR, "private"), { recursive: true });

  // Read all deal directories
  let dealDirs: string[];
  try {
    const entries = await readdir(DEALS_DIR, { withFileTypes: true });
    dealDirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => join(DEALS_DIR, e.name));
  } catch (error) {
    console.error(`Failed to read deals directory: ${DEALS_DIR}`);
    console.error(error);
    process.exit(1);
  }

  console.log(`Found ${dealDirs.length} deals\n`);

  // Process each deal
  const deals: Deal[] = [];
  for (const dealDir of dealDirs) {
    const deal = await processDeal(dealDir);
    if (deal && deal.checkpoints.length > 0) {
      deals.push(deal);
    }
  }

  console.log(`\nSuccessfully processed ${deals.length} deals with checkpoints\n`);

  // Split into public (first 5) and private (rest)
  const publicDeals = deals.slice(0, 5);
  const privateDeals = deals.slice(5);

  // Write public deals (with full ground truth)
  for (const deal of publicDeals) {
    const outputPath = join(OUTPUT_DIR, "public", `${deal.id}.json`);
    await writeFile(outputPath, JSON.stringify(deal, null, 2));
    console.log(`  📁 Public: ${deal.id} (${deal.checkpoints.length} checkpoints)`);
  }

  // Write private deals (ground truth included but not exposed via API)
  for (const deal of privateDeals) {
    const outputPath = join(OUTPUT_DIR, "private", `${deal.id}.json`);
    await writeFile(outputPath, JSON.stringify(deal, null, 2));
    console.log(`  🔒 Private: ${deal.id} (${deal.checkpoints.length} checkpoints)`);
  }

  // Write summary
  const summary = {
    totalDeals: deals.length,
    publicDeals: publicDeals.length,
    privateDeals: privateDeals.length,
    totalCheckpoints: deals.reduce((sum, d) => sum + d.checkpoints.length, 0),
    extractedAt: new Date().toISOString(),
    dealSummary: deals.map((d) => ({
      id: d.id,
      name: d.name,
      checkpoints: d.checkpoints.length,
      finalOutcome: d.finalOutcome,
      isPublic: publicDeals.includes(d),
    })),
  };

  await writeFile(join(OUTPUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));

  console.log(`\n✅ Extraction complete!`);
  console.log(`   Output: ${OUTPUT_DIR}`);
  console.log(`   Public deals: ${publicDeals.length}`);
  console.log(`   Private deals: ${privateDeals.length}`);
  console.log(`   Total checkpoints: ${summary.totalCheckpoints}`);
}

main().catch(console.error);
