import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { CitationSourcePanel } from "../CitationSourcePanel";
import type { Citation, Document } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  getDocumentContent: vi.fn(),
  getDocumentFileUrl: vi.fn((workspaceId, docId, disposition) => `http://mock/${workspaceId}/${docId}?disp=${disposition}`),
  downloadDocument: vi.fn(),
}));

import { getDocumentContent, downloadDocument } from "@/lib/api";

describe("CitationSourcePanel", () => {
  const dummyCitation: Citation = {
    chunkId: "chunk-42",
    documentId: "doc-123",
    filename: "Annual_Report_2025.pdf",
    pageNumber: 7,
    chunkIndex: 2,
    similarity: 0.94,
    content: "Revenue grew by 24% year-over-year reaching $12.4M in Q4.",
  };

  const dummyDoc: Document = {
    id: "doc-123",
    workspaceId: "ws-abc",
    uploadedById: "user-1",
    filename: "Annual_Report_2025.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024 * 512,
    storageKey: "keys/doc-123",
    sha256: null,
    status: "READY",
    createdAt: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders document name, relevant page number, and highlighted matching passage", async () => {
    (getDocumentContent as any).mockResolvedValue({
      documentId: "doc-123",
      charCount: 200,
      pageCount: 10,
      text: "Executive Summary.\nRevenue grew by 24% year-over-year reaching $12.4M in Q4.\nFuture Outlook.",
    });

    render(
      <CitationSourcePanel
        citation={dummyCitation}
        citationIndex={0}
        workspaceId="ws-abc"
        onClose={vi.fn()}
      />
    );

    // Document name
    expect(screen.getByText("Annual_Report_2025.pdf")).toBeTruthy();

    // Relevant page number
    expect(screen.getByText("Page 7")).toBeTruthy();

    // Highlighted matching passage section
    expect(screen.getByText(/Revenue grew by 24% year-over-year/)).toBeTruthy();

    // Original extracted text section header
    expect(screen.getByText("Original Extracted Text")).toBeTruthy();

    // Wait for extracted text to load
    await waitFor(() => {
      expect(screen.getByText(/Executive Summary/)).toBeTruthy();
    });
  });

  it("calls onOpenDocument when 'Open Document' button is clicked", async () => {
    (getDocumentContent as any).mockResolvedValue({
      documentId: "doc-123",
      charCount: 100,
      pageCount: 5,
      text: "Full text content.",
    });

    const onOpenDocument = vi.fn();
    const onClose = vi.fn();

    render(
      <CitationSourcePanel
        citation={dummyCitation}
        citationIndex={0}
        workspaceId="ws-abc"
        availableDocuments={[dummyDoc]}
        onOpenDocument={onOpenDocument}
        onClose={onClose}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Full text content/)).toBeTruthy();
    });

    const openBtn = screen.getByRole("button", { name: /Open Document/i });
    act(() => {
      fireEvent.click(openBtn);
    });

    expect(onOpenDocument).toHaveBeenCalledWith(dummyDoc);
    expect(onClose).toHaveBeenCalled();
  });

  it("calls downloadDocument when Download button is clicked", async () => {
    (getDocumentContent as any).mockResolvedValue({
      documentId: "doc-123",
      charCount: 100,
      pageCount: 5,
      text: "Full text content.",
    });
    (downloadDocument as any).mockResolvedValue(undefined);

    render(
      <CitationSourcePanel
        citation={dummyCitation}
        citationIndex={0}
        workspaceId="ws-abc"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Full text content/)).toBeTruthy();
    });

    const downloadBtn = screen.getByRole("button", { name: /Download/i });
    await act(async () => {
      fireEvent.click(downloadBtn);
    });

    expect(downloadDocument).toHaveBeenCalledWith("ws-abc", {
      id: "doc-123",
      filename: "Annual_Report_2025.pdf",
    });
  });

  it("calls onClose when close button or Escape key is pressed", async () => {
    (getDocumentContent as any).mockResolvedValue({
      documentId: "doc-123",
      charCount: 100,
      pageCount: 5,
      text: "Full text content.",
    });

    const onClose = vi.fn();

    render(
      <CitationSourcePanel
        citation={dummyCitation}
        citationIndex={0}
        workspaceId="ws-abc"
        onClose={onClose}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Full text content/)).toBeTruthy();
    });

    // Close button
    const closeBtn = screen.getByLabelText("Close source panel");
    act(() => {
      fireEvent.click(closeBtn);
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Escape key
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
