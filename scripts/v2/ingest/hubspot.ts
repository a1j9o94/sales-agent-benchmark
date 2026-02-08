/**
 * HubSpot data ingestion module for the v2 pipeline.
 *
 * Exports pure transform functions that accept raw HubSpot API data
 * (fetched via Zapier MCP) and return structured CRM artifacts.
 *
 * Zapier MCP actions used during interactive pipeline runs:
 *   - hubspot / deal_crmSearch  (execute_search_action)
 *   - hubspot / contactSearch   (execute_search_action)
 *   - hubspot / ae:496206       (execute_write_action) — Get Notes from Contact
 */

import type {
  CrmSnapshotArtifact,
  CrmActivityEntry,
} from "../../../src/types/benchmark-v2";

// ---------------------------------------------------------------------------
// Raw data shapes (what Zapier MCP returns)
// ---------------------------------------------------------------------------

/** Shape of a raw HubSpot deal from deal_crmSearch */
export interface RawHubSpotDeal {
  dealname?: string;
  dealstage?: string;
  amount?: string;
  closedate?: string;
  pipeline?: string;
  notes_last_updated?: string;
  hs_lastmodifieddate?: string;
  [key: string]: unknown;
}

/** Shape of a raw HubSpot contact from contactSearch */
export interface RawHubSpotContact {
  firstname?: string;
  lastname?: string;
  jobtitle?: string;
  email?: string;
  hubspot_owner_id?: string;
  [key: string]: unknown;
}

