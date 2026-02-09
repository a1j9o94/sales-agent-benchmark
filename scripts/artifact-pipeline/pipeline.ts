#!/usr/bin/env bun
/**
 * Artifact Pipeline Orchestrator
 *
 * CLI tool to process deals through the artifact pipeline:
 * ingest → transform → validate → export
 *
 * Usage:
 *   bun scripts/artifact-pipeline/pipeline.ts                            # Process all deals
 *   bun scripts/artifact-pipeline/pipeline.ts --deals flagship,granola   # Specific deals
 *   bun scripts/artifact-pipeline/pipeline.ts --skip-external            # Skip HubSpot/Gmail/Slack
 *   bun scripts/artifact-pipeline/pipeline.ts --include-external <json>  # Merge external data from JSON file
 *   bun scripts/artifact-pipeline/pipeline.ts --dry-run                  # Validate without writing
 */

import { readdir } from "fs/promises";
import { join } from "path";
import type {
  ArtifactDeal,
  Artifact,
  PipelineConfig,
  PipelineResult,
  PipelineSummary,
  DealClassification,
  DealTier,
} from "../../src/types/benchmark-artifact";
import { ingestTranscripts } from "./ingest/transcripts";
import { parseContextMd, contextToCrmArtifact } from "./ingest/context";
import { ingestDocuments } from "./ingest/documents";
import { mergeHubSpotIntoCrm, transformHubSpotData } from "./ingest/hubspot";
import type { RawHubSpotDeal, RawHubSpotContact, RawHubSpotNote } from "./ingest/hubspot";
import { transformRawGmailMessages } from "./ingest/gmail";
import type { RawGmailMessage } from "./ingest/gmail";
import { transformRawSlackMessages } from "./ingest/slack";
import type { RawSlackMessage } from "./ingest/slack";
import { anonymizeArtifact } from "./transform/anonymize";
import { buildCheckpoints, type CheckpointBuilderInput } from "./transform/checkpoint-builder";
import { sortArtifactsChronologically, getArtifactDate } from "./transform/linker";
import { validateDeal } from "./validate/quality";
import { exportAllDeals } from "./export/artifact-json";

const DEALS_DIR = join(process.env.HOME || "", "sales-workspace", "deals");
const OUTPUT_DIR = join(process.cwd(), "data", "artifact", "checkpoints");

// ---------------------------------------------------------------------------
// External data shape (loaded from JSON file via --include-external)
// ---------------------------------------------------------------------------

/**
 * External data for a single deal, keyed by deal directory name.
 * This JSON file is produced interactively using Zapier MCP, then fed to the pipeline.
 */
export interface ExternalDealData {
  hubspot?: {
    deal: RawHubSpotDeal;
    contacts: RawHubSpotContact[];
    notes?: RawHubSpotNote[];
  };
  gmail?: {
    messages: RawGmailMessage[];
  };
  slack?: {
    messages: RawSlackMessage[];
  };
}

/** Map of deal directory name → external data */
export type ExternalDataMap = Record<string, ExternalDealData>;

/** Deal directory name → codename mapping */
const DEAL_ID_MAP: Record<string, string> = {
  moxie: "velocity-systems",
  granola: "noteflow-ai",
  avmedia: "streamcore-media",
  "cool-rooms": "chillspace-tech",
  "zenith-prep-academy": "summit-learning",
  pronet: "netpro-solutions",
  flagship: "horizon-ventures",
  patoma: "pathmark-analytics",
  genea: "lifegen-labs",
  anisa: "artisan-brands",
  "eaton-group": "eastpoint-capital",
  hometime: "dwelltech",
  "scg-security": "secureguard-systems",
  finera: "finedge-solutions",
  xpansiv: "greenmarket-exchange",
};

const DEAL_NAME_MAP: Record<string, string> = {
  moxie: "Velocity Systems",
  granola: "NoteFlow AI",
  avmedia: "StreamCore Media",
  "cool-rooms": "ChillSpace Tech",
  "zenith-prep-academy": "Summit Learning",
  pronet: "NetPro Solutions",
  flagship: "Horizon Ventures",
  patoma: "PathMark Analytics",
  genea: "LifeGen Labs",
  anisa: "Artisan Brands",
  "eaton-group": "Eastpoint Capital",
  hometime: "DwellTech",
  "scg-security": "SecureGuard Systems",
  finera: "FinEdge Solutions",
  xpansiv: "GreenMarket Exchange",
};

/**
 * Classify deals by data richness.
 */
