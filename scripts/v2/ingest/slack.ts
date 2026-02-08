/**
 * Slack data ingestion module for the v2 pipeline.
 *
 * Exports pure transform functions that accept raw Slack data
 * (fetched via Zapier MCP) and return SlackThreadArtifact objects.
 *
 * Zapier MCP actions used during interactive pipeline runs:
 *   - slack / message           (execute_search_action) — Find Message by query
 *   - slack / get_conversation  (execute_search_action) — Get Conversation info
 *   - slack / get_message       (execute_search_action) — Get Message by timestamp
 */

import type {
  SlackThreadArtifact,
  SlackMessage,
} from "../../../src/types/benchmark-v2";

// ---------------------------------------------------------------------------
// Raw data shapes (what Zapier MCP returns)
// ---------------------------------------------------------------------------

/** Shape of a raw Slack message from Zapier's Find Message action */
export interface RawSlackMessage {
  text?: string;
  user?: string;
  username?: string;
  real_name?: string;
  ts?: string;
  thread_ts?: string;
  channel?: string;
  channel_name?: string;
  [key: string]: unknown;
}

/** A pre-grouped thread of raw Slack messages */
export interface RawSlackThread {
  channel: string;
  messages: Array<{
    author: string;
    text: string;
    timestamp: string;
    threadReply?: boolean;
  }>;
}

// ---------------------------------------------------------------------------
// Transform functions
// ---------------------------------------------------------------------------

/** Minimum number of messages for a thread to be included */
const MIN_MESSAGES_PER_THREAD = 2;

/**
 * Transform pre-grouped Slack threads into SlackThreadArtifact objects.
 * Only includes threads with 2+ messages.
 *
 * @param dealId - The v2 deal codename ID (e.g. "velocity-systems")
 * @param rawThreads - Pre-grouped thread objects
 */
export function transformSlackThreads(
  dealId: string,
  rawThreads: RawSlackThread[],
): SlackThreadArtifact[] {
  return rawThreads
    .filter((thread) => thread.messages.length >= MIN_MESSAGES_PER_THREAD)
    .map((thread, index) => {
      const messages: SlackMessage[] = thread.messages.map((m) => ({
        author: m.author,
        text: m.text,
        timestamp: normalizeTimestamp(m.timestamp),
        threadReply: m.threadReply,
      }));

      // Sort messages by timestamp
      messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

      // Use earliest message timestamp as createdAt
      const createdAt = messages[0]?.timestamp?.slice(0, 10) ||
        new Date().toISOString().slice(0, 10);

      return {
        id: `${dealId}_slack_${index}`,
        dealId,
        type: "slack_thread" as const,
        createdAt,
        anonymized: false,
        channel: thread.channel,
        messages,
      };
    });
}

/**
 * Transform flat raw Slack messages (from Zapier Find Message) into
 * grouped threads, then into SlackThreadArtifact objects.
 *
 * Groups messages by thread_ts (thread parent timestamp). Messages without
 * thread_ts are treated as standalone threads grouped by channel+date.
 *
 * @param dealId - The v2 deal codename ID
 * @param rawMessages - Flat array of raw Slack messages from Zapier
 */
export function transformRawSlackMessages(
  dealId: string,
  rawMessages: RawSlackMessage[],
): SlackThreadArtifact[] {
  const threadMap = new Map<string, RawSlackThread>();

  for (const raw of rawMessages) {
    const channel = raw.channel_name || raw.channel || "unknown";
    const author = raw.real_name || raw.username || raw.user || "unknown";
    const text = raw.text || "";
    const ts = raw.ts || "";

    // Group by thread_ts if available, otherwise by channel + day
    const threadKey = raw.thread_ts
      ? `${channel}:${raw.thread_ts}`
      : `${channel}:${tsToDate(ts)}`;

    if (!threadMap.has(threadKey)) {
      threadMap.set(threadKey, {
        channel,
        messages: [],
      });
    }

    const thread = threadMap.get(threadKey)!;
    thread.messages.push({
      author,
      text,
      timestamp: tsToIso(ts),
      threadReply: raw.thread_ts ? ts !== raw.thread_ts : false,
    });
  }

  // Sort threads by earliest message
  const sortedThreads = Array.from(threadMap.values()).sort((a, b) => {
    const aFirst = a.messages[0]?.timestamp || "";
    const bFirst = b.messages[0]?.timestamp || "";
    return aFirst.localeCompare(bFirst);
  });

  return transformSlackThreads(dealId, sortedThreads);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert Slack timestamp (Unix epoch with microseconds, e.g. "1706640000.000100")
 * to ISO date string.
 */
function tsToIso(ts: string): string {
  if (!ts) return "";
  // Already ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(ts)) return ts;
  // Slack ts format: seconds.microseconds
  const seconds = parseFloat(ts);
  if (!isNaN(seconds)) {
    return new Date(seconds * 1000).toISOString();
  }
  return ts;
}

/** Extract YYYY-MM-DD from a Slack timestamp */
function tsToDate(ts: string): string {
  const iso = tsToIso(ts);
  return iso.slice(0, 10);
}

/** Normalize a timestamp to ISO format */
function normalizeTimestamp(ts: string): string {
  if (!ts) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(ts)) return ts;
  const seconds = parseFloat(ts);
  if (!isNaN(seconds) && seconds > 1e9) {
    return new Date(seconds * 1000).toISOString();
  }
  return ts;
}
