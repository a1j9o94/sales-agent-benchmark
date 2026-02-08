import { test, expect, describe } from "bun:test";
import {
  transformGmailThreads,
  transformRawGmailMessages,
  type RawGmailThread,
  type RawGmailMessage,
} from "./gmail";

describe("transformGmailThreads", () => {
  const dealId = "velocity-systems";

  const threads: RawGmailThread[] = [
    {
      subject: "Re: Proposal for Velocity Systems",
      messages: [
        {
          from: "alice@company.com",
          to: ["bob@client.com"],
          date: "2026-01-15",
          body: "Hi Bob, please find the proposal attached.",
        },
        {
          from: "bob@client.com",
          to: ["alice@company.com"],
          cc: ["carol@client.com"],
          date: "2026-01-16",
          body: "Thanks Alice, I'll review it this week.",
        },
      ],
    },
    {
      subject: "Pricing Discussion",
      messages: [
        {
          from: "alice@company.com",
          to: ["bob@client.com"],
          date: "2026-01-20",
          body: "Following up on pricing.",
        },
      ],
    },
  ];

  test("creates EmailArtifact for each thread", () => {
    const result = transformGmailThreads(dealId, threads);
    expect(result).toHaveLength(2);
  });

  test("generates correct artifact IDs", () => {
    const result = transformGmailThreads(dealId, threads);
    expect(result[0]!.id).toBe("velocity-systems_email_0");
    expect(result[1]!.id).toBe("velocity-systems_email_1");
  });

  test("sets correct artifact type and metadata", () => {
    const result = transformGmailThreads(dealId, threads);
    expect(result[0]!.type).toBe("email");
    expect(result[0]!.dealId).toBe(dealId);
    expect(result[0]!.anonymized).toBe(false);
    expect(result[0]!.subject).toBe("Re: Proposal for Velocity Systems");
  });

  test("extracts all participants", () => {
    const result = transformGmailThreads(dealId, threads);
    const participants = result[0]!.participants;
    expect(participants).toContain("alice@company.com");
    expect(participants).toContain("bob@client.com");
    expect(participants).toContain("carol@client.com");
  });

  test("preserves message details", () => {
    const result = transformGmailThreads(dealId, threads);
    expect(result[0]!.messages).toHaveLength(2);
    expect(result[0]!.messages[0]!.from).toBe("alice@company.com");
    expect(result[0]!.messages[1]!.cc).toEqual(["carol@client.com"]);
  });

  test("uses earliest message date as createdAt", () => {
    const result = transformGmailThreads(dealId, threads);
    expect(result[0]!.createdAt).toBe("2026-01-15");
  });

  test("limits to MAX_THREADS_PER_DEAL (10)", () => {
    const manyThreads: RawGmailThread[] = Array.from({ length: 15 }, (_, i) => ({
      subject: `Thread ${i}`,
      messages: [{ from: "a@b.com", to: ["c@d.com"], date: "2026-01-01", body: "test" }],
    }));
    const result = transformGmailThreads(dealId, manyThreads);
    expect(result).toHaveLength(10);
  });

  test("handles empty threads array", () => {
    const result = transformGmailThreads(dealId, []);
    expect(result).toHaveLength(0);
  });
});

describe("transformRawGmailMessages", () => {
  const dealId = "noteflow-ai";

  const rawMessages: RawGmailMessage[] = [
    {
      from: "alice@company.com",
      to: "bob@client.com",
      subject: "Proposal",
      date: "2026-01-15",
      body_plain: "Here is the proposal.",
      thread_id: "thread_123",
      id: "msg_1",
    },
    {
      from: "bob@client.com",
      to: "alice@company.com",
      subject: "Re: Proposal",
      date: "2026-01-16",
      body_plain: "Thanks, looks good.",
      thread_id: "thread_123",
      id: "msg_2",
    },
    {
      from: "carol@other.com",
      to: "alice@company.com",
      subject: "Different Topic",
      date: "2026-01-17",
      body_plain: "Unrelated email.",
      thread_id: "thread_456",
      id: "msg_3",
    },
  ];

  test("groups messages by thread_id", () => {
    const result = transformRawGmailMessages(dealId, rawMessages);
    expect(result).toHaveLength(2);
  });

  test("first thread (most recent) comes first", () => {
    const result = transformRawGmailMessages(dealId, rawMessages);
    // thread_456 has later date (Jan 17) so it's first (most recent)
    expect(result[0]!.subject).toBe("Different Topic");
  });

  test("groups messages without thread_id by subject", () => {
    const noThreadId: RawGmailMessage[] = [
      { from: "a@b.com", to: "c@d.com", subject: "Hello", date: "2026-01-01", body_plain: "hi" },
      { from: "c@d.com", to: "a@b.com", subject: "Re: Hello", date: "2026-01-02", body_plain: "hey" },
    ];
    const result = transformRawGmailMessages(dealId, noThreadId);
    // Both should be in the same thread (normalized subject "hello")
    expect(result).toHaveLength(1);
    expect(result[0]!.messages).toHaveLength(2);
  });

  test("handles string recipients (not array)", () => {
    const msgs: RawGmailMessage[] = [
      { from: "a@b.com", to: "c@d.com, e@f.com", subject: "Test", date: "2026-01-01", body_plain: "hi" },
    ];
    const result = transformRawGmailMessages(dealId, msgs);
    expect(result[0]!.participants).toContain("c@d.com");
    expect(result[0]!.participants).toContain("e@f.com");
  });

  test("prefers body_plain over body", () => {
    const msgs: RawGmailMessage[] = [
      {
        from: "a@b.com",
        to: "c@d.com",
        subject: "Test",
        date: "2026-01-01",
        body_plain: "Plain text",
        body: "<p>HTML text</p>",
      },
    ];
    const result = transformRawGmailMessages(dealId, msgs);
    expect(result[0]!.messages[0]!.body).toBe("Plain text");
  });

  test("handles empty input", () => {
    const result = transformRawGmailMessages(dealId, []);
    expect(result).toHaveLength(0);
  });
});
