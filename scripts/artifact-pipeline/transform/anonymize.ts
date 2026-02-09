/**
 * Anonymization module for the artifact-based pipeline.
 *
 * Refactored from extract_checkpoints.ts with extended coverage:
 *   - Slack handle anonymization
 *   - HubSpot numeric ID anonymization
 *   - ISO date shifting
 *   - Artifact-level anonymization for all artifact types
 */

import type {
  Artifact,
  TranscriptArtifact,
  TranscriptTurn,
  EmailArtifact,
  EmailMessage,
  CrmSnapshotArtifact,
  CrmActivityEntry,
  DocumentArtifact,
  SlackThreadArtifact,
  SlackMessage,
  CalendarEventArtifact,
} from "../../../src/types/benchmark-artifact";

// ---------------------------------------------------------------------------
// Replacement Maps
// ---------------------------------------------------------------------------

/** Company name replacements for anonymization */
export const COMPANY_REPLACEMENTS: Record<string, string> = {
  "flagship": "Horizon Ventures",
  "flagship pioneering": "Horizon Ventures",
  "moxie": "Velocity Systems",
  "granola": "NoteFlow AI",
  "zenith prep academy": "Summit Learning",
  "zenith": "Summit Learning",
  "eaton group": "Eastpoint Capital",
  "eaton": "Eastpoint",
  "anisa": "Artisan Brands",
  "genea": "LifeGen Labs",
  "pronet": "NetPro Solutions",
  "hometime": "DwellTech",
  "patoma": "PathMark Analytics",
  "avmedia": "StreamCore Media",
  "scg-security": "SecureGuard Systems",
  "scg": "SecureGuard",
  "cool-rooms": "ChillSpace Tech",
  "xpansiv": "GreenMarket Exchange",
  "finera": "FinEdge Solutions",
  "zapier": "AutomateFlow",
  "workato": "IntegrateHub",
  "make": "FlowBuilder",
  "hubspot": "SalesCloud",
  "salesforce": "CRMPlatform",
  "slack": "TeamChat",
  "coupa": "ProcureSoft",
  "clickup": "TaskBoard",
  "intercom": "ChatSupport",
  "snowflake": "DataVault",
  "airtable": "GridBase",
  "notion": "DocSpace",
  "stripe": "PayFlow",
  "attio": "RelateSync",
};

/** Person name replacements */
export const PERSON_REPLACEMENTS: Record<string, string> = {
  "adrian": "Alex",
  "sam": "Jordan",
  "amy": "Sarah",
  "feng": "David",
  "bryan": "Mike",
  "fred": "Robert",
  "sonia": "Lisa",
  "sonya": "Lisa",
  "derek": "Kevin",
  "julia": "Emma",
  "emily": "Rachel",
  "will": "James",
  "caroline": "Katie",
  "clementine": "Claire",
  "nyal": "Nathan",
  "shre": "Steve",
  "tracy": "Taylor",
  "wade": "Walter",
  "chris": "Charles",
  "kyle": "Kurt",
  "frank": "Francis",
  "carl": "Craig",
};

/** Deal directory name -> codename kebab ID (used for checkpoint IDs) */
export const DEAL_ID_MAP: Record<string, string> = {
  "moxie": "velocity-systems",
  "granola": "noteflow-ai",
  "avmedia": "streamcore-media",
  "cool-rooms": "chillspace-tech",
  "zenith-prep-academy": "summit-learning",
  "pronet": "netpro-solutions",
  "flagship": "horizon-ventures",
  "patoma": "pathmark-analytics",
  "genea": "lifegen-labs",
  "anisa": "artisan-brands",
  "eaton-group": "eastpoint-capital",
  "hometime": "dwelltech",
  "scg-security": "secureguard-systems",
  "finera": "finedge-solutions",
  "xpansiv": "greenmarket-exchange",
};

// ---------------------------------------------------------------------------
// Text-level Anonymization
// ---------------------------------------------------------------------------

/**
 * Anonymize a single string by applying all replacement patterns.
 * Handles company names, person names, emails, phones, file paths,
 * dollar amounts, URLs, Slack handles, and HubSpot numeric IDs.
 */