async function classifyDeals(dealDirs: string[]): Promise<DealClassification[]> {
  const classifications: DealClassification[] = [];

  for (const dealDir of dealDirs) {
    const dealName = dealDir.split("/").pop() || "";
    let transcriptCount = 0;
    let hasContextMd = false;
    let hasOutputs = false;

    try {
      await Bun.file(join(dealDir, "context.md")).text();
      hasContextMd = true;
    } catch {}

    try {
      const entries = await readdir(join(dealDir, "transcripts"));
      transcriptCount = entries.filter((f) => f.endsWith(".md")).length;
    } catch {}

    try {
      const entries = await readdir(join(dealDir, "outputs"));
      hasOutputs = entries.length > 0;
    } catch {}

    let tier: DealTier;
    if (transcriptCount >= 4) {
      tier = "artifact-rich";
    } else if (transcriptCount >= 1) {
      tier = "artifact-standard";
    } else {
      tier = "summary-only";
    }

    classifications.push({
      dealDir: dealName,
      tier,
      transcriptCount,
      hasContextMd,
      hasOutputs,
    });
  }

  return classifications;
}

/**
 * Process a single deal through the pipeline.
 */
async function processDeal(
  dealDir: string,
  config: PipelineConfig,
  externalData?: ExternalDealData,
): Promise<{ deal: ArtifactDeal | null; result: PipelineResult }> {
  const dealDirName = dealDir.split("/").pop() || "";
  const dealId = DEAL_ID_MAP[dealDirName] || dealDirName;
  const dealName = DEAL_NAME_MAP[dealDirName] || dealDirName;
  const warnings: string[] = [];
  const errors: string[] = [];

  console.log(`\n  Processing: ${dealDirName} → ${dealId}`);

  // Step 1: Ingest local artifacts
  const allArtifacts: Artifact[] = [];

  // Transcripts
  try {
    const transcripts = await ingestTranscripts(dealDir, dealId);
    allArtifacts.push(...transcripts);
    console.log(`    Transcripts: ${transcripts.length}`);
  } catch (err) {
    warnings.push(`Failed to ingest transcripts: ${err}`);
  }

  // Context.md → CRM Snapshot
  try {
    const contextContent = await Bun.file(join(dealDir, "context.md")).text();
    const parsed = parseContextMd(contextContent);
    const crmArtifact = contextToCrmArtifact(parsed, dealId);
    allArtifacts.push(crmArtifact);
    console.log(`    CRM Snapshot: 1 (${parsed.activityLog.length} activity entries)`);
  } catch (err) {
    warnings.push(`Failed to parse context.md: ${err}`);
  }

  // Documents
  try {
    const docs = await ingestDocuments(dealDir, dealId);
    allArtifacts.push(...docs);
    console.log(`    Documents: ${docs.length}`);
  } catch (err) {
    warnings.push(`Failed to ingest documents: ${err}`);
  }

  // Step 2: Merge external data if provided
  if (!config.skipExternal && externalData) {
    let externalCount = 0;

    // Gmail → EmailArtifacts
    if (externalData.gmail?.messages?.length) {
      const emailArtifacts = transformRawGmailMessages(
        dealId,
        externalData.gmail.messages,
      );
      allArtifacts.push(...emailArtifacts);
      externalCount += emailArtifacts.length;
      console.log(`    Gmail emails: ${emailArtifacts.length} threads`);
    }

    // Slack → SlackThreadArtifacts
    if (externalData.slack?.messages?.length) {
      const slackArtifacts = transformRawSlackMessages(
        dealId,
        externalData.slack.messages,
      );
      allArtifacts.push(...slackArtifacts);
      externalCount += slackArtifacts.length;
      console.log(`    Slack threads: ${slackArtifacts.length}`);
    }

    // HubSpot: merged into CRM snapshot after anonymization step
    // (handled below in step 3, since we merge into existing CRM artifact)
    if (externalData.hubspot?.deal) {
      console.log(`    HubSpot deal data: present (will merge into CRM snapshot)`);
    }

    if (externalCount === 0 && !externalData.hubspot?.deal) {
      console.log(`    External data: provided but empty`);
    }
  } else if (!config.skipExternal) {
    console.log(`    External data: none provided`);
  }

  if (allArtifacts.length === 0) {
    errors.push("No artifacts ingested");
    return {
      deal: null,
      result: {
        dealId,
        dealName,
        success: false,
        artifactCount: 0,
        checkpointCount: 0,
        warnings,
        errors,
      },
    };
  }

  // Step 2b: Merge HubSpot data into CRM snapshot (before anonymization)
  if (!config.skipExternal && externalData?.hubspot?.deal) {
    const crmIdx = allArtifacts.findIndex((a) => a.type === "crm_snapshot");
    if (crmIdx >= 0) {
      const existingCrm = allArtifacts[crmIdx] as import("../../src/types/benchmark-artifact").CrmSnapshotArtifact;
      const hubspotResult = transformHubSpotData(
        dealId,
        externalData.hubspot.deal,
        externalData.hubspot.contacts || [],
        externalData.hubspot.notes,
      );
      allArtifacts[crmIdx] = mergeHubSpotIntoCrm(existingCrm, hubspotResult);
      console.log(`    HubSpot merge: ${hubspotResult.contacts.length} contacts, ${hubspotResult.notes.length} notes, ${hubspotResult.activityLog.length} activities`);
    } else {
      warnings.push("HubSpot data provided but no CRM snapshot to merge into");
    }
  }

  // Step 3: Anonymize
  let processedArtifacts = allArtifacts;
  if (config.anonymize !== false) {
    processedArtifacts = allArtifacts.map((a) => anonymizeArtifact(a));
    console.log(`    Anonymized: ${processedArtifacts.length} artifacts`);
  }

  // Step 4: Build checkpoints
  const crmArtifact = processedArtifacts.find((a) => a.type === "crm_snapshot");
  const activityLog = crmArtifact?.type === "crm_snapshot" ? crmArtifact.activityLog : [];

  // Extract stakeholders and MEDDPICC from CRM snapshot or context
  let stakeholders: CheckpointBuilderInput["stakeholders"] = [];
  let meddpicc: CheckpointBuilderInput["meddpicc"];
  let stage = "Unknown";
  let amount: string | undefined;
  let firstContactDate: string | undefined;

  if (crmArtifact?.type === "crm_snapshot") {
    stage = crmArtifact.dealProperties.stage;
    amount = crmArtifact.dealProperties.amount;
    firstContactDate = crmArtifact.dealProperties.lastContactedDate;

    stakeholders = crmArtifact.contacts.map((c) => ({
      name: c.name,
      title: c.title,
      role: c.role || "unknown",
      sentiment: "unknown" as const,
    }));
  }

  // Determine final outcome
  let finalOutcome: ArtifactDeal["finalOutcome"] = "active";
  if (crmArtifact?.type === "crm_snapshot") {
    const stageLower = stage.toLowerCase();
    if (stageLower.includes("won") || stageLower.includes("closed")) finalOutcome = "won";
    else if (stageLower.includes("lost")) finalOutcome = "lost";
    else if (stageLower.includes("stall")) finalOutcome = "stalled";
  }

  const checkpoints = buildCheckpoints({
    dealId,
    dealName,
    artifacts: processedArtifacts,
    activityLog,
    stakeholders,
    meddpicc,
    stage,
    amount,
    finalOutcome,
    firstContactDate,
  });

  console.log(`    Checkpoints: ${checkpoints.length}`);
  console.log(`    Tasks: ${checkpoints.reduce((s, cp) => s + cp.tasks.length, 0)}`);

  // Build the ArtifactDeal
  const artifactsMap: Record<string, Artifact> = {};
  for (const artifact of processedArtifacts) {
    artifactsMap[artifact.id] = artifact;
  }

  const sorted = sortArtifactsChronologically(processedArtifacts);
  const dateRange = {
    start: sorted.length > 0 ? getArtifactDate(sorted[0]!) : "",
    end: sorted.length > 0 ? getArtifactDate(sorted[sorted.length - 1]!) : "",
  };

  const deal: ArtifactDeal = {
    id: dealId,
    name: dealName,
    version: 2,
    artifacts: artifactsMap,
    checkpoints,
    finalOutcome,
    metadata: {
      sourceDeals: [dealDirName],
      transcriptCount: processedArtifacts.filter((a) => a.type === "transcript").length,
      artifactCount: processedArtifacts.length,
      dateRange,
    },
  };

  // Step 5: Validate
  const validation = validateDeal(deal);
  if (!validation.valid) {
    errors.push(...validation.errors);
  }
  warnings.push(...validation.warnings);

  if (validation.warnings.length > 0) {
    console.log(`    Warnings: ${validation.warnings.length}`);
  }
  if (validation.errors.length > 0) {
    console.log(`    Errors: ${validation.errors.length}`);
  }

  return {
    deal: validation.valid ? deal : null,
    result: {
      dealId,
      dealName,
      success: validation.valid,
      artifactCount: processedArtifacts.length,
      checkpointCount: checkpoints.length,
      warnings,
      errors,
    },
  };
}

