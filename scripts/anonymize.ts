#!/usr/bin/env bun
/**
 * Anonymize parsed conversation data for use as benchmark scenarios.
 *
 * This script has two modes:
 * 1. Rule-based (default): Fast, uses pattern matching and known entity lists
 * 2. LLM-powered (--llm): Uses Claude to intelligently identify and replace entities
 */

import { readdir, readFile, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

const INPUT_DIR = join(process.cwd(), "output", "parsed_conversations");
const OUTPUT_DIR = join(process.cwd(), "output", "anonymized");

// Known companies to replace (add more as needed)
const COMPANY_REPLACEMENTS: Record<string, string> = {
  // Real -> Fictional
  "zapier": "AutomateFlow",
  "workato": "IntegrateHub",
  "flagship": "Horizon",
  "flagship pioneering": "Horizon Ventures",
  "recursion": "BioCompute",
  "recursion pharmaceuticals": "BioCompute Therapeutics",
  "hubspot": "SalesCloud",
  "salesforce": "CRMPlatform",
  "slack": "TeamChat",
  "microsoft": "TechCorp",
  "google": "SearchCo",
  "coupa": "ProcureSoft",
  "brandfolder": "AssetHub",
  "make": "FlowBuilder",
  "tray": "DataPipe",
  "n8n": "NodeFlow",
  "airtable": "GridBase",
  "notion": "DocSpace",
};

// Known person names to replace (add more as needed)
const PERSON_REPLACEMENTS: Record<string, string> = {
  "adrian": "Alex",
  "sam": "Jordan",
  "amy": "Sarah",
  "feng": "David",
  "bryan": "Mike",
  "fred": "Robert",
  "sonya": "Lisa",
  "derek": "Kevin",
  "julia": "Emma",
  "emily": "Rachel",
  "paul": "James",
  "adrianobleton": "asmith",
  "obleton": "smith",
};

// Product/feature names that could identify the company
const PRODUCT_REPLACEMENTS: Record<string, string> = {
  "meddpicc": "SALES-QUAL",
  "zap": "automation",
  "zaps": "automations",
  "zapier central": "AutomateFlow Hub",
  "zapier agents": "AutomateFlow Agents",
  "copilot": "AI Assistant",
  "chatgpt": "AI Chat",
  "claude": "AI Assistant",
};

interface Exchange {
  sessionId: string;
  project: string;
  userMessage: { content: string };
  assistantMessage: { content: string };
  classification: string;
  matchedPattern?: string;
}

function anonymizeText(text: string): { text: string; replacements: string[] } {
  const replacements: string[] = [];
  let result = text;

  // 1. Replace company names (case-insensitive, whole word)
  for (const [real, fake] of Object.entries(COMPANY_REPLACEMENTS)) {
    const regex = new RegExp(`\\b${real}\\b`, "gi");
    if (regex.test(result)) {
      replacements.push(`Company: ${real} -> ${fake}`);
      result = result.replace(regex, fake);
    }
  }

  // 2. Replace person names (case-insensitive, whole word)
  for (const [real, fake] of Object.entries(PERSON_REPLACEMENTS)) {
    const regex = new RegExp(`\\b${real}\\b`, "gi");
    if (regex.test(result)) {
      replacements.push(`Person: ${real} -> ${fake}`);
      result = result.replace(regex, fake);
    }
  }

  // 3. Replace product names
  for (const [real, fake] of Object.entries(PRODUCT_REPLACEMENTS)) {
    const regex = new RegExp(`\\b${real}\\b`, "gi");
    if (regex.test(result)) {
      replacements.push(`Product: ${real} -> ${fake}`);
      result = result.replace(regex, fake);
    }
  }

  // 4. Email addresses
  result = result.replace(/[\w.-]+@[\w.-]+\.\w+/g, (match) => {
    replacements.push(`Email: ${match}`);
    return "user@company.example.com";
  });

  // 5. Phone numbers
  result = result.replace(/(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, (match) => {
    replacements.push(`Phone: ${match}`);
    return "555-XXX-XXXX";
  });

  // 6. File paths with usernames
  result = result.replace(/\/Users\/[\w-]+/g, "/Users/username");
  result = result.replace(/\/home\/[\w-]+/g, "/home/username");

  // 7. Dollar amounts (round to simpler numbers)
  result = result.replace(/\$[\d,]+(\.\d{2})?([KMB])?/gi, (match) => {
    replacements.push(`Amount: ${match}`);
    const num = parseFloat(match.replace(/[$,KMB]/gi, ""));
    if (match.toLowerCase().includes("m")) return "$X.XM";
    if (match.toLowerCase().includes("k")) return "$XXK";
    if (num > 100000) return "$XXX,XXX";
    if (num > 10000) return "$XX,XXX";
    if (num > 1000) return "$X,XXX";
    return "$XXX";
  });

  // 8. URLs (but keep structure)
  result = result.replace(/https?:\/\/[^\s<>"]+/g, (match) => {
    if (match.includes("example.com")) return match; // Already anonymized
    replacements.push(`URL: ${match}`);
    return "https://example.com/...";
  });

  // 9. Specific date patterns (Jan 29, February 18, etc.) - shift slightly
  result = result.replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}\b/gi, (match) => {
    replacements.push(`Date: ${match}`);
    return "[DATE]";
  });

  // 10. Time patterns (9:30am, 4:30 PM, etc.)
  result = result.replace(/\d{1,2}:\d{2}\s*(am|pm|AM|PM)?(\s*(ET|PT|CT|MT|EST|PST))?/g, "[TIME]");

  return { text: result, replacements: [...new Set(replacements)] };
}

