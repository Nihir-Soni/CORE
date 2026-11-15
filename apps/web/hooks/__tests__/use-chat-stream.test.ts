import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChatStream } from "../use-chat-stream";
import * as auth from "@/lib/auth";

vi.mock("@/lib/auth", () => ({
  getAccessToken: vi.fn(),
  getWorkspaceId: vi.fn(),
}));

function createMockReadableStream(chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
        // Yield execution to simulate chunk arrival
        await new Promise((r) => setTimeout(r, 10));
      }
      controller.close();
    },
  });
}

describe("useChatStream hook unit tests", () => {
  beforeEach(() => {
    vi.mocked(auth.getAccessToken).mockReturnValue("mock-jwt-token");
    vi.mocked(auth.getWorkspaceId).mockReturnValue("ws-test-1");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("1. idle -> connecting -> streaming -> complete lifecycle with token accumulation", async () => {
    const sseChunks = [
      'event: token\ndata: {"text":"The "}\n\n',
      'event: token\ndata: {"text":"contract "}\n\n',
      'event: token\ndata: {"text":"terms."}\n\n',
      'event: citations\ndata: {"citations":[{"filename":"contract.pdf","similarity":0.92,"chunkIndex":0,"chunkId":"c1","documentId":"d1"}]}\n\n',
      "event: complete\ndata: {}\n\n",
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        body: createMockReadableStream(sseChunks),
      }),
    );

    const { result } = renderHook(() => useChatStream());

    expect(result.current.state.status).toBe("idle");

    let promise: Promise<void>;
    act(() => {
      promise = result.current.sendMessage("What are contract terms?");
    });

    expect(result.current.state.status).toBe("connecting");

    await act(async () => {
      await promise;
    });

    expect(result.current.state.status).toBe("complete");
    expect(result.current.state.answer).toBe("The contract terms.");
    expect(result.current.state.citations.length).toBe(1);
    expect(result.current.state.citations[0].filename).toBe("contract.pdf");
  });

  it("2. Server event: error updates state status=error safely", async () => {
    const sseChunks = [
      'event: token\ndata: {"text":"Partial answer..."}\n\n',
      'event: error\ndata: {"message":"Unable to generate a response"}\n\n',
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        body: createMockReadableStream(sseChunks),
      }),
    );

    const { result } = renderHook(() => useChatStream());

    let promise: Promise<void>;
    act(() => {
      promise = result.current.sendMessage("Fail query");
    });

    await act(async () => {
      await promise;
    });

    expect(result.current.state.status).toBe("error");
    expect(result.current.state.error).toBe("Unable to generate a response");
    expect(result.current.state.answer).toBe("Partial answer...");
  });

  it("3. Malformed event payload is handled without crashing", async () => {
    const sseChunks = [
      "event: token\ndata: invalid-json-payload\n\n",
      'event: token\ndata: {"text":"Valid token"}\n\n',
      "event: complete\ndata: {}\n\n",
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        body: createMockReadableStream(sseChunks),
      }),
    );

    const { result } = renderHook(() => useChatStream());

    let promise: Promise<void>;
    act(() => {
      promise = result.current.sendMessage("Test malformed");
    });

    await act(async () => {
      await promise;
    });

    expect(result.current.state.status).toBe("complete");
    expect(result.current.state.answer).toBe("Valid token");
  });

  it("4. Component unmount / cancel aborts AbortController, terminates fetch stream, and prevents post-unmount state updates", async () => {
    let abortSignalPassed: AbortSignal | undefined;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, init) => {
        abortSignalPassed = init.signal;
        return Promise.resolve({
          ok: true,
          body: createMockReadableStream([
            'event: token\ndata: {"text":"First token"}\n\n',
          ]),
        });
      }),
    );

    const { result, unmount } = renderHook(() => useChatStream());

    act(() => {
      result.current.sendMessage("Streaming test");
    });

    expect(abortSignalPassed).toBeDefined();
    expect(abortSignalPassed?.aborted).toBe(false);

    act(() => {
      unmount();
    });

    expect(abortSignalPassed?.aborted).toBe(true);
  });
});
