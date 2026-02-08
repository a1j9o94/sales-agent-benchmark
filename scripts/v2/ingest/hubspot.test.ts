import { test, expect, describe } from "bun:test";
import {
  transformHubSpotData,
  mergeHubSpotIntoCrm,
  type RawHubSpotDeal,
  type RawHubSpotContact,
  type RawHubSpotNote,
} from "./hubspot";
import type { CrmSnapshotArtifact } from "../../../src/types/benchmark-v2";

describe("transformHubSpotData", () => {
  const dealId = "velocity-systems";

  const rawDeal: RawHubSpotDeal = {
    dealname: "Velocity Systems",
    dealstage: "Proposal Sent",
    amount: "50000",
    closedate: "2026-03-15",
    pipeline: "Sales Pipeline",
    hs_lastmodifieddate: "2026-02-01",
  };

  const rawContacts: RawHubSpotContact[] = [
    {
      firstname: "John",
      lastname: "Doe",
      jobtitle: "VP Engineering",
      email: "john@example.com",
    },
    {
      firstname: "Jane",
      lastname: "Smith",
      jobtitle: "CTO",
      email: "jane@example.com",
    },
  ];

  const rawNotes: RawHubSpotNote[] = [
    {
      hs_note_body: "<p>Called John about the proposal. He's interested.</p>",
      hs_timestamp: "1706745600000", // 2024-01-31 in ms
    },
    {
      hs_note_body: "Sent email follow-up with pricing details",
      hs_createdate: "2026-02-01",
    },
  ];

  test("transforms contacts correctly", () => {
    const result = transformHubSpotData(dealId, rawDeal, rawContacts);
    expect(result.contacts).toHaveLength(2);
    expect(result.contacts[0]).toEqual({
      name: "John Doe",
      title: "VP Engineering",
      role: undefined,
      email: "john@example.com",
    });
    expect(result.contacts[1]).toEqual({
      name: "Jane Smith",
      title: "CTO",
      role: undefined,
      email: "jane@example.com",
    });
  });

  test("transforms deal properties", () => {
    const result = transformHubSpotData(dealId, rawDeal, rawContacts);
    expect(result.dealProperties.stage).toBe("Proposal Sent");
    expect(result.dealProperties.amount).toBe("$50000");
    expect(result.dealProperties.closeDate).toBe("2026-03-15");
    expect(result.dealProperties.pipeline).toBe("Sales Pipeline");
    expect(result.dealProperties.lastContactedDate).toBe("2026-02-01");
  });

  test("transforms notes with HTML stripping", () => {
    const result = transformHubSpotData(dealId, rawDeal, rawContacts, rawNotes);
    expect(result.notes).toHaveLength(2);
    expect(result.notes[0]).toBe("Called John about the proposal. He's interested.");
    expect(result.notes[1]).toBe("Sent email follow-up with pricing details");
  });

  test("builds activity log from notes", () => {
    const result = transformHubSpotData(dealId, rawDeal, rawContacts, rawNotes);
    expect(result.activityLog).toHaveLength(2);
    expect(result.activityLog[0]!.type).toBe("call");
    expect(result.activityLog[1]!.type).toBe("email");
  });

  test("handles missing contact fields", () => {
    const sparse: RawHubSpotContact[] = [{ firstname: "Solo" }];
    const result = transformHubSpotData(dealId, rawDeal, sparse);
    expect(result.contacts[0]!.name).toBe("Solo");
    expect(result.contacts[0]!.title).toBeUndefined();
    expect(result.contacts[0]!.email).toBeUndefined();
  });

  test("handles empty deal", () => {
    const result = transformHubSpotData(dealId, {}, []);
    expect(result.contacts).toHaveLength(0);
    expect(result.notes).toHaveLength(0);
    expect(result.activityLog).toHaveLength(0);
  });

  test("normalizes Unix timestamp dates", () => {
    const notes: RawHubSpotNote[] = [
      {
        hs_note_body: "Test note",
        hs_timestamp: "1706745600000", // 2024-01-31 in ms
      },
    ];
    const result = transformHubSpotData(dealId, rawDeal, [], notes);
    expect(result.activityLog[0]!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("mergeHubSpotIntoCrm", () => {
  const existing: CrmSnapshotArtifact = {
    id: "velocity-systems_crm_snapshot",
    dealId: "velocity-systems",
    type: "crm_snapshot",
    createdAt: "2026-01-15",
    anonymized: false,
    dealProperties: {
      stage: "Discovery",
    },
    contacts: [
      { name: "John Doe", title: "VP Eng", role: "champion" },
    ],
    notes: ["Initial call went well"],
    activityLog: [
      { date: "2026-01-15", type: "call", description: "Initial discovery call" },
    ],
  };

  const hubspotResult = transformHubSpotData(
    "velocity-systems",
    { dealstage: "Proposal Sent", amount: "50000", closedate: "2026-03-15" },
    [
      { firstname: "John", lastname: "Doe", email: "john@example.com" },
      { firstname: "New", lastname: "Contact", jobtitle: "Director", email: "new@example.com" },
    ],
    [
      { hs_note_body: "Follow-up sent", hs_createdate: "2026-02-01" },
    ],
  );

  test("adds new contacts without duplicating existing ones", () => {
    const merged = mergeHubSpotIntoCrm(existing, hubspotResult);
    // Should have John Doe (existing) + New Contact (new from HubSpot)
    expect(merged.contacts).toHaveLength(2);
    expect(merged.contacts.find((c) => c.name === "New Contact")).toBeDefined();
  });

  test("enriches existing contacts with email from HubSpot", () => {
    const merged = mergeHubSpotIntoCrm(existing, hubspotResult);
    const john = merged.contacts.find((c) => c.name === "John Doe");
    expect(john?.email).toBe("john@example.com");
  });

  test("does not overwrite existing deal properties", () => {
    const merged = mergeHubSpotIntoCrm(existing, hubspotResult);
    // Stage should stay as "Discovery" (from local), not "Proposal Sent" (from HubSpot)
    expect(merged.dealProperties.stage).toBe("Discovery");
  });

  test("fills missing deal properties from HubSpot", () => {
    const merged = mergeHubSpotIntoCrm(existing, hubspotResult);
    expect(merged.dealProperties.amount).toBe("$50000");
    expect(merged.dealProperties.closeDate).toBe("2026-03-15");
  });

  test("merges activity logs without duplicates", () => {
    const merged = mergeHubSpotIntoCrm(existing, hubspotResult);
    expect(merged.activityLog.length).toBeGreaterThanOrEqual(2);
    // Should be sorted by date
    for (let i = 1; i < merged.activityLog.length; i++) {
      expect(merged.activityLog[i]!.date >= merged.activityLog[i - 1]!.date).toBe(true);
    }
  });

  test("merges notes without duplicates", () => {
    const merged = mergeHubSpotIntoCrm(existing, hubspotResult);
    expect(merged.notes).toContain("Initial call went well");
    expect(merged.notes.some((n) => n.includes("Follow-up sent"))).toBe(true);
  });
});
