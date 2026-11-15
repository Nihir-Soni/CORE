"use client";

import { useState } from "react";
import { getAccessToken, getWorkspaceId } from "@/lib/auth";

interface SSELogItem {
  timestamp: string;
  type: "info" | "event" | "error" | "complete";
  message: string;
}

export default function EventsTestPage() {
  const [logs, setLogs] = useState<SSELogItem[]>([]);
  const [status, setStatus] = useState<
    "idle" | "connecting" | "streaming" | "completed" | "error"
  >("idle");

  const [documentId, setDocumentId] = useState("");
  const [progressState, setProgressState] = useState<{
    docId?: string;
    status?: string;
    progress?: number;
    message?: string;
  }>({});

  const addLog = (
    type: "info" | "event" | "error" | "complete",
    message: string,
  ) => {
    setLogs((prev) => [
      ...prev,
      {
        timestamp: new Date().toLocaleTimeString(),
        type,
        message,
      },
    ]);
  };

  const startTestEndpoint = () => {
    const token = getAccessToken();
    const workspaceId = getWorkspaceId();

    if (!token) {
      addLog("error", "No access token found in auth state. Please log in.");
      setStatus("error");
      return;
    }

    if (!workspaceId) {
      addLog("error", "No workspace ID found in auth state.");
      setStatus("error");
      return;
    }

    setLogs([]);
    setStatus("connecting");
    addLog("info", `Initiating test EventSource to workspace: ${workspaceId}`);

    const apiBaseUrl =
      process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
    const url = `${apiBaseUrl}/events/${workspaceId}/test?token=${encodeURIComponent(
      token,
    )}`;

    const eventSource = new EventSource(url);

    eventSource.onopen = () => {
      setStatus("streaming");
      addLog("info", "SSE connection opened successfully.");
    };

    eventSource.addEventListener("connected", (e: MessageEvent) => {
      addLog("event", `Received [connected]: ${e.data}`);
    });

    eventSource.addEventListener("test", (e: MessageEvent) => {
      addLog("event", `Received [test]: ${e.data}`);
    });

    eventSource.addEventListener("complete", (e: MessageEvent) => {
      addLog("complete", `Received [complete]: ${e.data}`);
      setStatus("completed");
      addLog("info", "Closing EventSource connection.");
      eventSource.close();
    });

    eventSource.onerror = (err) => {
      if (eventSource.readyState === EventSource.CLOSED) {
        addLog("info", "EventSource closed cleanly.");
      } else {
        addLog("error", `EventSource error occurred: ${JSON.stringify(err)}`);
        setStatus("error");
        eventSource.close();
      }
    };
  };

  const startDocumentProgressStream = () => {
    const token = getAccessToken();
    const workspaceId = getWorkspaceId();

    if (!token || !workspaceId) {
      addLog("error", "Missing access token or workspace ID.");
      setStatus("error");
      return;
    }

    if (!documentId.trim()) {
      addLog("error", "Please enter a valid Document ID.");
      setStatus("error");
      return;
    }

    setLogs([]);
    setStatus("connecting");
    setProgressState({});
    addLog("info", `Initiating Document Progress EventSource for document: ${documentId}`);

    const apiBaseUrl =
      process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
    const url = `${apiBaseUrl}/documents/${workspaceId}/${documentId.trim()}/progress?token=${encodeURIComponent(
      token,
    )}`;

    const eventSource = new EventSource(url);

    eventSource.onopen = () => {
      setStatus("streaming");
      addLog("info", "Document Progress SSE connection opened.");
    };

    eventSource.addEventListener("progress", (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data);
        setProgressState({
          docId: parsed.documentId,
          status: parsed.status,
          progress: parsed.progress,
          message: parsed.message,
        });
        addLog("event", `Progress Update: ${parsed.status} (${parsed.progress}%) - ${parsed.message ?? ""}`);
      } catch {
        addLog("event", `Received raw progress: ${e.data}`);
      }
    });

    eventSource.addEventListener("complete", (e: MessageEvent) => {
      addLog("complete", `Terminal READY complete: ${e.data}`);
      setStatus("completed");
      eventSource.close();
    });

    eventSource.addEventListener("error", (e: MessageEvent) => {
      addLog("error", `Terminal FAILED or SSE error: ${e.data || "Stream closed"}`);
      setStatus("error");
      eventSource.close();
    });
  };

  return (
    <div style={{ padding: "2rem", fontFamily: "sans-serif", maxWidth: "800px" }}>
      <h1>Phase 8.2 — Document Progress Verification</h1>
      <p style={{ color: "#666" }}>
        Verification interface for live Worker $\rightarrow$ SSE document progress streaming.
      </p>

      <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem" }}>
        <button
          onClick={startTestEndpoint}
          style={{
            padding: "0.6rem 1.2rem",
            backgroundColor: "#4f46e5",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontWeight: "600",
          }}
        >
          Test Transport Endpoint
        </button>
      </div>

      <div
        style={{
          padding: "1rem",
          background: "#f3f4f6",
          borderRadius: "8px",
          marginBottom: "1.5rem",
        }}
      >
        <h3 style={{ marginTop: 0 }}>Document Progress Stream</h3>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
          <input
            type="text"
            placeholder="Enter Document ID"
            value={documentId}
            onChange={(e) => setDocumentId(e.target.value)}
            style={{
              flex: 1,
              padding: "0.5rem",
              borderRadius: "4px",
              border: "1px solid #ccc",
            }}
          />
          <button
            onClick={startDocumentProgressStream}
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "600",
            }}
          >
            Connect Progress Stream
          </button>
        </div>

        {progressState.docId && (
          <div
            style={{
              padding: "0.8rem",
              background: "#fff",
              borderRadius: "6px",
              border: "1px solid #e5e7eb",
            }}
          >
            <div><strong>Document ID:</strong> {progressState.docId}</div>
            <div>
              <strong>Current Status:</strong>{" "}
              <span style={{ fontWeight: "bold", color: getStatusColor(progressState.status ?? "") }}>
                {progressState.status}
              </span>
            </div>
            <div><strong>Progress:</strong> {progressState.progress}%</div>
            <div><strong>Message:</strong> {progressState.message}</div>
          </div>
        )}
      </div>

      <div style={{ marginBottom: "0.5rem", fontWeight: "bold" }}>
        Connection State: <span style={{ color: getStatusColor(status) }}>{status}</span>
      </div>

      <div
        style={{
          background: "#1e1e1e",
          color: "#d4d4d4",
          padding: "1rem",
          borderRadius: "8px",
          minHeight: "200px",
          fontFamily: "monospace",
          fontSize: "14px",
          overflowY: "auto",
        }}
      >
        {logs.length === 0 ? (
          <div style={{ color: "#888" }}>
            Ready to log events...
          </div>
        ) : (
          logs.map((log, idx) => (
            <div key={idx} style={{ marginBottom: "0.4rem" }}>
              <span style={{ color: "#666" }}>[{log.timestamp}]</span>{" "}
              <span style={{ color: getLogColor(log.type) }}>[{log.type.toUpperCase()}]</span>{" "}
              {log.message}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function getStatusColor(status: string) {
  switch (status.toLowerCase()) {
    case "streaming":
    case "processing":
      return "#2563eb";
    case "completed":
    case "ready":
      return "#16a34a";
    case "error":
    case "failed":
      return "#dc2626";
    default:
      return "#666";
  }
}

function getLogColor(type: string) {
  switch (type) {
    case "event":
      return "#38bdf8";
    case "complete":
      return "#4ade80";
    case "error":
      return "#f87171";
    default:
      return "#9ca3af";
  }
}