/**
 * Parse CLI arguments.
 */
function parseArgs(): { config: PipelineConfig; externalDataPath?: string } {
  const args = process.argv.slice(2);
  const config: PipelineConfig = {
    dealsDir: DEALS_DIR,
    outputDir: OUTPUT_DIR,
    anonymize: true,
  };
  let externalDataPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--deals":
        config.deals = args[++i]?.split(",");
        break;
      case "--skip-external":
        config.skipExternal = true;
        break;
      case "--include-external":
        externalDataPath = args[++i];
        break;
      case "--dry-run":
        config.dryRun = true;
        break;
      case "--no-anonymize":
        config.anonymize = false;
        break;
      case "--output":
        config.outputDir = args[++i] ?? config.outputDir;
        break;
    }
  }

  return { config, externalDataPath };
}

/**
 * Load external data from a JSON file.
 * The file should contain an ExternalDataMap: { [dealDirName]: ExternalDealData }
 */
async function loadExternalData(path: string): Promise<ExternalDataMap> {
  const file = Bun.file(path);
  const exists = await file.exists();
  if (!exists) {
    console.error(`External data file not found: ${path}`);
    process.exit(1);
  }
  const content = await file.json();
  return content as ExternalDataMap;
}

/**
 * Main pipeline execution.
 */
