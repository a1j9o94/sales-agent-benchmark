#!/usr/bin/env bun
/**
 * Anonymize parsed conversation data for use as benchmark scenarios.
 *
 * Replaces:
 * - Company names -> fictional alternatives
 * - People names -> fictional names (preserving titles)
 * - Email addresses -> example.com addresses
 * - Phone numbers -> 555-XXX-XXXX format
 * - Dollar amounts -> rounded values
 * - File paths -> generic paths
 * - Internal URLs -> placeholder URLs
 *
 * Uses an LLM to intelligently identify and replace entities while
 * preserving the sales context and dynamics.
 */

import { readdir, readFile, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

const INPUT_DIR = join(process.cwd(), "output", "parsed_conversations");
const OUTPUT_DIR = join(process.cwd(), "output", "anonymized");

const ANONYMIZE_PROMPT = `You are an anonymization tool for sales conversation data. Your job is to remove all identifying information while preserving the sales dynamics and context.

## Replace these types of information:

1. **Company names** -> Replace with realistic fictional alternatives that preserve the industry
   - Keep industry similar (biotech stays biotech, fintech stays fintech)
   - Use believable fictional names (e.g., "Flagship Pioneering" -> "Horizon Therapeutics")

2. **People names** -> Replace with fictional names
   - Preserve titles and roles (e.g., "Fred Chen, CIO" -> "Michael Park, CIO")
   - Keep gender indicators if apparent

3. **Email addresses** -> Replace with @example.com format
   - fred@flagship.com -> michael@horizonbio.example.com

4. **Phone numbers** -> Replace with 555-XXX-XXXX format

5. **Dollar amounts** -> Round to nearest reasonable increment
   - $47,500 -> $50,000
   - $1.2M -> $1M

6. **File paths** -> Replace with generic paths
   - /Users/adrianobleton/sales-workspace/deals/flagship -> /workspace/deals/acme

7. **URLs** -> Replace with placeholder URLs
   - Keep the structure but use example.com or placeholder domains

8. **Dates** -> Keep relative timing but shift by random offset
   - "Jan 29" -> "Feb 15" (same rough timing, different dates)

9. **Internal jargon or product names** -> Replace with generic equivalents if they identify the company

## Preserve:
- Sales dynamics (blockers, champions, objections)
- Deal stages and progression
- Emotional tone and urgency
- Role relationships
- Industry context
- MEDDPICC elements

## Output format:
Return a JSON object with:
{
  "anonymized": {
    "userMessage": "anonymized user message",
    "assistantMessage": "anonymized assistant message"
  },
  "replacements": [
    {"original": "Flagship Pioneering", "replacement": "Horizon Therapeutics", "type": "company"},
    {"original": "Fred Chen", "replacement": "Michael Park", "type": "person"}
  ],
  "metadata": {
    "industry": "detected industry",
    "dealStage": "detected deal stage",
    "dynamics": "brief description of sales dynamics"
  }
}

Important: Return ONLY valid JSON, no markdown code blocks or other formatting.`;

interface Exchange {
  sessionId: string;
  project: string;
  userMessage: { content: string };
  assistantMessage: { content: string };
  classification: string;
  matchedPattern?: string;
}

interface AnonymizedExchange {
  original: Exchange;
  anonymized: {
    userMessage: string;
    assistantMessage: string;
  };
  replacements: Array<{ original: string; replacement: string; type: string }>;
  metadata: {
    industry: string;
    dealStage: string;
    dynamics: string;
  };
}

async function anonymizeExchange(exchange: Exchange): Promise<AnonymizedExchange | null> {
  const input = `## User Message:
${exchange.userMessage.content}

## Assistant Message:
${exchange.assistantMessage.content.slice(0, 4000)}`;

  try {
    const result = await generateText({
      model: anthropic("claude-3-5-haiku-20241022"),
      system: ANONYMIZE_PROMPT,
      prompt: input,
    });

    // Parse the response
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("No JSON found in response");
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      original: exchange,
      ...parsed,
    };
  } catch (error) {
    console.error("Error anonymizing exchange:", error);
    return null;
  }
}