export function anonymizeText(text: string): string {
  let result = text;

  // Replace company names (case-insensitive, whole word)
  for (const [real, fake] of Object.entries(COMPANY_REPLACEMENTS)) {
    const regex = new RegExp(`\\b${real}\\b`, "gi");
    result = result.replace(regex, fake);
  }

  // Replace person names (case-insensitive, whole word)
  for (const [real, fake] of Object.entries(PERSON_REPLACEMENTS)) {
    const regex = new RegExp(`\\b${real}\\b`, "gi");
    result = result.replace(regex, fake);
  }

  // Anonymize emails
  result = result.replace(/[\w.-]+@[\w.-]+\.\w+/g, "user@company.example.com");

  // Anonymize phone numbers
  result = result.replace(
    /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
    "555-XXX-XXXX",
  );

  // Anonymize file paths
  result = result.replace(/\/Users\/[\w-]+/g, "/Users/username");

  // Anonymize specific dollar amounts to ranges
  result = result.replace(/\$(\d{1,3}),?(\d{3})/g, (_match, first, second) => {
    const amount = parseInt(first + second);
    if (amount >= 100000) return "$100K+";
    if (amount >= 50000) return "$50-100K";
    if (amount >= 20000) return "$20-50K";
    return "$10-20K";
  });

  // Anonymize URLs
  result = result.replace(/https?:\/\/[^\s<>"]+/g, "https://example.com/...");

  // --- artifact extensions ---

  // Anonymize Slack handles (@username -> @user)
  result = result.replace(/@[\w.-]{2,}/g, "@user");

  // Anonymize HubSpot-style numeric IDs (standalone 6-12 digit numbers)
  result = result.replace(/\b\d{6,12}\b/g, "000000000");

  return result;
}

// ---------------------------------------------------------------------------
// Date Shifting
// ---------------------------------------------------------------------------

/** Regex matching ISO 8601 dates: YYYY-MM-DD with optional time portion */
const ISO_DATE_RE =
  /\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?:T[0-9:.Z+-]+)?/g;

/**
 * Shift all ISO dates in `text` by `offsetDays`.
 * Positive offset moves dates into the future; negative into the past.
 */
export function shiftDates(text: string, offsetDays: number): string {
  return text.replace(ISO_DATE_RE, (match) => {
    const d = new Date(match);
    if (isNaN(d.getTime())) return match; // not a valid date, leave as-is
    d.setUTCDate(d.getUTCDate() + offsetDays);
    // Preserve original format: date-only vs datetime
    if (match.includes("T")) {
      return d.toISOString();
    }
    return d.toISOString().slice(0, 10);
  });
}

/** Shift a single ISO date string by `offsetDays`. Returns the shifted string. */
function shiftSingleDate(date: string, offsetDays: number): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) return date;
  d.setUTCDate(d.getUTCDate() + offsetDays);
  if (date.includes("T")) return d.toISOString();
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Artifact-level Anonymization
// ---------------------------------------------------------------------------

/**
 * Deep-clone an object (JSON round-trip — sufficient for our serializable types).
 */
function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/** Anonymize a TranscriptArtifact */
function anonymizeTranscript(
  a: TranscriptArtifact,
  dateOffset: number,
): TranscriptArtifact {
  return {
    ...a,
    anonymized: true,
    createdAt: shiftSingleDate(a.createdAt, dateOffset),
    title: anonymizeText(a.title),
    rawText: anonymizeText(a.rawText),
    turns: a.turns.map((t: TranscriptTurn) => ({
      ...t,
      speakerName: t.speakerName ? anonymizeText(t.speakerName) : undefined,
      text: anonymizeText(t.text),
      timestamp: t.timestamp
        ? shiftSingleDate(t.timestamp, dateOffset)
        : undefined,
    })),
    attendees: a.attendees.map(anonymizeText),
    date: shiftSingleDate(a.date, dateOffset),
    keyTakeaways: a.keyTakeaways?.map(anonymizeText),
  };
}

/** Anonymize an EmailArtifact */
function anonymizeEmail(
  a: EmailArtifact,
  dateOffset: number,
): EmailArtifact {
  return {
    ...a,
    anonymized: true,
    createdAt: shiftSingleDate(a.createdAt, dateOffset),
    subject: anonymizeText(a.subject),
    messages: a.messages.map((m: EmailMessage) => ({
      from: anonymizeText(m.from),
      to: m.to.map(anonymizeText),
      cc: m.cc?.map(anonymizeText),
      date: shiftSingleDate(m.date, dateOffset),
      body: anonymizeText(m.body),
    })),
    participants: a.participants.map(anonymizeText),
  };
}