async function main() {
  const { config, externalDataPath } = parseArgs();
  const startedAt = new Date().toISOString();

  // Load external data if provided
  let externalDataMap: ExternalDataMap | undefined;
  if (externalDataPath) {
    externalDataMap = await loadExternalData(externalDataPath);
    console.log(`Loaded external data for ${Object.keys(externalDataMap).length} deals\n`);
  }

  console.log("=== Artifact Benchmark Pipeline ===\n");
  console.log(`Deals directory: ${config.dealsDir}`);
  console.log(`Output directory: ${config.outputDir}`);
  if (config.deals) console.log(`Specific deals: ${config.deals.join(", ")}`);
  if (config.skipExternal) console.log(`External data: SKIPPED`);
  if (externalDataPath) console.log(`External data: ${externalDataPath}`);
  if (config.dryRun) console.log(`Mode: DRY RUN`);

  // Discover deals
  let dealDirs: string[];
  try {
    const entries = await readdir(config.dealsDir, { withFileTypes: true });
    dealDirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => join(config.dealsDir, e.name));
  } catch (error) {
    console.error(`Failed to read deals directory: ${config.dealsDir}`);
    process.exit(1);
  }

  // Filter to specific deals if requested
  if (config.deals) {
    dealDirs = dealDirs.filter((d) => {
      const name = d.split("/").pop() || "";
      return config.deals!.includes(name);
    });
  }

  // Classify deals
  const classifications = await classifyDeals(dealDirs);
  console.log(`\nDeal Classification:`);
  for (const c of classifications) {
    console.log(`  ${c.dealDir}: ${c.tier} (${c.transcriptCount} transcripts)`);
  }

  // Filter out summary-only deals
  const artifactDealDirs = dealDirs.filter((d) => {
    const name = d.split("/").pop() || "";
    const classification = classifications.find((c) => c.dealDir === name);
    return classification && classification.tier !== "summary-only";
  });

  console.log(`\nProcessing ${artifactDealDirs.length} deals (skipping ${dealDirs.length - artifactDealDirs.length} summary-only)`);

  // Process deals
  const deals: ArtifactDeal[] = [];
  const results: PipelineResult[] = [];

  for (const dealDir of artifactDealDirs) {
    const dealDirName = dealDir.split("/").pop() || "";
    const externalData = externalDataMap?.[dealDirName];
    const { deal, result } = await processDeal(dealDir, config, externalData);
    results.push(result);
    if (deal) deals.push(deal);
  }

  // Export
  if (deals.length > 0 && !config.dryRun) {
    console.log(`\nExporting ${deals.length} deals...`);
    const { summary } = await exportAllDeals(deals, {
      outputDir: config.outputDir,
      dryRun: config.dryRun,
    });
    console.log(`\n=== Export Summary ===`);
    console.log(`  Public deals: ${summary.publicDeals}`);
    console.log(`  Private deals: ${summary.privateDeals}`);
    console.log(`  Total checkpoints: ${summary.totalCheckpoints}`);
    console.log(`  Total artifacts: ${summary.totalArtifacts}`);
    console.log(`  Total tasks: ${summary.totalTasks}`);
  }

  // Print summary
  const completedAt = new Date().toISOString();
  const pipelineSummary: PipelineSummary = {
    startedAt,
    completedAt,
    config,
    results,
    totalArtifacts: results.reduce((s, r) => s + r.artifactCount, 0),
    totalCheckpoints: results.reduce((s, r) => s + r.checkpointCount, 0),
    dealsProcessed: results.filter((r) => r.success).length,
    dealsFailed: results.filter((r) => !r.success).length,
  };

  console.log(`\n=== Pipeline Complete ===`);
  console.log(`  Deals processed: ${pipelineSummary.dealsProcessed}`);
  console.log(`  Deals failed: ${pipelineSummary.dealsFailed}`);
  console.log(`  Total artifacts: ${pipelineSummary.totalArtifacts}`);
  console.log(`  Total checkpoints: ${pipelineSummary.totalCheckpoints}`);

  if (pipelineSummary.dealsFailed > 0) {
    console.log(`\n  Failed deals:`);
    for (const r of results.filter((r) => !r.success)) {
      console.log(`    ${r.dealId}: ${r.errors.join("; ")}`);
    }
  }
}

main().catch(console.error);
