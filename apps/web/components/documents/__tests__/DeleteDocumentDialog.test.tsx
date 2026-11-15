import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DeleteDocumentDialog } from "../DeleteDocumentDialog";
import * as api from "@/lib/api";
import type { Document, DeleteDocumentResponse } from "@/lib/types";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    deleteDocument: vi.fn(),
  };
});

describe("DeleteDocumentDialog", () => {
  const mockDoc: Document = {
    id: "doc-123",
    workspaceId: "ws-456",
    uploadedById: "user-789",
    filename: "contract-q3.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1048576,
    storageKey: "workspaces/ws-456/contract-q3.pdf",
    sha256: "abcdef123456",
    status: "READY",
    createdAt: "2026-10-12T10:00:00.000Z",
  };

  const onSuccess = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clearly identifies the document by filename and displays impact & destructive warnings", () => {
    render(
      <DeleteDocumentDialog
        document={mockDoc}
        workspaceId="ws-456"
        onSuccess={onSuccess}
        onClose={onClose}
      />
    );

    // Filename displayed
    expect(screen.getByText("contract-q3.pdf")).toBeTruthy();

    // Impact description
    expect(
      screen.getByText(/removes it from CHiE and makes it unavailable for retrieval and chat citations/i)
    ).toBeTruthy();

    // Destructive warning
    expect(screen.getByText(/action is destructive and cannot be undone/i)).toBeTruthy();

    // Cancel and Delete buttons present
    expect(screen.getByRole("button", { name: /cancel/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /delete document/i })).toBeTruthy();
  });

  it("closes without making an API request when Cancel is selected", () => {
    render(
      <DeleteDocumentDialog
        document={mockDoc}
        workspaceId="ws-456"
        onSuccess={onSuccess}
        onClose={onClose}
      />
    );

    const cancelButton = screen.getByRole("button", { name: /cancel/i });
    fireEvent.click(cancelButton);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(api.deleteDocument).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("closes on Escape key when deletion is not in progress", () => {
    render(
      <DeleteDocumentDialog
        document={mockDoc}
        workspaceId="ws-456"
        onSuccess={onSuccess}
        onClose={onClose}
      />
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(api.deleteDocument).not.toHaveBeenCalled();
  });

  it("calls deleteDocument with the correct workspace and document IDs on confirmation", async () => {
    vi.mocked(api.deleteDocument).mockResolvedValueOnce({
      ok: true,
      documentId: "doc-123",
      status: "DELETED",
    });

    render(
      <DeleteDocumentDialog
        document={mockDoc}
        workspaceId="ws-456"
        onSuccess={onSuccess}
        onClose={onClose}
      />
    );

    const confirmButton = screen.getByRole("button", { name: /delete document/i });
    fireEvent.click(confirmButton);

    expect(api.deleteDocument).toHaveBeenCalledWith("ws-456", "doc-123");

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith("doc-123");
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("prevents duplicate submissions while a deletion request is in progress", async () => {
    let resolveDelete!: (val: DeleteDocumentResponse) => void;
    vi.mocked(api.deleteDocument).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDelete = resolve;
      })
    );

    render(
      <DeleteDocumentDialog
        document={mockDoc}
        workspaceId="ws-456"
        onSuccess={onSuccess}
        onClose={onClose}
      />
    );

    const confirmButton = screen.getByRole("button", { name: /delete document/i });
    const cancelButton = screen.getByRole("button", { name: /cancel/i });

    // First click initiates deletion
    fireEvent.click(confirmButton);

    expect(api.deleteDocument).toHaveBeenCalledTimes(1);
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true);
    expect((cancelButton as HTMLButtonElement).disabled).toBe(true);

    // Second click during in-flight request is ignored
    fireEvent.click(confirmButton);
    expect(api.deleteDocument).toHaveBeenCalledTimes(1);

    // Escape key ignored while in-flight
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    // Resolve deletion
    resolveDelete({ ok: true, documentId: "doc-123", status: "DELETED" });

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith("doc-123");
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("handles 401 Unauthorized response correctly", async () => {
    vi.mocked(api.deleteDocument).mockRejectedValueOnce(
      new api.ApiError("Unauthorized", 401)
    );

    render(
      <DeleteDocumentDialog
        document={mockDoc}
        workspaceId="ws-456"
        onSuccess={onSuccess}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /delete document/i }));

    await waitFor(() => {
      expect(screen.getByText(/session has expired or is invalid/i)).toBeTruthy();
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("handles 403 Forbidden response correctly", async () => {
    vi.mocked(api.deleteDocument).mockRejectedValueOnce(
      new api.ApiError("forbidden", 403)
    );

    render(
      <DeleteDocumentDialog
        document={mockDoc}
        workspaceId="ws-456"
        onSuccess={onSuccess}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /delete document/i }));

    await waitFor(() => {
      expect(screen.getByText(/not authorized to delete documents in this workspace/i)).toBeTruthy();
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("handles 404 Not Found response correctly", async () => {
    vi.mocked(api.deleteDocument).mockRejectedValueOnce(
      new api.ApiError("not_found", 404)
    );

    render(
      <DeleteDocumentDialog
        document={mockDoc}
        workspaceId="ws-456"
        onSuccess={onSuccess}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /delete document/i }));

    await waitFor(() => {
      expect(screen.getByText(/no longer available in this workspace/i)).toBeTruthy();
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("handles 502 storage_cleanup_failed as incomplete deletion and provides retry", async () => {
    vi.mocked(api.deleteDocument).mockRejectedValueOnce(
      new api.ApiError("storage_cleanup_failed", 502, {
        error: "storage_cleanup_failed",
        documentId: "doc-123",
        status: "DELETING",
      })
    );

    render(
      <DeleteDocumentDialog
        document={mockDoc}
        workspaceId="ws-456"
        onSuccess={onSuccess}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /delete document/i }));

    await waitFor(() => {
      // Incomplete deletion notice
      expect(screen.getByText(/deletion is incomplete: storage cleanup failed/i)).toBeTruthy();
      expect(screen.getByText(/document has been marked as deleting and is unavailable/i)).toBeTruthy();
    });

    // Not marked as complete success
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    // Shows retry button
    const retryButton = screen.getByRole("button", { name: /retry deletion/i });
    expect(retryButton).toBeTruthy();

    // Clicking retry attempts deletion again
    vi.mocked(api.deleteDocument).mockResolvedValueOnce({
      ok: true,
      documentId: "doc-123",
      status: "DELETED",
    });

    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(api.deleteDocument).toHaveBeenCalledTimes(2);
      expect(onSuccess).toHaveBeenCalledWith("doc-123");
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("handles unexpected network failures gracefully without crashing", async () => {
    vi.mocked(api.deleteDocument).mockRejectedValueOnce(new TypeError("Failed to fetch"));

    render(
      <DeleteDocumentDialog
        document={mockDoc}
        workspaceId="ws-456"
        onSuccess={onSuccess}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /delete document/i }));

    await waitFor(() => {
      expect(screen.getByText(/network or communication error occurred/i)).toBeTruthy();
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
