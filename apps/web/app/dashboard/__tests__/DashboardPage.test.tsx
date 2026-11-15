import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import DashboardPage from "../page";
import * as api from "@/lib/api";
import * as auth from "@/lib/auth";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getWorkspace: vi.fn(),
    getDocuments: vi.fn(),
    downloadDocument: vi.fn(),
    getMe: vi.fn(),
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

describe("DashboardPage", () => {
  const mockWorkspace = {
    id: "ws-1",
    name: "Engineering Docs",
    orgId: "org-1",
  };

  const mockDocuments = [
    {
      id: "doc-1",
      workspaceId: "ws-1",
      uploadedById: "u-1",
      filename: "architecture.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      storageKey: "key-1",
      sha256: "hash-1",
      status: "READY" as const,
      createdAt: "2026-10-12T10:00:00.000Z",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth.getWorkspaceId).mockReturnValue("ws-1");
    vi.mocked(api.getWorkspace).mockResolvedValue(mockWorkspace);
    vi.mocked(api.getDocuments).mockResolvedValue(mockDocuments);
    vi.mocked(api.getMe).mockResolvedValue({
      id: "u-1",
      email: "alice@example.com",
      name: "Alice Wonderland",
    });
    vi.mocked(auth.getCurrentUser).mockReturnValue({
      userId: "u-1",
      email: "alice@example.com",
      name: "Alice Wonderland",
    });
  });

  it("renders the user's name in the header greeting and user profile badge", async () => {
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("Welcome back, Alice Wonderland")).toBeDefined();
    });

    const userDisplayName = document.getElementById("user-display-name");
    expect(userDisplayName?.textContent).toBe("Alice Wonderland");
    const userDisplayEmail = document.getElementById("user-display-email");
    expect(userDisplayEmail?.textContent).toBe("alice@example.com");
    expect(screen.getByText("Engineering Docs")).toBeDefined();
  });

  it("fetches profile from getMe() when token does not have name initially", async () => {
    vi.mocked(auth.getCurrentUser).mockReturnValue({
      userId: "u-2",
      email: "bob@example.com",
      name: null,
    });
    vi.mocked(api.getMe).mockResolvedValue({
      id: "u-2",
      email: "bob@example.com",
      name: "Bob The Builder",
    });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("Welcome back, Bob The Builder")).toBeDefined();
    });

    const userDisplayName = document.getElementById("user-display-name");
    expect(userDisplayName?.textContent).toBe("Bob The Builder");
    const userDisplayEmail = document.getElementById("user-display-email");
    expect(userDisplayEmail?.textContent).toBe("bob@example.com");
  });

  it("falls back gracefully when user name is not provided anywhere", async () => {
    vi.mocked(auth.getCurrentUser).mockReturnValue({
      userId: "u-3",
      email: "charlie@example.com",
      name: null,
    });
    vi.mocked(api.getMe).mockResolvedValue({
      id: "u-3",
      email: "charlie@example.com",
      name: null,
    });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Dashboard" })).toBeDefined();
    });

    const userDisplayName = document.getElementById("user-display-name");
    expect(userDisplayName?.textContent).toBe("User");
    const userDisplayEmail = document.getElementById("user-display-email");
    expect(userDisplayEmail?.textContent).toBe("charlie@example.com");
  });
});
