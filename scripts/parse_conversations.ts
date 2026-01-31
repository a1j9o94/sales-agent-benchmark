#!/usr/bin/env bun
/**
 * Parse Claude Code conversations to identify corrections and successes.
 *
 * Corrections: User messages that indicate the assistant got something wrong
 * Successes: User messages that indicate the assistant did well
 *
 * Output structure:
 * - output/corrections/  - Examples where user corrected the assistant
 * - output/successes/    - Examples where user praised or accepted the output
 * - output/neutral/      - Neither clear correction nor success
 */

import { readdir, readFile, mkdir, writeFile } from "fs/promises";
import { join, basename } from "path";
import { existsSync } from "fs";

const CLAUDE_DIR = join(process.env.HOME!, ".claude");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");
const OUTPUT_DIR = join(process.cwd(), "output", "parsed_conversations");

// Patterns that indicate user is correcting the assistant
const CORRECTION_PATTERNS = [
  /^no[,.\s!]/i,
  /that's (wrong|not right|incorrect|not what)/i,
  /actually[,\s]/i,
  /not quite/i,
  /you (missed|forgot|should have|shouldn't have|didn't)/i,
  /instead[,\s]/i,
  /fix (this|that|it)/i,
  /wrong/i,
  /incorrect/i,
  /that's not/i,
  /don't (do|use|add)/i,
  /stop/i,
  /I said/i,
  /I meant/i,
  /I asked for/i,
  /not what I/i,
  /try again/i,
  /redo/i,
  /revert/i,
  /undo/i,
];

// Patterns that indicate success/acceptance
const SUCCESS_PATTERNS = [
  /^(great|perfect|excellent|awesome|nice|good|thanks|thank you)[!.\s,]/i,
  /that('s| is) (great|perfect|exactly|what I)/i,
  /looks good/i,
  /well done/i,
  /love it/i,
  /this works/i,
  /exactly what/i,
  /^yes[!.\s,]/i,
  /nice work/i,
  /good job/i,
];

interface Message {
  type: "user" | "assistant";
  content: string;
  timestamp: string;
  uuid: string;
}

interface Exchange {
  sessionId: string;
  project: string;
  userMessage: Message;
  assistantMessage: Message;
  classification: "correction" | "success" | "neutral";
  matchedPattern?: string;
}

function extractTextContent(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block.type === "text") return block.text;
        if (block.type === "tool_use") return `[Tool: ${block.name}]`;
        if (block.type === "tool_result") {
          const text = typeof block.content === "string"
            ? block.content
            : JSON.stringify(block.content);
          return `[Tool Result: ${text.slice(0, 500)}...]`;
        }
        return "";
      })
      .join("\n");
  }
  return JSON.stringify(content);
}

function classifyUserMessage(text: string): { classification: "correction" | "success" | "neutral"; pattern?: string } {
  const lowerText = text.toLowerCase().trim();

  // Check for corrections first (they're more specific signals)
  for (const pattern of CORRECTION_PATTERNS) {
    if (pattern.test(text)) {
      return { classification: "correction", pattern: pattern.source };
    }
  }

  // Then check for success patterns
  for (const pattern of SUCCESS_PATTERNS) {
    if (pattern.test(text)) {
      return { classification: "success", pattern: pattern.source };
    }
  }

  return { classification: "neutral" };
}

