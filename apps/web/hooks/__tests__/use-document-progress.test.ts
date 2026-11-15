import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDocumentProgress } from "../use-document-progress";
import * as auth from "@/lib/auth";

vi.mock("@/lib/auth", () => ({
  getAccessToken: vi.fn(),
}));

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  readyState = 0; // CONNECTING
  listeners: Record<string, ((e: any) => void)[]> = {};
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (e: any) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: (e: any) => void) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
  }

  close() {
    this.readyState = 2; // CLOSED
  }

  // Helper test simulation methods
  simulateOpen() {
    this.readyState = 1; // OPEN
    if (this.onopen) this.onopen();
  }

  simulateEvent(type: string, data: any) {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    const event = { data: payload };
    const list = this.listeners[type] ?? [];
    list.forEach((fn) => fn(event));
  }

  simulateNativeError() {
    if (this.onerror) this.onerror();
  }
}

global.EventSource = MockEventSource as any;

describe("useDocumentProgress hook", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.mocked(auth.getAccessToken).mockReturnValue("mock-token-123");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("1. Connection lifecycle: idle -> connecting -> connected", () => {
    const { result } = renderHook(() =>
      useDocumentProgress({ workspaceId: "ws-1", documentId: "doc-1" }),
    );

    expect(result.current.connectionState).toBe("connecting");
    expect(MockEventSource.instances.length).toBe(1);
    expect(MockEventSource.instances[0].url).toContain(
      "/documents/ws-1/doc-1/progress?token=mock-token-123",
    );

    act(() => {
      MockEventSource.instances[0].simulateOpen();
    });

    expect(result.current.connectionState).toBe("connected");
  });

  it("2. Progress events update progressState (0% -> 10% -> 30% -> 70%)", () => {
    const { result } = renderHook(() =>
      useDocumentProgress({ workspaceId: "ws-1", documentId: "doc-1" }),
    );

    const es = MockEventSource.instances[0];
    act(() => {
      es.simulateOpen();
      es.simulateEvent("progress", {
        documentId: "doc-1",
        workspaceId: "ws-1",
        status: "PROCESSING",
        progress: 10,
        message: "Processing document",
      });
    });

    expect(result.current.progressState).toEqual({
      documentId: "doc-1",
      workspaceId: "ws-1",
      status: "PROCESSING",
      progress: 10,
      message: "Processing document",
    });

    act(() => {
      es.simulateEvent("progress", {
        documentId: "doc-1",
        workspaceId: "ws-1",
        status: "PROCESSING",
        progress: 70,
        message: "Indexing document",
      });
    });

    expect(result.current.progressState?.progress).toBe(70);
    expect(result.current.progressState?.message).toBe("Indexing document");
  });

  it("3. Complete terminal event sets READY 100%, calls onComplete, and closes EventSource", () => {
    const onComplete = vi.fn();
    const { result } = renderHook(() =>
      useDocumentProgress({
        workspaceId: "ws-1",
        documentId: "doc-1",
        onComplete,
      }),
    );

    const es = MockEventSource.instances[0];
    act(() => {
      es.simulateOpen();
      es.simulateEvent("complete", {
        documentId: "doc-1",
        workspaceId: "ws-1",
        status: "READY",
      });
    });

    expect(result.current.progressState?.status).toBe("READY");
    expect(result.current.progressState?.progress).toBe(100);
    expect(result.current.connectionState).toBe("closed");
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ status: "READY", progress: 100 }),
    );
    expect(es.readyState).toBe(2); // CLOSED
  });

  it("4. Backend error SSE event sets FAILED, calls onError, and closes EventSource", () => {
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useDocumentProgress({
        workspaceId: "ws-1",
        documentId: "doc-1",
        onError,
      }),
    );

    const es = MockEventSource.instances[0];
    act(() => {
      es.simulateOpen();
      es.simulateEvent("error", {
        documentId: "doc-1",
        workspaceId: "ws-1",
        status: "FAILED",
        message: "Extraction failed",
      });
    });

    expect(result.current.progressState?.status).toBe("FAILED");
    expect(result.current.connectionState).toBe("closed");
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "FAILED",
        message: "Extraction failed",
      }),
    );
    expect(es.readyState).toBe(2);
  });

  it("5. Native EventSource.onerror sets connectionState=error without setting status=FAILED or closing connection", () => {
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useDocumentProgress({
        workspaceId: "ws-1",
        documentId: "doc-1",
        onError,
      }),
    );

    const es = MockEventSource.instances[0];
    act(() => {
      es.simulateOpen();
      es.simulateNativeError();
    });

    expect(result.current.connectionState).toBe("error");
    // Should NOT treat network error as document FAILED
    expect(result.current.progressState).toBeNull();
    expect(onError).not.toHaveBeenCalled();
    expect(es.readyState).toBe(1); // STILL OPEN for native reconnect
  });

  it("6. Component unmount closes EventSource cleanly", () => {
    const { unmount } = renderHook(() =>
      useDocumentProgress({ workspaceId: "ws-1", documentId: "doc-1" }),
    );

    const es = MockEventSource.instances[0];
    expect(es.readyState).not.toBe(2);

    unmount();

    expect(es.readyState).toBe(2); // CLOSED
  });

  it("7. Multiple documents maintain independent EventSource instances and progress states", () => {
    const { result: hook1 } = renderHook(() =>
      useDocumentProgress({ workspaceId: "ws-1", documentId: "doc-A" }),
    );

    const { result: hook2 } = renderHook(() =>
      useDocumentProgress({ workspaceId: "ws-1", documentId: "doc-B" }),
    );

    expect(MockEventSource.instances.length).toBe(2);

    const esA = MockEventSource.instances[0];
    const esB = MockEventSource.instances[1];

    act(() => {
      esA.simulateOpen();
      esB.simulateOpen();
      esA.simulateEvent("progress", {
        documentId: "doc-A",
        progress: 30,
        status: "PROCESSING",
      });
      esB.simulateEvent("progress", {
        documentId: "doc-B",
        progress: 70,
        status: "PROCESSING",
      });
    });

    expect(hook1.current.progressState?.progress).toBe(30);
    expect(hook2.current.progressState?.progress).toBe(70);
  });

  it("8. Malformed event payload is handled gracefully without crashing", () => {
    const { result } = renderHook(() =>
      useDocumentProgress({ workspaceId: "ws-1", documentId: "doc-1" }),
    );

    const es = MockEventSource.instances[0];
    act(() => {
      es.simulateOpen();
      es.simulateEvent("progress", "invalid-non-json-string");
    });

    // Does not throw error, progressState remains null
    expect(result.current.progressState).toBeNull();
  });
});
