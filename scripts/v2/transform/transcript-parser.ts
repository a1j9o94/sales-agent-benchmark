/**
 * Granola AI Markdown Transcript Parser
 *
 * Parses Granola-exported markdown transcripts into structured
 * TranscriptArtifact-compatible objects.
 *
 * Handles two observed Granola formats:
 *  1. Minimal: `# Title`, `**Date:**`, `**Participants:**`, notes, `## Full Transcript`
 *  2. Detailed: `# Title`, `## Meeting Details` with metadata, `## My Notes`, `## Meeting Notes`, `## Full Transcript`
 */

import type { TranscriptTurn } from "../../../src/types/benchmark-v2";

export interface ParsedTranscript {
  title: string;
  date: string; // ISO date
  attendees: string[];
  turns: TranscriptTurn[];
  keyTakeaways: string[];
  rawText: string;
  duration?: number; // estimated in minutes if possible
}

/**
 * Parse a Granola AI markdown transcript into a structured object.
 */
export function parseGranolaTranscript(
  markdownContent: string,
  sourceFile?: string,
): ParsedTranscript {
  const rawText = markdownContent;
  const lines = markdownContent.split("\n");

  const title = extractTitle(lines);
  const date = extractDate(lines);
  const attendees = extractAttendees(lines);
  const turns = extractTurns(lines);
  const keyTakeaways = extractKeyTakeaways(lines);
  const duration = estimateDuration(turns);

  return {
    title,
    date,
    attendees,
    turns,
    keyTakeaways,
    rawText,
    ...(duration !== undefined && { duration }),
  };
}

// ---------------------------------------------------------------------------
// Title
// ---------------------------------------------------------------------------

function extractTitle(lines: string[]): string {
  for (const line of lines) {
    const match = line.match(/^#\s+(.+)/);
    if (match?.[1]) return match[1].trim();
  }
  return "Untitled Meeting";
}

// ---------------------------------------------------------------------------
// Date
// ---------------------------------------------------------------------------

function extractDate(lines: string[]): string {
  for (const line of lines) {
    // Match **Date & Time:** or **Date:**
    const match = line.match(/\*\*Date(?:\s*&\s*Time)?\s*:\*\*\s*(.+)/i);
    if (match?.[1]) {
      return parseNaturalDate(match[1].trim());
    }
  }
  return "";
}

/**
 * Convert natural-language date strings into ISO date format.
 *
 * Handles:
 *  - "November 20, 2025"
 *  - "Wednesday, January 21, 2026 at 9:30 PM UTC"
 *  - Already ISO strings (pass through)
 */
function parseNaturalDate(raw: string): string {
  // If it already looks like ISO, return as-is
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw;

  // Strip day-of-week prefix ("Wednesday, ")
  const cleaned = raw.replace(/^[A-Z][a-z]+,\s*/, "");

  // Try native Date parsing (handles "January 21, 2026 at 9:30 PM UTC")
  const normalized = cleaned.replace(/\s+at\s+/i, " ");
  const parsed = new Date(normalized);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split("T")[0] ?? raw;
  }

  // Fallback: return raw string
  return raw;
}

// ---------------------------------------------------------------------------
// Attendees
// ---------------------------------------------------------------------------

function extractAttendees(lines: string[]): string[] {
  // Format 1: **Participants:** inline
  for (const line of lines) {
    const match = line.match(/\*\*Participants?\s*:\*\*\s*(.+)/i);
    if (match?.[1]) {
      return parseParticipantLine(match[1]);
    }
  }

  // Format 2: ### Attendees followed by bullet list
  const attendeeSectionIdx = lines.findIndex((l) =>
    /^###?\s*Attendees/i.test(l),
  );
  if (attendeeSectionIdx !== -1) {
    return parseAttendeeBulletList(lines, attendeeSectionIdx + 1);
  }

  // Format 3: **Organizer:** line (pick up at least the organizer)
  const attendees: string[] = [];
  for (const line of lines) {
    const orgMatch = line.match(/\*\*Organizer\s*:\*\*\s*(.+)/i);
    if (orgMatch) {
      const name = orgMatch[1]!.replace(/\s*\(.*?\)\s*/g, "").trim();
      if (name) attendees.push(name);
    }
  }
  return attendees;
}

/**
 * Parse "Name1 (Role, Org), Name2 (Role, Org), Name3 (Alias, Org)"
 */
function parseParticipantLine(raw: string): string[] {
  // Split on commas that are NOT inside parentheses
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of raw) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());

  return parts
    .map((p) => {
      // Extract just the name, stripping parenthetical roles
      const name = p.replace(/\s*\(.*?\)\s*/g, "").trim();
      return name;
    })
    .filter(Boolean);
}

/**
 * Parse bullet-list attendees:
 *   - **Name** (email)
 *   - **Name** (email)
 */