/** Anonymize a CrmSnapshotArtifact */
function anonymizeCrmSnapshot(
  a: CrmSnapshotArtifact,
  dateOffset: number,
): CrmSnapshotArtifact {
  return {
    ...a,
    anonymized: true,
    createdAt: shiftSingleDate(a.createdAt, dateOffset),
    dealProperties: {
      ...a.dealProperties,
      stage: anonymizeText(a.dealProperties.stage),
      amount: a.dealProperties.amount
        ? anonymizeText(a.dealProperties.amount)
        : undefined,
      closeDate: a.dealProperties.closeDate
        ? shiftSingleDate(a.dealProperties.closeDate, dateOffset)
        : undefined,
      pipeline: a.dealProperties.pipeline
        ? anonymizeText(a.dealProperties.pipeline)
        : undefined,
      lastContactedDate: a.dealProperties.lastContactedDate
        ? shiftSingleDate(a.dealProperties.lastContactedDate, dateOffset)
        : undefined,
    },
    contacts: a.contacts.map((c: CrmSnapshotArtifact["contacts"][number]) => ({
      name: anonymizeText(c.name),
      title: c.title ? anonymizeText(c.title) : undefined,
      role: c.role ? anonymizeText(c.role) : undefined,
      email: c.email ? anonymizeText(c.email) : undefined,
    })),
    notes: a.notes.map(anonymizeText),
    activityLog: a.activityLog.map((entry: CrmActivityEntry) => ({
      ...entry,
      date: shiftSingleDate(entry.date, dateOffset),
      description: anonymizeText(entry.description),
    })),
  };
}

/** Anonymize a DocumentArtifact */
function anonymizeDocument(
  a: DocumentArtifact,
  dateOffset: number,
): DocumentArtifact {
  return {
    ...a,
    anonymized: true,
    createdAt: shiftSingleDate(a.createdAt, dateOffset),
    title: anonymizeText(a.title),
    content: anonymizeText(a.content),
    metadata: a.metadata
      ? Object.fromEntries(
          Object.entries(a.metadata).map(([k, v]) => [k, anonymizeText(v as string)]),
        )
      : undefined,
  };
}

/** Anonymize a SlackThreadArtifact */
function anonymizeSlackThread(
  a: SlackThreadArtifact,
  dateOffset: number,
): SlackThreadArtifact {
  return {
    ...a,
    anonymized: true,
    createdAt: shiftSingleDate(a.createdAt, dateOffset),
    channel: anonymizeText(a.channel),
    messages: a.messages.map((m: SlackMessage) => ({
      author: anonymizeText(m.author),
      text: anonymizeText(m.text),
      timestamp: shiftSingleDate(m.timestamp, dateOffset),
      threadReply: m.threadReply,
    })),
  };
}

/** Anonymize a CalendarEventArtifact */
function anonymizeCalendarEvent(
  a: CalendarEventArtifact,
  dateOffset: number,
): CalendarEventArtifact {
  return {
    ...a,
    anonymized: true,
    createdAt: shiftSingleDate(a.createdAt, dateOffset),
    title: anonymizeText(a.title),
    date: shiftSingleDate(a.date, dateOffset),
    attendees: a.attendees.map(anonymizeText),
    description: a.description ? anonymizeText(a.description) : undefined,
    location: a.location ? anonymizeText(a.location) : undefined,
  };
}

/**
 * Anonymize any Artifact type. Returns a new anonymized copy (does not mutate).
 *
 * @param artifact - The artifact to anonymize
 * @param dateOffset - Number of days to shift dates (default: 0, no shift)
 */
export function anonymizeArtifact(
  artifact: Artifact,
  dateOffset: number = 0,
): Artifact {
  const a = clone(artifact);

  switch (a.type) {
    case "transcript":
      return anonymizeTranscript(a, dateOffset);
    case "email":
      return anonymizeEmail(a, dateOffset);
    case "crm_snapshot":
      return anonymizeCrmSnapshot(a, dateOffset);
    case "document":
      return anonymizeDocument(a, dateOffset);
    case "slack_thread":
      return anonymizeSlackThread(a, dateOffset);
    case "calendar_event":
      return anonymizeCalendarEvent(a, dateOffset);
  }
}