const LLM_ANONYMIZE_PROMPT = `You are an anonymization tool. Replace ALL identifying information while preserving sales context.

CRITICAL: You MUST replace these types of information:
1. ALL company names (real companies -> fictional names)
2. ALL person names (keep titles like "VP of Operations")
3. ALL email addresses -> user@example.com
4. ALL specific dollar amounts -> round numbers like $50K, $100K
5. ALL dates -> generic like "[DATE]" or "next week"
6. ALL URLs -> https://example.com
7. ALL file paths with real usernames

Return ONLY valid JSON:
{
  "anonymized": {
    "userMessage": "fully anonymized user message",
    "assistantMessage": "fully anonymized assistant message"
  },
  "replacements": [
    {"original": "Flagship", "replacement": "Acme Corp", "type": "company"},
    {"original": "Fred Chen", "replacement": "John Smith", "type": "person"}
  ],
  "metadata": {
    "industry": "detected industry",
    "dealStage": "stage in sales cycle",
    "dynamics": "key sales dynamics in 1-2 sentences"
  }
}`;

async function anonymizeWithLLM(exchange: Exchange): Promise<any> {
  const input = `Anonymize this sales conversation:

USER MESSAGE:
${exchange.userMessage.content.slice(0, 3000)}

ASSISTANT MESSAGE:
${exchange.assistantMessage.content.slice(0, 3000)}`;

  try {
    const result = await generateText({
      model: anthropic("claude-3-5-haiku-20241022"),
      system: LLM_ANONYMIZE_PROMPT,
      prompt: input,
    });

    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error("LLM error:", error);
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const useLLM = args.includes("--llm");
  const limit = parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "0") || Infinity;

  console.log(`🔐 Anonymizing conversation data...`);
  console.log(`   Mode: ${useLLM ? "LLM-powered (better quality)" : "Rule-based (fast)"}`);
  if (limit < Infinity) console.log(`   Limit: ${limit} files`);
  console.log();

  await mkdir(join(OUTPUT_DIR, "corrections"), { recursive: true });
  await mkdir(join(OUTPUT_DIR, "successes"), { recursive: true });

  const categories = ["corrections", "successes"];
  let totalProcessed = 0;
  let totalReplacements = 0;

  for (const category of categories) {
    const inputPath = join(INPUT_DIR, category);
    const outputPath = join(OUTPUT_DIR, category);

    let files: string[];
    try {
      files = await readdir(inputPath);
    } catch {
      continue;
    }

    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    const filesToProcess = limit < Infinity ? jsonFiles.slice(0, Math.max(0, limit - totalProcessed)) : jsonFiles;

    console.log(`📁 Processing ${category}: ${filesToProcess.length} files`);

    let processed = 0;
    for (const file of filesToProcess) {
      try {
        const content = await readFile(join(inputPath, file), "utf-8");
        const exchange: Exchange = JSON.parse(content);

        let anonymized: any;

        if (useLLM) {
          const llmResult = await anonymizeWithLLM(exchange);
          if (llmResult) {
            // Don't store replacements - that defeats anonymization
            anonymized = {
              classification: exchange.classification,
              matchedPattern: exchange.matchedPattern,
              userMessage: llmResult.anonymized?.userMessage || "",
              assistantMessage: llmResult.anonymized?.assistantMessage || "",
              metadata: llmResult.metadata,
            };
          }
        }

        // Fallback to rule-based or use it as default
        if (!anonymized) {
          const userAnon = anonymizeText(exchange.userMessage.content);
          const assistantAnon = anonymizeText(exchange.assistantMessage.content);

          // Count replacements but don't store them (that would defeat anonymization)
          const replacementCount = userAnon.replacements.length + assistantAnon.replacements.length;
          totalReplacements += replacementCount;

          anonymized = {
            classification: exchange.classification,
            matchedPattern: exchange.matchedPattern,
            userMessage: userAnon.text,
            assistantMessage: assistantAnon.text,
            replacementCount, // Just the count, not the actual replacements
          };
        }

        await writeFile(join(outputPath, file), JSON.stringify(anonymized, null, 2));
        processed++;
        totalProcessed++;

        if (processed % 20 === 0) {
          console.log(`   Processed ${processed}/${filesToProcess.length}`);
        }
      } catch (error) {
        console.error(`   Error processing ${file}`);
      }
    }

    console.log(`   ✅ Completed: ${processed} files\n`);
  }

  console.log(`\n✅ Anonymization complete!`);
  console.log(`   Output: ${OUTPUT_DIR}`);
  console.log(`   Total files: ${totalProcessed}`);
  console.log(`   Total replacements made: ${totalReplacements}`);
}

main().catch(console.error);