// Simple rule-based anonymization as fallback (no API needed)
function anonymizeSimple(text: string): { text: string; replacements: string[] } {
  const replacements: string[] = [];
  let result = text;

  // Email addresses
  result = result.replace(/[\w.-]+@[\w.-]+\.\w+/g, (match) => {
    replacements.push(`Email: ${match}`);
    return "user@company.example.com";
  });

  // Phone numbers
  result = result.replace(/(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, (match) => {
    replacements.push(`Phone: ${match}`);
    return "555-XXX-XXXX";
  });

  // File paths with usernames
  result = result.replace(/\/Users\/[\w-]+/g, "/Users/username");
  result = result.replace(/\/home\/[\w-]+/g, "/home/username");

  // Dollar amounts (keep rough magnitude)
  result = result.replace(/\$[\d,]+(\.\d{2})?([KMB])?/gi, (match) => {
    replacements.push(`Amount: ${match}`);
    // Round to simpler numbers
    const num = parseFloat(match.replace(/[$,KMB]/gi, ""));
    if (match.includes("M")) return "$X.XM";
    if (match.includes("K")) return "$XXK";
    if (num > 100000) return "$XXX,XXX";
    if (num > 10000) return "$XX,XXX";
    return "$X,XXX";
  });

  // URLs
  result = result.replace(/https?:\/\/[^\s<>"]+/g, (match) => {
    replacements.push(`URL: ${match}`);
    return "https://example.com/...";
  });

  return { text: result, replacements };
}

async function main() {
  const args = process.argv.slice(2);
  const useLLM = args.includes("--llm");
  const limit = parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "0") || Infinity;

  console.log(`🔐 Anonymizing conversation data...`);
  console.log(`   Mode: ${useLLM ? "LLM-powered" : "Rule-based"}`);
  if (limit < Infinity) console.log(`   Limit: ${limit} files`);
  console.log();

  // Create output directories
  await mkdir(join(OUTPUT_DIR, "corrections"), { recursive: true });
  await mkdir(join(OUTPUT_DIR, "successes"), { recursive: true });

  const categories = ["corrections", "successes"];
  let totalProcessed = 0;

  for (const category of categories) {
    const inputPath = join(INPUT_DIR, category);
    const outputPath = join(OUTPUT_DIR, category);

    let files: string[];
    try {
      files = await readdir(inputPath);
    } catch {
      console.log(`   Skipping ${category} (no files)`);
      continue;
    }

    const jsonFiles = files.filter((f) => f.endsWith(".json")).slice(0, limit);
    console.log(`📁 Processing ${category}: ${jsonFiles.length} files`);

    let processed = 0;
    for (const file of jsonFiles) {
      if (totalProcessed >= limit) break;

      try {
        const content = await readFile(join(inputPath, file), "utf-8");
        const exchange: Exchange = JSON.parse(content);

        let anonymized: any;

        if (useLLM) {
          anonymized = await anonymizeExchange(exchange);
          if (!anonymized) continue;
        } else {
          // Simple rule-based anonymization
          const userAnon = anonymizeSimple(exchange.userMessage.content);
          const assistantAnon = anonymizeSimple(exchange.assistantMessage.content);

          anonymized = {
            original: {
              classification: exchange.classification,
              matchedPattern: exchange.matchedPattern,
              project: exchange.project.replace(/adrianobleton/gi, "user"),
            },
            anonymized: {
              userMessage: userAnon.text,
              assistantMessage: assistantAnon.text,
            },
            replacements: [...userAnon.replacements, ...assistantAnon.replacements],
            metadata: {
              industry: "unknown",
              dealStage: "unknown",
              dynamics: "See conversation for context",
            },
          };
        }

        await writeFile(
          join(outputPath, file),
          JSON.stringify(anonymized, null, 2)
        );

        processed++;
        totalProcessed++;

        if (processed % 10 === 0) {
          console.log(`   Processed ${processed}/${jsonFiles.length}`);
        }
      } catch (error) {
        console.error(`   Error processing ${file}:`, error);
      }
    }

    console.log(`   ✅ Completed: ${processed} files\n`);
  }

  console.log(`\n✅ Anonymization complete!`);
  console.log(`   Output: ${OUTPUT_DIR}`);
  console.log(`   Total processed: ${totalProcessed}`);
  console.log(`\nTo use LLM-powered anonymization (better quality):`);
  console.log(`   bun scripts/anonymize.ts --llm --limit=10`);
}

main().catch(console.error);
