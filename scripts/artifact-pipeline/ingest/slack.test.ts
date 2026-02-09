import { test, expect, describe } from "bun:test";
import {
  transformSlackThreads,
  transformRawSlackMessages,
  type RawSlackThread,
  type RawSlackMessage,
} from "./slack";

describe("transformSlackThreads", () => {
  const dealId = "velocity-systems";

  const threads: RawSlackThread[] = [
    {
      channel: "#deals",
      messages: [
        { author: "Alice", text: "Just had the call with Velocity", timestamp: "2026-01-15T10:00:00Z", threadReply: false },
        { author: "Bob", text: "How did it go?", timestamp: "2026-01-15T10:05:00Z", threadReply: true },
        { author: "Alice", text: "Really well, they want to move forward", timestamp: "2026-01-15T10:10:00Z", threadReply: true },
      ],
    },
    {
      channel: "#sales",
      messages: [
        { author: "Carol", text: "Single message thread", timestamp: "2026-01-16T09:00:00Z" },
      ],
    },
    {
      channel: "#deals",
      messages: [
        { author: "Dave", text: "Pricing update", timestamp: "2026-01-17T14:00:00Z" },
        { author: "Eve", text: "Got it, thanks", timestamp: "2026-01-17T14:30:00Z" },
      ],
    },
  ];

  test("filters out threads with fewer than 2 messages", () => {
    const result = transformSlackThreads(dealId, threads);
    expect(result).toHaveLength(2); // first and third thread
  });

  test("generates correct artifact IDs", () => {
    const result = transformSlackThreads(dealId, threads);
    expect(result[0]!.id).toBe("velocity-systems_slack_0");
    expect(result[1]!.id).toBe("velocity-systems_slack_1");
  });

  test("sets correct artifact type and metadata", () => {
    const result = transformSlackThreads(dealId, threads);
    expect(result[0]!.type).toBe("slack_thread");
    expect(result[0]!.dealId).toBe(dealId);
    expect(result[0]!.anonymized).toBe(false);
    expect(result[0]!.channel).toBe("#deals");
  });

  test("preserves message details", () => {
    const result = transformSlackThreads(dealId, threads);
    expect(result[0]!.messages).toHaveLength(3);
    expect(result[0]!.messages[0]!.author).toBe("Alice");
    expect(result[0]!.messages[1]!.threadReply).toBe(true);
  });

  test("sorts messages by timestamp", () => {
    const unordered: RawSlackThread[] = [{
      channel: "#test",
      messages: [
        { author: "B", text: "second", timestamp: "2026-01-15T10:05:00Z" },
        { author: "A", text: "first", timestamp: "2026-01-15T10:00:00Z" },
      ],
    }];
    const result = transformSlackThreads(dealId, unordered);
    expect(result[0]!.messages[0]!.author).toBe("A");
    expect(result[0]!.messages[1]!.author).toBe("B");
  });

  test("uses earliest message timestamp as createdAt", () => {
    const result = transformSlackThreads(dealId, threads);
    expect(result[0]!.createdAt).toBe("2026-01-15");
  });

  test("handles empty input", () => {
    const result = transformSlackThreads(dealId, []);
    expect(result).toHaveLength(0);
  });
});

describe("transformRawSlackMessages", () => {
  const dealId = "noteflow-ai";

  const rawMessages: RawSlackMessage[] = [
    {
      text: "Thread parent message",
      real_name: "Alice",
      ts: "1705312800.000100", // ~2024-01-15
      thread_ts: "1705312800.000100",
      channel_name: "#deals",
    },
    {
      text: "Thread reply",
      real_name: "Bob",
      ts: "1705313100.000200",
      thread_ts: "1705312800.000100",
      channel_name: "#deals",
    },
    {
      text: "Different thread",
      username: "carol",
      ts: "1705399200.000300", // ~2024-01-16
      thread_ts: "1705399200.000300",
      channel_name: "#sales",
    },
  ];

  test("groups messages by thread_ts", () => {
    const result = transformRawSlackMessages(dealId, rawMessages);
    // First two messages share thread_ts, third is standalone
    // Standalone with 1 message gets filtered (< 2 messages)
    expect(result).toHaveLength(1);
    expect(result[0]!.messages).toHaveLength(2);
  });

  test("identifies thread replies", () => {
    const result = transformRawSlackMessages(dealId, rawMessages);
    // Parent message: ts === thread_ts → threadReply: false
    expect(result[0]!.messages[0]!.threadReply).toBe(false);
    // Reply: ts !== thread_ts → threadReply: true
    expect(result[0]!.messages[1]!.threadReply).toBe(true);
  });

  test("converts Slack timestamps to ISO", () => {
    const result = transformRawSlackMessages(dealId, rawMessages);
    // Should be ISO date format
    expect(result[0]!.messages[0]!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("prefers real_name over username over user", () => {
    const msgs: RawSlackMessage[] = [
      { text: "msg1", real_name: "Alice Real", username: "alice", user: "U123", ts: "1705312800.001", thread_ts: "1705312800.001", channel: "ch" },
      { text: "msg2", username: "bob", user: "U456", ts: "1705312800.002", thread_ts: "1705312800.001", channel: "ch" },
    ];
    const result = transformRawSlackMessages(dealId, msgs);
    expect(result[0]!.messages[0]!.author).toBe("Alice Real");
    expect(result[0]!.messages[1]!.author).toBe("bob");
  });

  test("handles empty input", () => {
    const result = transformRawSlackMessages(dealId, []);
    expect(result).toHaveLength(0);
  });

  test("groups messages without thread_ts by channel+day", () => {
    const msgs: RawSlackMessage[] = [
      { text: "morning msg", real_name: "A", ts: "1705312800.001", channel_name: "#ch" },
      { text: "another msg", real_name: "B", ts: "1705313400.002", channel_name: "#ch" },
    ];
    const result = transformRawSlackMessages(dealId, msgs);
    // Both same channel+day → same group, 2 messages → passes filter
    expect(result).toHaveLength(1);
    expect(result[0]!.messages).toHaveLength(2);
  });
});
