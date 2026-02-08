/**
 * Transcript Ingestion
 *
 * Reads Granola transcript markdown files from deal directories
 * and converts them to TranscriptArtifact objects using the transcript parser.
 */

import { readdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import type { TranscriptArtifact } from "../../../src/types/benchmark-v2";
import { parseGranolaTranscript } from "../transform/transcript-parser.ts";

/**
 * Ingest all transcripts from a deal directory.
 */
export async function ingestTranscripts(
  dealDir: string,
  dealId: string
): Promise<TranscriptArtifact[]> {
  const transcriptsDir = join(dealDir, "transcripts");
  const artifacts: TranscriptArtifact[] = [];

  let files: string[];
  try {
    const entries = await readdir(transcriptsDir);
    files = entries.filter((f) => f.endsWith(".md"));
  } catch {
    // No transcripts directory
    return [];
  }

  for (const file of files) {
    try {
      const filePath = join(transcriptsDir, file);
      const content = await Bun.file(filePath).text();
      const fileStats = await stat(filePath);

      const parsed = parseGranolaTranscript(content, file);
      const sanitizedName = basename(file, ".md")
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 50);

      const artifact: TranscriptArtifact = {
        id: `tx_${dealId}_${sanitizedName}`,
        dealId,
        type: "transcript",
        title: parsed.title,
        rawText: parsed.rawText,
        turns: parsed.turns,
        attendees: parsed.attendees,
        date: parsed.date || fileStats.mtime.toISOString().slice(0, 10),
        duration: parsed.duration,
        keyTakeaways: parsed.keyTakeaways,
        sourceFile: filePath,
        createdAt: fileStats.mtime.toISOString(),
        anonymized: false,
      };

      artifacts.push(artifact);
    } catch (error) {
      console.warn(`  Warning: Failed to parse transcript ${file}: ${error}`);
    }
  }

  // Sort chronologically
  artifacts.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return artifacts;
}
