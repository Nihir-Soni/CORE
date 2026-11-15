import { useEffect, useState, useRef } from "react";
import { getAccessToken } from "@/lib/auth";

export type ConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "closed"
  | "error";

export type DocumentProgressState = {
  documentId: string;
  workspaceId: string;
  status: "QUEUED" | "PROCESSING" | "READY" | "FAILED";
  progress: number;
  message?: string;
};

interface UseDocumentProgressOptions {
  workspaceId: string | null | undefined;
  documentId: string | null | undefined;
  enabled?: boolean;
  onComplete?: (state: DocumentProgressState) => void;
  onError?: (state: DocumentProgressState) => void;
}

export function useDocumentProgress({
  workspaceId,
  documentId,
  enabled = true,
  onComplete,
  onError,
}: UseDocumentProgressOptions) {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("idle");
  const [progressState, setProgressState] =
    useState<DocumentProgressState | null>(null);

  const callbacksRef = useRef({ onComplete, onError });
  useEffect(() => {
    callbacksRef.current = { onComplete, onError };
  }, [onComplete, onError]);

  useEffect(() => {
    if (!enabled || !workspaceId || !documentId) {
      setConnectionState("idle");
      setProgressState(null);
      return;
    }

    const token = getAccessToken();
    if (!token) {
      setConnectionState("error");
      return;
    }

    setConnectionState("connecting");

    const apiBaseUrl =
      process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
    const url = `${apiBaseUrl}/documents/${workspaceId}/${documentId}/progress?token=${encodeURIComponent(
      token,
    )}`;

    let eventSource: EventSource | null = null;
    let isCleanedUp = false;

    try {
      eventSource = new EventSource(url);
    } catch {
      setConnectionState("error");
      return;
    }

    eventSource.onopen = () => {
      if (!isCleanedUp) {
        setConnectionState("connected");
      }
    };

    // 1. Progress event listener
    const handleProgress = (e: MessageEvent) => {
      if (isCleanedUp) return;
      try {
        const data = JSON.parse(e.data);
        const newState: DocumentProgressState = {
          documentId: data.documentId ?? documentId,
          workspaceId: data.workspaceId ?? workspaceId,
          status: data.status ?? "PROCESSING",
          progress: typeof data.progress === "number" ? data.progress : 0,
          message: data.message,
        };
        setProgressState(newState);
        if (newState.status === "READY") {
          callbacksRef.current.onComplete?.(newState);
        } else if (newState.status === "FAILED") {
          callbacksRef.current.onError?.(newState);
        }
      } catch {
        // Ignore malformed JSON event payload gracefully without crashing
      }
    };

    // 2. Complete terminal event listener (authoritative READY)
    const handleComplete = (e: MessageEvent) => {
      if (isCleanedUp) return;
      let data: any = {};
      try {
        data = JSON.parse(e.data);
      } catch {
        // Fallback
      }
      const finalState: DocumentProgressState = {
        documentId: data.documentId ?? documentId,
        workspaceId: data.workspaceId ?? workspaceId,
        status: "READY",
        progress: 100,
        message: data.message ?? "Document ready",
      };
      setProgressState(finalState);
      setConnectionState("closed");
      callbacksRef.current.onComplete?.(finalState);
      closeConnection();
    };

    // 3. Error backend SSE event listener (authoritative FAILED)
    const handleErrorEvent = (e: MessageEvent) => {
      if (isCleanedUp) return;
      let data: any = {};
      try {
        data = JSON.parse(e.data);
      } catch {
        // Fallback
      }
      const failedState: DocumentProgressState = {
        documentId: data.documentId ?? documentId,
        workspaceId: data.workspaceId ?? workspaceId,
        status: "FAILED",
        progress: data.progress ?? 0,
        message: data.message ?? "Processing failed",
      };
      setProgressState(failedState);
      setConnectionState("closed");
      callbacksRef.current.onError?.(failedState);
      closeConnection();
    };

    // 4. Native EventSource onerror (network error / reconnection)
    // NOTE: Native onerror is NOT treated as a document processing failure.
    // Native EventSource automatically attempts reconnect, during which the API will re-send durable state.
    const handleNativeError = () => {
      if (isCleanedUp) return;
      if (eventSource?.readyState === EventSource.CLOSED) {
        setConnectionState("closed");
      } else {
        setConnectionState("error");
      }
    };

    eventSource.addEventListener("progress", handleProgress);
    eventSource.addEventListener("complete", handleComplete);
    eventSource.addEventListener("error", handleErrorEvent);
    eventSource.onerror = handleNativeError;

    function closeConnection() {
      if (eventSource) {
        eventSource.removeEventListener("progress", handleProgress);
        eventSource.removeEventListener("complete", handleComplete);
        eventSource.removeEventListener("error", handleErrorEvent);
        eventSource.onerror = null;
        eventSource.onopen = null;
        eventSource.close();
        eventSource = null;
      }
    }

    return () => {
      isCleanedUp = true;
      closeConnection();
    };
  }, [workspaceId, documentId, enabled]);

  return {
    connectionState,
    progressState,
  };
}