/** Shape of a raw HubSpot note from ae:496206 */
export interface RawHubSpotNote {
  hs_note_body?: string;
  hs_timestamp?: string;
  hs_createdate?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Transform result
// ---------------------------------------------------------------------------

export interface HubSpotIngestResult {
  contacts: CrmSnapshotArtifact["contacts"];
  notes: string[];
  activityLog: CrmActivityEntry[];
  dealProperties: Partial<CrmSnapshotArtifact["dealProperties"]>;
}

// ---------------------------------------------------------------------------
// Transform functions
// ---------------------------------------------------------------------------

/**
 * Transform raw HubSpot data into structured CRM artifact fields.
 *
 * @param dealId - The v2 deal codename ID (e.g. "velocity-systems")
 * @param rawDeal - Raw deal object from deal_crmSearch
 * @param rawContacts - Raw contact objects from contactSearch
 * @param rawNotes - Raw note objects from ae:496206 (optional)
 */
export function transformHubSpotData(
  dealId: string,
  rawDeal: RawHubSpotDeal,
  rawContacts: RawHubSpotContact[],
  rawNotes?: RawHubSpotNote[],
): HubSpotIngestResult {
  // Transform contacts
  const contacts: CrmSnapshotArtifact["contacts"] = rawContacts.map((c) => ({
    name: [c.firstname, c.lastname].filter(Boolean).join(" ") || "Unknown",
    title: c.jobtitle || undefined,
    role: undefined,
    email: c.email || undefined,
  }));

  // Transform notes
  const notes: string[] = (rawNotes || [])
    .filter((n) => n.hs_note_body)
    .map((n) => stripHtml(n.hs_note_body!));

  // Build activity log from notes with timestamps
  const activityLog: CrmActivityEntry[] = (rawNotes || [])
    .filter((n) => n.hs_note_body && (n.hs_timestamp || n.hs_createdate))
    .map((n) => ({
      date: normalizeDate(n.hs_timestamp || n.hs_createdate || ""),
      type: inferNoteType(n.hs_note_body!),
      description: stripHtml(n.hs_note_body!).slice(0, 500),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Extract deal properties
  const dealProperties: HubSpotIngestResult["dealProperties"] = {};
  if (rawDeal.dealstage) dealProperties.stage = rawDeal.dealstage;
  if (rawDeal.amount) dealProperties.amount = `$${rawDeal.amount}`;
  if (rawDeal.closedate) dealProperties.closeDate = normalizeDate(rawDeal.closedate);
  if (rawDeal.pipeline) dealProperties.pipeline = rawDeal.pipeline;
  if (rawDeal.hs_lastmodifieddate || rawDeal.notes_last_updated) {
    dealProperties.lastContactedDate = normalizeDate(
      rawDeal.hs_lastmodifieddate || rawDeal.notes_last_updated || "",
    );
  }

  return { contacts, notes, activityLog, dealProperties };
}

/**
 * Merge HubSpot data into an existing CRM snapshot artifact.
 * HubSpot data enriches but does not replace existing local data.
 */
export function mergeHubSpotIntoCrm(
  existing: CrmSnapshotArtifact,
  hubspot: HubSpotIngestResult,
): CrmSnapshotArtifact {
  // Merge contacts: add HubSpot contacts not already present (by name)
  const existingNames = new Set(
    existing.contacts.map((c) => c.name.toLowerCase()),
  );
  const newContacts = hubspot.contacts.filter(
    (c) => !existingNames.has(c.name.toLowerCase()),
  );

  // Enrich existing contacts with email from HubSpot
  const enrichedContacts = existing.contacts.map((c) => {
    if (c.email) return c;
    const match = hubspot.contacts.find(
      (h) => h.name.toLowerCase() === c.name.toLowerCase(),
    );
    return match?.email ? { ...c, email: match.email } : c;
  });

  // Merge activity logs: deduplicate by date+type
  const existingActivityKeys = new Set(
    existing.activityLog.map((a) => `${a.date}:${a.type}`),
  );
  const newActivities = hubspot.activityLog.filter(
    (a) => !existingActivityKeys.has(`${a.date}:${a.type}`),
  );
  const mergedActivityLog = [...existing.activityLog, ...newActivities].sort(
    (a, b) => a.date.localeCompare(b.date),
  );

  // Merge notes: deduplicate by content prefix
  const existingNotePrefixes = new Set(
    existing.notes.map((n) => n.slice(0, 100).toLowerCase()),
  );
  const newNotes = hubspot.notes.filter(
    (n) => !existingNotePrefixes.has(n.slice(0, 100).toLowerCase()),
  );

  // Merge deal properties: HubSpot fills gaps, does not overwrite
  const mergedProperties = { ...existing.dealProperties };
  if (!mergedProperties.amount && hubspot.dealProperties.amount) {
    mergedProperties.amount = hubspot.dealProperties.amount;
  }
  if (!mergedProperties.closeDate && hubspot.dealProperties.closeDate) {
    mergedProperties.closeDate = hubspot.dealProperties.closeDate;
  }
  if (!mergedProperties.pipeline && hubspot.dealProperties.pipeline) {
    mergedProperties.pipeline = hubspot.dealProperties.pipeline;
  }
  if (!mergedProperties.lastContactedDate && hubspot.dealProperties.lastContactedDate) {
    mergedProperties.lastContactedDate = hubspot.dealProperties.lastContactedDate;
  }

  return {
    ...existing,
    dealProperties: mergedProperties,
    contacts: [...enrichedContacts, ...newContacts],
    notes: [...existing.notes, ...newNotes],
    activityLog: mergedActivityLog,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip HTML tags from HubSpot note bodies */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalize a date string to ISO YYYY-MM-DD format */
function normalizeDate(dateStr: string): string {
  if (!dateStr) return "";
  // Already ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.slice(0, 10);
  }
  // Unix timestamp in milliseconds
  const ts = Number(dateStr);
  if (!isNaN(ts) && ts > 1e12) {
    return new Date(ts).toISOString().slice(0, 10);
  }
  // Try parsing
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return dateStr;
}

/** Infer activity type from note text */
function inferNoteType(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("call") || lower.includes("spoke")) return "call";
  if (lower.includes("email") || lower.includes("sent")) return "email";
  if (lower.includes("meeting") || lower.includes("met with")) return "meeting";
  if (lower.includes("stage") || lower.includes("pipeline")) return "stage_change";
  return "note";
}
