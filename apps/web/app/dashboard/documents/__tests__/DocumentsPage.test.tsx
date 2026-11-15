import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import DocumentsPage from "../page";
import * as api from "@/lib/api";
import * as auth from "@/lib/auth";
import type { Document } from "@/lib/types";

vi.mock("@/lib/auth", () => ({
  getWorkspaceId: vi.fn(),
  getAccessToken: vi.fn(),
  getRefreshToken: vi.fn(),
  isAuthenticated: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getDocuments: vi.fn(),
    getWorkspaceRole: vi.fn(),
    deleteDocument: vi.fn(),
    downloadDocument: vi.fn(),
  };
});

describe("DocumentsPage — Role-aware Document Deletion", () => {
  const mockDocuments: Document[] = [
    {
      id: "doc-1",
      workspaceId: "ws-test-1",
      uploadedById: "user-1",
      filename: "financial-report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      storageKey: "workspaces/ws-test-1/financial-report.pdf",
      sha256: "sha1",
      status: "READY",
      createdAt: "2026-10-12T00:00:00.000Z",
    },
    {
      id: "doc-2",
      workspaceId: "ws-test-1",
      uploadedById: "user-2",
      filename: "architecture.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 4096,
      storageKey: "workspaces/ws-test-1/architecture.docx",
      sha256: "sha2",
      status: "READY",
      createdAt: "2026-10-12T01:00:00.000Z",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth.getWorkspaceId).mockReturnValue("ws-test-1");
    vi.mocked(api.getDocuments).mockResolvedValue([...mockDocuments]);
  });

  it("ADMIN sees the Delete action on document entries", async () => {
    vi.mocked(api.getWorkspaceRole).mockResolvedValue("ADMIN");

    render(<DocumentsPage />);

    // Wait for document table to render
    await waitFor(() => {
      expect(screen.getByText("financial-report.pdf")).toBeTruthy();
    });

    // Delete actions should be visible
    await waitFor(() => {
      const deleteButtons = screen.getAllByRole("button", { name: /delete/i });
      expect(deleteButtons.length).toBe(2);
    });
  });

  it("OWNER sees the Delete action on document entries", async () => {
    vi.mocked(api.getWorkspaceRole).mockResolvedValue("OWNER");

    render(<DocumentsPage />);

    await waitFor(() => {
      expect(screen.getByText("financial-report.pdf")).toBeTruthy();
    });

    await waitFor(() => {
      const deleteButtons = screen.getAllByRole("button", { name: /delete/i });
      expect(deleteButtons.length).toBe(2);
    });
  });

  it("MEMBER does NOT see the Delete action", async () => {
    vi.mocked(api.getWorkspaceRole).mockResolvedValue("MEMBER");

    render(<DocumentsPage />);

    await waitFor(() => {
      expect(screen.getByText("financial-report.pdf")).toBeTruthy();
    });

    // View and Download exist, but Delete does not
    expect(screen.getAllByRole("button", { name: /^view/i }).length).toBe(2);
    expect(screen.getAllByRole("button", { name: /^download/i }).length).toBe(2);
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("users with unknown or null role do NOT see the Delete action", async () => {
    vi.mocked(api.getWorkspaceRole).mockResolvedValue(null);

    render(<DocumentsPage />);

    await waitFor(() => {
      expect(screen.getByText("financial-report.pdf")).toBeTruthy();
    });

    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("clicking Delete opens the confirmation dialog with the document details", async () => {
    vi.mocked(api.getWorkspaceRole).mockResolvedValue("ADMIN");

    render(<DocumentsPage />);

    await waitFor(() => {
      expect(screen.getByText("financial-report.pdf")).toBeTruthy();
    });

    // Wait for role check to finish and delete button to appear
    const deleteBtn = await screen.findByRole("button", { name: "Delete financial-report.pdf" });
    fireEvent.click(deleteBtn);

    // Dialog is displayed
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Delete Document")).toBeTruthy();
    expect(screen.getAllByText("financial-report.pdf").length).toBeGreaterThan(1);
    expect(screen.getByRole("button", { name: /cancel/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /delete document/i })).toBeTruthy();
  });

  it("Cancel closes the dialog without calling the delete API", async () => {
    vi.mocked(api.getWorkspaceRole).mockResolvedValue("ADMIN");

    render(<DocumentsPage />);

    await waitFor(() => {
      expect(screen.getByText("financial-report.pdf")).toBeTruthy();
    });

    const deleteBtn = await screen.findByRole("button", { name: "Delete financial-report.pdf" });
    fireEvent.click(deleteBtn);
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    // Dialog closes
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.deleteDocument).not.toHaveBeenCalled();
  });

  it("confirming deletion calls DELETE endpoint and updates the document list with notification", async () => {
    vi.mocked(api.getWorkspaceRole).mockResolvedValue("ADMIN");
    vi.mocked(api.deleteDocument).mockResolvedValue({
      ok: true,
      documentId: "doc-1",
      status: "DELETED",
    });

    render(<DocumentsPage />);

    await waitFor(() => {
      expect(screen.getByText("financial-report.pdf")).toBeTruthy();
    });

    const deleteBtn = await screen.findByRole("button", { name: "Delete financial-report.pdf" });
    fireEvent.click(deleteBtn);

    // Now mock subsequent fetch to only return the remaining document
    vi.mocked(api.getDocuments).mockResolvedValue([mockDocuments[1]]);

    const confirmButton = screen.getByRole("button", { name: /delete document/i });
    fireEvent.click(confirmButton);

    expect(api.deleteDocument).toHaveBeenCalledWith("ws-test-1", "doc-1");

    await waitFor(() => {
      // Dialog closes
      expect(screen.queryByRole("dialog")).toBeNull();
      // Notification banner appears
      expect(screen.getByText(/Document "financial-report.pdf" was successfully deleted/i)).toBeTruthy();
      // First document is removed from view
      expect(screen.queryByText("financial-report.pdf")).toBeNull();
      // Second document remains
      expect(screen.getByText("architecture.docx")).toBeTruthy();
    });
  });

  it("displays 'Retry Delete' for a document in DELETING status", async () => {
    const deletingDoc: Document = {
      ...mockDocuments[0],
      id: "doc-deleting",
      filename: "pending-removal.pdf",
      status: "DELETING",
    };
    vi.mocked(api.getDocuments).mockResolvedValue([deletingDoc]);
    vi.mocked(api.getWorkspaceRole).mockResolvedValue("OWNER");

    render(<DocumentsPage />);

    await waitFor(() => {
      expect(screen.getByText("pending-removal.pdf")).toBeTruthy();
    });

    // Status badge shows Deleting
    expect(screen.getByText("Deleting")).toBeTruthy();

    // Delete button shows Retry Delete
    const retryBtn = await screen.findByRole("button", { name: "Retry deleting pending-removal.pdf" });
    expect(retryBtn).toBeTruthy();
    expect(retryBtn.textContent).toContain("Retry Delete");
  });
});
