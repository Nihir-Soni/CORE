import { describe, it, expect } from "vitest";
import { SSEChunkParser } from "../sse-parser";

describe("SSEChunkParser unit tests", () => {
  it("1. Parses single complete SSE frame in one chunk", () => {
    const parser = new SSEChunkParser();
    const events = parser.push('event: token\ndata: {"text":"hello"}\n\n');

    expect(events.length).toBe(1);
    expect(events[0]).toEqual({
      event: "token",
      data: '{"text":"hello"}',
    });
  });

  it("2. Parses multiple complete SSE frames in one chunk", () => {
    const parser = new SSEChunkParser();
    const chunk =
      'event: token\ndata: {"text":"hello"}\n\nevent: token\ndata: {"text":" world"}\n\nevent: complete\ndata: {}\n\n';

    const events = parser.push(chunk);

    expect(events.length).toBe(3);
    expect(events[0]).toEqual({ event: "token", data: '{"text":"hello"}' });
    expect(events[1]).toEqual({ event: "token", data: '{"text":" world"}' });
    expect(events[2]).toEqual({ event: "complete", data: "{}" });
  });

  it("3. Buffers incomplete SSE frame split across multiple network chunks", () => {
    const parser = new SSEChunkParser();

    // First chunk ends in middle of event frame
    const events1 = parser.push('event: token\ndata: {"text":"part1');
    expect(events1.length).toBe(0); // Incomplete, buffered

    // Second chunk finishes the event frame
    const events2 = parser.push('"} \n\n');
    expect(events2.length).toBe(1);
    expect(events2[0]).toEqual({
      event: "token",
      data: '{"text":"part1"}',
    });
  });

  it("4. Correctly handles CRLF (\\r\\n) line breaks", () => {
    const parser = new SSEChunkParser();
    const chunk =
      'event: token\r\ndata: {"text":"crlf"}\r\n\r\nevent: complete\r\ndata: {}\r\n\r\n';

    const events = parser.push(chunk);

    expect(events.length).toBe(2);
    expect(events[0]).toEqual({ event: "token", data: '{"text":"crlf"}' });
    expect(events[1]).toEqual({ event: "complete", data: "{}" });
  });
});