function parseAttendeeBulletList(lines: string[], startIdx: number): string[] {
  const attendees: string[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Stop at next section heading or blank line followed by heading
    if (/^#{1,3}\s/.test(line)) break;
    if (line.trim() === "" && i + 1 < lines.length && /^#{1,3}\s/.test(lines[i + 1] ?? "")) break;

    const bulletMatch = line.match(
      /^-\s+\*\*(.+?)\*\*(?:\s*\((.+?)\))?/,
    );
    if (bulletMatch?.[1]) {
      attendees.push(bulletMatch[1].trim());
      continue;
    }
    // Plain bullet
    const plainBullet = line.match(/^-\s+(.+)/);
    if (plainBullet?.[1]) {
      const name = plainBullet[1].replace(/\s*\(.*?\)\s*/g, "").trim();
      if (name) attendees.push(name);
    }
  }
  return attendees;
}

// ---------------------------------------------------------------------------
// Transcript Turns
// ---------------------------------------------------------------------------

function extractTurns(lines: string[]): TranscriptTurn[] {
  // Find the "Full Transcript" section
  const transcriptIdx = lines.findIndex((l) =>
    /^#{1,3}\s*Full\s+Transcript/i.test(l),
  );

  const startIdx = transcriptIdx !== -1 ? transcriptIdx + 1 : 0;

  // If no explicit transcript section, scan for the first Me:/Them: pattern
  let scanStart = startIdx;
  if (transcriptIdx === -1) {
    scanStart = lines.findIndex((l) => /^(Me|Them)\s*:/i.test(l.trim()));
    if (scanStart === -1) return []; // No transcript content
  }

  const turns: TranscriptTurn[] = [];
  let currentSpeaker: "me" | "them" | null = null;
  let currentText = "";

  for (let i = scanStart; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // Stop at footer separator or Granola link
    if (/^---\s*$/.test(line.trim())) break;
    if (/View in Granola/i.test(line)) break;
    if (/Chat with meeting transcript/i.test(line)) break;

    // Check for speaker switch
    const speakerMatch = line.match(/^(Me|Them)\s*:\s*(.*)/i);
    if (speakerMatch) {
      // Flush previous turn
      if (currentSpeaker && currentText.trim()) {
        turns.push({
          speaker: currentSpeaker,
          text: currentText.trim(),
        });
      }
      currentSpeaker = (speakerMatch[1] ?? "me").toLowerCase() as "me" | "them";
      currentText = speakerMatch[2] ?? "";
    } else if (currentSpeaker) {
      // Continuation line
      const trimmed = line.trim();
      if (trimmed) {
        currentText += (currentText ? " " : "") + trimmed;
      }
    }
  }

  // Flush last turn
  if (currentSpeaker && currentText.trim()) {
    turns.push({
      speaker: currentSpeaker,
      text: currentText.trim(),
    });
  }

  return turns;
}

// ---------------------------------------------------------------------------
// Key Takeaways
// ---------------------------------------------------------------------------

function extractKeyTakeaways(lines: string[]): string[] {
  // Find a "Key Takeaways" heading
  const takeawayIdx = lines.findIndex((l) =>
    /^#{1,3}\s*Key\s+Takeaways?/i.test(l),
  );
  if (takeawayIdx === -1) return [];

  const takeaways: string[] = [];

  for (let i = takeawayIdx + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // Stop at next same-level or higher heading (## or #)
    if (/^#{1,2}\s/.test(line) && !/^###/.test(line)) break;
    // Also stop at the full transcript section
    if (/^#{1,3}\s*Full\s+Transcript/i.test(line)) break;

    // Sub-headings (### ) become takeaway group headers
    const subHeading = line.match(/^###\s+(.+)/);
    if (subHeading) {
      // We don't add the sub-heading itself, but bullets under it
      continue;
    }

    // Top-level bullet points
    const bullet = line.match(/^-\s+(.+)/);
    if (bullet?.[1]) {
      takeaways.push(bullet[1].trim());
    }
  }

  return takeaways;
}

// ---------------------------------------------------------------------------
// Duration Estimation
// ---------------------------------------------------------------------------

/**
 * Estimate meeting duration from turn count and text length.
 * Average speaking rate ~130 words/min. Split between speakers.
 */
function estimateDuration(turns: TranscriptTurn[]): number | undefined {
  if (turns.length === 0) return undefined;

  const totalWords = turns.reduce(
    (sum, t) => sum + t.text.split(/\s+/).length,
    0,
  );

  // ~130 words/min spoken, but transcript is just one person's words at a time
  // and there are pauses, so ~100 words/min is a reasonable estimate
  const estimated = Math.round(totalWords / 100);
  return estimated > 0 ? estimated : undefined;
}
