export type SSEEventPayload = {
  event: string;
  data: string;
};

export class SSEChunkParser {
  private buffer = "";

  /**
   * Pushes raw text into the buffer and returns any complete SSE event frames parsed.
   */
  push(text: string): SSEEventPayload[] {
    this.buffer += text;
    const events: SSEEventPayload[] = [];

    // Split on double line breaks (blank line boundaries \n\n or \r\n\r\n)
    const blocks = this.buffer.split(/\r?\n\r?\n/);

    // The last element in blocks might be incomplete frame, keep it in buffer
    this.buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      if (!block.trim()) continue;
      let currentEvent = "message";
      const dataLines: string[] = [];

      const lines = block.split(/\r?\n/);
      for (const line of lines) {
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }

      events.push({
        event: currentEvent,
        data: dataLines.join("\n"),
      });
    }

    return events;
  }

  reset() {
    this.buffer = "";
  }
}
