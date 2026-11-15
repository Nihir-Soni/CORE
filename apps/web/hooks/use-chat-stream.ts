import { useState, useRef, useCallback, useEffect } from "react";
import { getAccessToken, getWorkspaceId } from "@/lib/auth";
import { SSEChunkParser } from "@/lib/sse-parser";

export type Citation = {
  chunkId: string;
  documentId: string;
  filename: string;
  pageNumber?: number | null;
  chunkIndex: number;
  similarity: number;
  content?: string;
};

export type ChatStreamState = {
  status: "idle" | "connecting" | "streaming" | "complete" | "error";
  answer: string;
  citations: Citation[];
  error?: string;
};

export function useChatStream() {
  const [state, setState] = useState<ChatStreamState>({
    status: "idle",
    answer: "",
    citations: [],
  });

  const mountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  const safeSetState = useCallback((updater: React.SetStateAction<ChatStreamState>) => {
    if (mountedRef.current) {
      setState(updater);
    }
  }, []);

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const sendMessage = useCallback(
    async (
      query: string,
      options?: {
        topK?: number;
        workspaceId?: string;
        mode?: "hybrid" | "vector" | "text";
        maxTokens?: number;
        rerank?: boolean;
        documentIds?: string[];
      },
    ) => {
      const token = getAccessToken();
      const wsId = options?.workspaceId ?? getWorkspaceId();

      if (!token || !wsId) {
        safeSetState({
          status: "error",
          answer: "",
          citations: [],
          error: "Authentication required or missing workspace.",
        });
        return;
      }

      if (!query.trim()) {
        return;
      }

      // Abort any active request before starting a new one
      cancel();

      const controller = new AbortController();
      abortControllerRef.current = controller;

      safeSetState({
        status: "connecting",
        answer: "",
        citations: [],
      });

      const apiBaseUrl =
        process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
      const url = `${apiBaseUrl}/documents/${wsId}/chat`;

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            Accept: "text/event-stream",
          },
          body: JSON.stringify({
            query: query.trim(),
            topK: options?.topK,
            mode: options?.mode,
            maxTokens: options?.maxTokens,
            rerank: options?.rerank,
            documentIds: options?.documentIds && options.documentIds.length > 0 ? options.documentIds : undefined,
            stream: true,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          let errorMsg = "Chat stream request failed";
          try {
            const errJson = await response.json();
            if (errJson.error) errorMsg = errJson.error;
          } catch {
            // Non-JSON error body
          }
          safeSetState({
            status: "error",
            answer: "",
            citations: [],
            error: errorMsg,
          });
          return;
        }

        if (!response.body) {
          safeSetState({
            status: "error",
            answer: "",
            citations: [],
            error: "Response stream unavailable",
          });
          return;
        }

        safeSetState((prev) => ({ ...prev, status: "streaming" }));

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const parser = new SSEChunkParser();

        let accumulatedAnswer = "";
        let accumulatedCitations: Citation[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const textChunk = decoder.decode(value, { stream: true });
          const events = parser.push(textChunk);

          for (const ev of events) {
            if (ev.event === "token") {
              try {
                const parsed = JSON.parse(ev.data);
                if (parsed.text) {
                  accumulatedAnswer += parsed.text;
                  safeSetState({
                    status: "streaming",
                    answer: accumulatedAnswer,
                    citations: accumulatedCitations,
                  });
                }
              } catch {
                // Ignore malformed JSON token payload
              }
            } else if (ev.event === "citations") {
              try {
                const parsed = JSON.parse(ev.data);
                if (Array.isArray(parsed.citations)) {
                  accumulatedCitations = parsed.citations;
                  safeSetState({
                    status: "streaming",
                    answer: accumulatedAnswer,
                    citations: accumulatedCitations,
                  });
                }
              } catch {
                // Ignore malformed citations payload
              }
            } else if (ev.event === "complete") {
              safeSetState({
                status: "complete",
                answer: accumulatedAnswer,
                citations: accumulatedCitations,
              });
              break;
            } else if (ev.event === "error") {
              let errorMsg = "Stream error occurred";
              try {
                const parsed = JSON.parse(ev.data);
                if (parsed.message) errorMsg = parsed.message;
              } catch {
                // Fallback
              }
              safeSetState({
                status: "error",
                answer: accumulatedAnswer,
                citations: accumulatedCitations,
                error: errorMsg,
              });
              return;
            }
          }
        }

        safeSetState((prev) =>
          prev.status === "error"
            ? prev
            : {
                status: "complete",
                answer: accumulatedAnswer,
                citations: accumulatedCitations,
              },
        );
      } catch (err: any) {
        if (err.name === "AbortError") {
          return;
        }
        safeSetState({
          status: "error",
          answer: "",
          citations: [],
          error: err instanceof Error ? err.message : "Network error",
        });
      } finally {
        abortControllerRef.current = null;
      }
    },
    [cancel, safeSetState],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancel();
    };
  }, [cancel]);

  return {
    state,
    sendMessage,
    cancel,
  };
}