async function parseConversationFile(filePath: string, projectName: string): Promise<Exchange[]> {
  const exchanges: Exchange[] = [];
  const content = await readFile(filePath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);

  const messages: any[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === "user" || parsed.type === "assistant") {
        messages.push(parsed);
      }
    } catch (e) {
      // Skip malformed lines
    }
  }

  // Find user messages that follow assistant messages (potential feedback)
  for (let i = 1; i < messages.length; i++) {
    const current = messages[i];
    const previous = messages[i - 1];

    // We want: assistant message followed by user message
    if (previous.type === "assistant" && current.type === "user") {
      const userContent = extractTextContent(current.message?.content);
      const assistantContent = extractTextContent(previous.message?.content);

      // Skip very short messages or tool results
      if (userContent.length < 5 || userContent.startsWith("[Tool")) continue;
      if (assistantContent.length < 10) continue;

      const { classification, pattern } = classifyUserMessage(userContent);

      // Only keep corrections and successes for now
      if (classification !== "neutral") {
        exchanges.push({
          sessionId: current.sessionId || basename(filePath, ".jsonl"),
          project: projectName,
          userMessage: {
            type: "user",
            content: userContent,
            timestamp: current.timestamp,
            uuid: current.uuid,
          },
          assistantMessage: {
            type: "assistant",
            content: assistantContent,
            timestamp: previous.timestamp,
            uuid: previous.uuid,
          },
          classification,
          matchedPattern: pattern,
        });
      }
    }
  }

  return exchanges;
}

async function main() {
  console.log("🔍 Parsing Claude Code conversations...\n");

  // Create output directories
  await mkdir(join(OUTPUT_DIR, "corrections"), { recursive: true });
  await mkdir(join(OUTPUT_DIR, "successes"), { recursive: true });

  const allExchanges: Exchange[] = [];

  // Get all project directories
  const projectDirs = await readdir(PROJECTS_DIR);

  for (const projectDir of projectDirs) {
    if (projectDir.startsWith(".")) continue;

    const projectPath = join(PROJECTS_DIR, projectDir);
    const files = await readdir(projectPath);

    // Get all .jsonl files (conversation sessions)
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

    console.log(`📁 ${projectDir}: ${jsonlFiles.length} sessions`);

    for (const jsonlFile of jsonlFiles) {
      try {
        const exchanges = await parseConversationFile(
          join(projectPath, jsonlFile),
          projectDir
        );
        allExchanges.push(...exchanges);
      } catch (e) {
        // Skip files that can't be parsed
      }
    }
  }

  // Separate by classification
  const corrections = allExchanges.filter((e) => e.classification === "correction");
  const successes = allExchanges.filter((e) => e.classification === "success");

  console.log(`\n📊 Results:`);
  console.log(`   Corrections: ${corrections.length}`);
  console.log(`   Successes: ${successes.length}`);

  // Save to files
  let correctionIndex = 0;
  for (const exchange of corrections) {
    const filename = `${String(correctionIndex++).padStart(4, "0")}_${exchange.sessionId.slice(0, 8)}.json`;
    await writeFile(
      join(OUTPUT_DIR, "corrections", filename),
      JSON.stringify(exchange, null, 2)
    );
  }

  let successIndex = 0;
  for (const exchange of successes) {
    const filename = `${String(successIndex++).padStart(4, "0")}_${exchange.sessionId.slice(0, 8)}.json`;
    await writeFile(
      join(OUTPUT_DIR, "successes", filename),
      JSON.stringify(exchange, null, 2)
    );
  }

  // Save summary
  const summary = {
    totalExchanges: allExchanges.length,
    corrections: corrections.length,
    successes: successes.length,
    correctionPatterns: [...new Set(corrections.map((c) => c.matchedPattern))],
    successPatterns: [...new Set(successes.map((s) => s.matchedPattern))],
    projectBreakdown: {} as Record<string, { corrections: number; successes: number }>,
  };

  for (const exchange of allExchanges) {
    if (!summary.projectBreakdown[exchange.project]) {
      summary.projectBreakdown[exchange.project] = { corrections: 0, successes: 0 };
    }
    summary.projectBreakdown[exchange.project][exchange.classification === "correction" ? "corrections" : "successes"]++;
  }

  await writeFile(
    join(OUTPUT_DIR, "summary.json"),
    JSON.stringify(summary, null, 2)
  );

  console.log(`\n✅ Saved to ${OUTPUT_DIR}`);
  console.log(`   - corrections/ (${corrections.length} files)`);
  console.log(`   - successes/ (${successes.length} files)`);
  console.log(`   - summary.json`);
}

main().catch(console.error);
