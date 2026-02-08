/**
 * V2 JSON Exporter
 *
 * Exports V2Deal objects to JSON files in the data/v2/checkpoints/ directory.
 * Handles public/private split and summary generation.
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import type { V2Deal } from "../../../src/types/benchmark-v2";

const DEFAULT_OUTPUT_DIR = join(process.cwd(), "data", "v2", "checkpoints");

/** Public deal IDs (same 5 as v1) */
const PUBLIC_DEAL_IDS = new Set([
  "velocity-systems",
  "noteflow-ai",
  "streamcore-media",
  "chillspace-tech",
  "summit-learning",
]);

export interface ExportOptions {
  outputDir?: string;
  dryRun?: boolean;
}

export interface ExportResult {
  dealId: string;
  path: string;
  isPublic: boolean;
  written: boolean;
}

/**
 * Export a single V2Deal to JSON file.
 */
export async function exportDeal(
  deal: V2Deal,
  options: ExportOptions = {}
): Promise<ExportResult> {
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const isPublic = PUBLIC_DEAL_IDS.has(deal.id);
  const tier = isPublic ? "public" : "private";
  const dirPath = join(outputDir, tier);
  const filePath = join(dirPath, `${deal.id}.json`);

  if (!options.dryRun) {
    await mkdir(dirPath, { recursive: true });
    await writeFile(filePath, JSON.stringify(deal, null, 2));
  }

  return {
    dealId: deal.id,
    path: filePath,
    isPublic,
    written: !options.dryRun,
  };
}

/**
 * Export all deals and generate summary.
 */
export async function exportAllDeals(
  deals: V2Deal[],
  options: ExportOptions = {}
): Promise<{
  results: ExportResult[];
  summary: V2ExportSummary;
}> {
  const results: ExportResult[] = [];

  for (const deal of deals) {
    const result = await exportDeal(deal, options);
    results.push(result);
  }

  const summary = generateSummary(deals, results);

  if (!options.dryRun) {
    const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
    await writeFile(
      join(outputDir, "summary.json"),
      JSON.stringify(summary, null, 2)
    );
  }

  return { results, summary };
}

export interface V2ExportSummary {
  version: 2;
  totalDeals: number;
  publicDeals: number;
  privateDeals: number;
  totalCheckpoints: number;
  totalArtifacts: number;
  totalTasks: number;
  extractedAt: string;
  dealSummary: {
    id: string;
    name: string;
    checkpoints: number;
    artifacts: number;
    tasks: number;
    finalOutcome: string;
    isPublic: boolean;
    artifactTypes: string[];
  }[];
}

function generateSummary(deals: V2Deal[], results: ExportResult[]): V2ExportSummary {
  const publicResults = results.filter((r) => r.isPublic);
  const privateResults = results.filter((r) => !r.isPublic);

  return {
    version: 2,
    totalDeals: deals.length,
    publicDeals: publicResults.length,
    privateDeals: privateResults.length,
    totalCheckpoints: deals.reduce((sum, d) => sum + d.checkpoints.length, 0),
    totalArtifacts: deals.reduce((sum, d) => sum + Object.keys(d.artifacts).length, 0),
    totalTasks: deals.reduce(
      (sum, d) => sum + d.checkpoints.reduce((s, cp) => s + cp.tasks.length, 0),
      0
    ),
    extractedAt: new Date().toISOString(),
    dealSummary: deals.map((deal) => {
      const result = results.find((r) => r.dealId === deal.id);
      const artifactTypes = [
        ...new Set(Object.values(deal.artifacts).map((a) => a.type)),
      ];
      return {
        id: deal.id,
        name: deal.name,
        checkpoints: deal.checkpoints.length,
        artifacts: Object.keys(deal.artifacts).length,
        tasks: deal.checkpoints.reduce((s, cp) => s + cp.tasks.length, 0),
        finalOutcome: deal.finalOutcome,
        isPublic: result?.isPublic ?? false,
        artifactTypes,
      };
    }),
  };
}
