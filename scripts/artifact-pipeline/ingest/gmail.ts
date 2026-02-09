/**
 * Gmail data ingestion module for the artifact-based pipeline.
 *
 * Exports pure transform functions that accept raw Gmail thread data
 * (fetched via Zapier MCP) and return EmailArtifact objects.
 *
 * Zapier MCP actions used during interactive pipeline runs:
 *   - gmail / message (execute_search_action) — Find Email by query
 */

import type {
  EmailArtifact,
  EmailMessage,
} from "../../../src/types/benchmark-artifact";

// ---------------------------------------------------------------------------
// Raw data shapes (what Zapier MCP returns)
// ---------------------------------------------------------------------------

/** Shape of a raw Gmail message from Zapier's Find Email action */
export interface RawGmailMessage {
  from?: string;
  to?: string | string[];
  cc?: string | string[];
  date?: string;
  body_plain?: string;
  body?: string;
  subject?: string;
  thread_id?: string;
  id?: string;
  [key: string]: unknown;
}

/** A pre-grouped thread of raw Gmail messages */
export interface RawGmailThread {
  subject: string;
  threadId?: string;
  messages: Array<{
    from: string;
    to: string[];
    cc?: string[];
    date: string;
    body: string;
  }>;
}

// ---------------------------------------------------------------------------
// Transform functions
// ---------------------------------------------------------------------------

/** Maximum number of email threads to include per deal */
const MAX_THREADS_PER_DEAL = 10;

/**
 * Transform pre-grouped Gmail threads into EmailArtifact objects.
 *
 * @param dealId - The deal codename ID (e.g. "velocity-systems")
 * @param rawThreads - Pre-grouped thread objects
 */
export function transformGmailThreads(
  dealId: string,
  rawThreads: RawGmailThread[],
): EmailArtifact[] {
  return rawThreads
    .slice(0, MAX_THREADS_PER_DEAL)
    .map((thread, index) => {
      const messages: EmailMessage[] = thread.messages.map((m) => ({
        from: m.from,
        to: m.to,
        cc: m.cc?.length ? m.cc : undefined,
        date: normalizeDate(m.date),
        body: m.body,
      }));

      // Extract unique participants from all messages
      const participantSet = new Set<string>();
      for (const msg of messages) {
        participantSet.add(msg.from);
        for (const to of msg.to) participantSet.add(to);
        if (msg.cc) {
          for (const cc of msg.cc) participantSet.add(cc);
        }
      }

      // Use the earliest message date as createdAt
      const sortedDates = messages
        .map((m) => m.date)
        .filter(Boolean)
        .sort();
      const createdAt = sortedDates[0] || new Date().toISOString().slice(0, 10);

      return {
        id: `${dealId}_email_${index}`,
        dealId,
        type: "email" as const,
        createdAt,
        anonymized: false,
        subject: thread.subject,
        messages,
        participants: Array.from(participantSet),
      };
    });
}

/**
 * Transform flat raw Gmail messages (from Zapier Find Email) into
 * pre-grouped threads, then into EmailArtifact objects.
 *
 * Groups messages by thread_id if available, otherwise by subject line.
 *
 * @param dealId - The deal codename ID
 * @param rawMessages - Flat array of raw Gmail messages from Zapier
 */
export function transformRawGmailMessages(
  dealId: string,
  rawMessages: RawGmailMessage[],
): EmailArtifact[] {
  const threadMap = new Map<string, RawGmailThread>();

  for (const raw of rawMessages) {
    const subject = raw.subject || "(no subject)";
    const groupKey = raw.thread_id || normalizeSubject(subject);

    if (!threadMap.has(groupKey)) {
      threadMap.set(groupKey, {
        subject,
        threadId: raw.thread_id || undefined,
        messages: [],
      });
    }

    const thread = threadMap.get(groupKey)!;
    thread.messages.push({
      from: raw.from || "unknown",
      to: parseRecipients(raw.to),
      cc: raw.cc ? parseRecipients(raw.cc) : undefined,
      date: raw.date || "",
      body: raw.body_plain || raw.body || "",
    });
  }

  // Sort messages within each thread by date
  for (const thread of threadMap.values()) {
    thread.messages.sort((a, b) => a.date.localeCompare(b.date));
  }

  // Sort threads by most recent message
  const sortedThreads = Array.from(threadMap.values()).sort((a, b) => {
    const aLatest = a.messages[a.messages.length - 1]?.date || "";
    const bLatest = b.messages[b.messages.length - 1]?.date || "";
    return bLatest.localeCompare(aLatest); // most recent first
  });

  return transformGmailThreads(dealId, sortedThreads);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse recipients from a string or array */
function parseRecipients(raw: string | string[] | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  // Split on comma, handling "Name <email>" format
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Normalize subject line for grouping (strip Re:/Fwd: prefixes) */
function normalizeSubject(subject: string): string {
  return subject
    .replace(/^(re|fwd|fw):\s*/gi, "")
    .trim()
    .toLowerCase();
}

/** Normalize a date string to ISO format */
function normalizeDate(dateStr: string): string {
  if (!dateStr) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.slice(0, 10);
  }
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return dateStr;
}
