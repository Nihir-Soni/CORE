import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import AnalyticsPage from "../page";
import * as api from "@/lib/api";
import * as auth from "@/lib/auth";
import * as chatHistory from "@/lib/chat-history";
import type { WorkspaceAnalytics } from "@/lib/types";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getWorkspaceAnalytics: vi.fn(),
  };
});

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getWorkspaceId: vi.fn(),
    getCurrentUser: vi.fn(),
  };
});

vi.mock("@/lib/chat-history", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat-history")>();
  return {
    ...actual,
    loadChatSessions: vi.fn(),
  };
});

describe("AnalyticsPage", () => {
  const mockAnalytics: WorkspaceAnalytics = {
    documentStats: {
      totalDocuments: 12,
      byStatus: {
        READY: 10,
        PROCESSING: 1,
        UPLOADING: 1,
        FAILED: 0,
        DELETING: 0,
      },
      processingSuccessRate: 98.5,
      totalJobs: 15,
      jobsByStatus: {
        QUEUED: 1,
        PROCESSING: 1,
        COMPLETED: 13,
        FAILED: 0,
      },
      avgProcessingDurationSec: 3.2,
      totalPagesExtracted: 84,
      totalCharsExtracted: 154200,
      byMimeType: [
        {
          mimeType: "application/pdf",
          label: "PDF Document",
          count: 8,
          totalBytes: 8388608,
          percentage: 80,
        },
        {
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          label: "Word Document (DOCX)",
          count: 4,
          totalBytes: 2097152,
          percentage: 20,
        },
      ],
      recentTrend: [
        { date: "2026-11-13", uploads: 2, ready: 2 },
        { date: "2026-11-14", uploads: 5, ready: 4 },
        { date: "2026-11-15", uploads: 5, ready: 4 },
      ],
    },
    storageStats: {
      totalBytes: 10485760, // 10 MiB
      avgSizeBytes: 873813,
      largestDocument: {
        id: "doc-large",
        filename: "Quarterly_Financials.pdf",
        sizeBytes: 4194304,
        mimeType: "application/pdf",
      },
      byCategory: [
        { category: "PDF", count: 8, bytes: 8388608, percentage: 80 },
        { category: "Word / Text", count: 4, bytes: 2097152, percentage: 20 },
      ],
      largestDocuments: [
        {
          id: "doc-large",
          filename: "Quarterly_Financials.pdf",
          sizeBytes: 4194304,
          mimeType: "application/pdf",
          createdAt: "2026-11-15T10:00:00.000Z",
        },
      ],
    },
    aiStats: {
      totalChunks: 240,
      totalEmbeddings: 240,
      totalIndexedTokens: 48000,
      avgTokensPerChunk: 200,
      avgChunksPerDocument: 20,
      embeddingModel: "gemini-embedding-001 (768-dim)",
      chatModel: "gemini-3.8-flash",
    },
    queryStats: {
      totalAuditEvents: 45,
      totalDownloads: 18,
      totalUploadEvents: 12,
      totalDeleteEvents: 2,
      totalMemberEvents: 3,
    },
  };

  const mockChatSessions: chatHistory.ChatSession[] = [
    {
      id: "session-1",
      userId: "user-1",
      workspaceId: "ws-123",
      title: "Budget Review",
      createdAt: "2026-11-15T12:00:00.000Z",
      updatedAt: "2026-11-15T12:30:00.000Z",
      selectedDocumentIds: ["doc-large"],
      messages: [
        {
          id: "m-1",
          role: "user",
          text: "What was our Q3 EBITDA?",
          citations: [],
          timestamp: "2026-11-15T12:00:00.000Z",
        },
        {
          id: "m-2",
          role: "assistant",
          text: "Q3 EBITDA was $4.2M according to page 12.",
          citations: [
            {
              chunkId: "c-1",
              documentId: "doc-large",
              filename: "Quarterly_Financials.pdf",
              pageNumber: 12,
              chunkIndex: 0,
              similarity: 0.95,
              content: "EBITDA was $4.2M",
            },
          ],
          timestamp: "2026-11-15T12:00:05.000Z",
        },
      ],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth.getWorkspaceId).mockReturnValue("ws-123");
    vi.mocked(auth.getCurrentUser).mockReturnValue({
      userId: "user-1",
      email: "user@example.com",
    });
    vi.mocked(api.getWorkspaceAnalytics).mockResolvedValue(mockAnalytics);
    vi.mocked(chatHistory.loadChatSessions).mockReturnValue(mockChatSessions);
  });

  it("renders page header and executive overview metrics", async () => {
    render(<AnalyticsPage />);

    await waitFor(() => {
      expect(screen.getByText("Analytics")).toBeTruthy();
    });

    // Check KPI Overview banner cards
    expect(screen.getByText("Total Documents")).toBeTruthy();
    expect(screen.getByText("Storage Consumed")).toBeTruthy();
    expect(screen.getByText("AI Embeddings")).toBeTruthy();
    expect(screen.getByText("Queries & Activity")).toBeTruthy();

    // Check total doc count value
    expect(screen.getAllByText("12").length).toBeGreaterThan(0);
  });

  it("renders document processing statistics section", async () => {
    render(<AnalyticsPage />);

    await waitFor(() => {
      expect(screen.getByText("Document Processing Statistics")).toBeTruthy();
    });

    expect(screen.getByText("98.5% Success Rate")).toBeTruthy();
    expect(screen.getByText("Ready / Indexed")).toBeTruthy();
    expect(screen.getByText("10")).toBeTruthy(); // 10 ready
    expect(screen.getByText("Worker Jobs")).toBeTruthy();
    expect(screen.getByText("Total Pages Parsed")).toBeTruthy();
    expect(screen.getByText("84")).toBeTruthy(); // 84 pages
    expect(screen.getByText("Total Characters")).toBeTruthy();
    expect(screen.getByText("Avg Pages / Doc")).toBeTruthy();
    expect(screen.getByText("3.2s")).toBeTruthy(); // avg duration
  });

  it("renders storage consumption section with breakdown and top consumers", async () => {
    render(<AnalyticsPage />);

    await waitFor(() => {
      expect(screen.getByText("Storage Consumption")).toBeTruthy();
    });

    expect(screen.getByText("Top Storage Consumers")).toBeTruthy();
    expect(screen.getByText("Quarterly_Financials.pdf")).toBeTruthy();
    expect(screen.getByText("10.0 MiB total")).toBeTruthy();
  });

  it("renders AI usage and model details section", async () => {
    render(<AnalyticsPage />);

    await waitFor(() => {
      expect(screen.getByText("AI Usage & Ingestion")).toBeTruthy();
    });

    expect(screen.getByText("Vector Embeddings")).toBeTruthy();
    expect(screen.getAllByText("240").length).toBeGreaterThan(0); // chunks & embeddings
    expect(screen.getByText("48,000")).toBeTruthy(); // tokens
    expect(screen.getByText("gemini-3.8-flash")).toBeTruthy();
  });

  it("renders query counts and user interaction statistics", async () => {
    render(<AnalyticsPage />);

    await waitFor(() => {
      expect(screen.getByText("Query Counts & Interactions")).toBeTruthy();
    });

    expect(screen.getByText("Chat Queries")).toBeTruthy();
    expect(screen.getByText("AI Responses")).toBeTruthy();
    expect(screen.getByText("Citations Generated")).toBeTruthy();
    expect(screen.getByText("Targeted Queries")).toBeTruthy();
    expect(screen.getByText("Document Downloads")).toBeTruthy();
    expect(screen.getByText("18")).toBeTruthy(); // downloads
  });

  it("refreshes analytics when refresh button is clicked", async () => {
    render(<AnalyticsPage />);

    await waitFor(() => {
      expect(screen.getByText("Analytics")).toBeTruthy();
    });

    const refreshBtn = screen.getByRole("button", { name: /Refresh/i });
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(api.getWorkspaceAnalytics).toHaveBeenCalledTimes(2);
    });
  });

  it("displays error message and allows retrying when API fails", async () => {
    vi.mocked(api.getWorkspaceAnalytics).mockRejectedValueOnce(new Error("Network timeout"));

    render(<AnalyticsPage />);

    await waitFor(() => {
      expect(screen.getByText("Unable to Load Analytics")).toBeTruthy();
    });

    expect(screen.getByText("Failed to load workspace analytics.")).toBeTruthy();
    const tryAgainBtn = screen.getByRole("button", { name: /Try Again/i });

    // Click retry
    fireEvent.click(tryAgainBtn);

    await waitFor(() => {
      expect(screen.getByText("Document Processing Statistics")).toBeTruthy();
    });
  });
});
