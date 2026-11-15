import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkspaceSwitcher } from "../WorkspaceSwitcher";
import * as api from "@/lib/api";
import * as auth from "@/lib/auth";

const mockWorkspaces = [
  {
    id: "ws-1",
    name: "Default Workspace",
    orgId: "org-1",
    role: "OWNER",
    documentCount: 5,
    memberCount: 2,
  },
  {
    id: "ws-2",
    name: "Project Atlas",
    orgId: "org-1",
    role: "MEMBER",
    documentCount: 3,
    memberCount: 4,
  },
];

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getWorkspaces: vi.fn(),
    getWorkspace: vi.fn(),
    createWorkspace: vi.fn(),
  };
});

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getWorkspaceId: vi.fn(),
    setWorkspaceId: vi.fn(),
  };
});

describe("WorkspaceSwitcher", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth.getWorkspaceId).mockReturnValue("ws-1");
    vi.mocked(api.getWorkspaces).mockResolvedValue(mockWorkspaces);

    // Mock window.location.reload
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload: vi.fn() },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("renders active workspace name and role on mount", async () => {
    render(<WorkspaceSwitcher variant="sidebar" />);

    await waitFor(() => {
      expect(screen.getByText("Default Workspace")).toBeTruthy();
      expect(screen.getByText("owner")).toBeTruthy();
    });
  });

  it("opens menu and shows all available workspaces with role badges and document counts", async () => {
    render(<WorkspaceSwitcher variant="sidebar" />);

    await waitFor(() => {
      expect(screen.getByText("Default Workspace")).toBeTruthy();
    });

    const trigger = screen.getByRole("button", { name: /switch workspace/i });
    fireEvent.click(trigger);

    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByText("Workspaces")).toBeTruthy();
    expect(screen.getByText("Project Atlas")).toBeTruthy();
    expect(screen.getByText("MEMBER")).toBeTruthy();
    expect(screen.getByText(/3 documents · 4 members/i)).toBeTruthy();
  });

  it("switches workspace when user clicks another workspace in the menu", async () => {
    const onSwitched = vi.fn();
    render(<WorkspaceSwitcher variant="sidebar" onWorkspaceSwitched={onSwitched} />);

    await waitFor(() => {
      expect(screen.getByText("Default Workspace")).toBeTruthy();
    });

    // Open menu
    fireEvent.click(screen.getByRole("button", { name: /switch workspace/i }));

    // Click Project Atlas
    const targetWsItem = screen.getByText("Project Atlas").closest("button")!;
    fireEvent.click(targetWsItem);

    expect(auth.setWorkspaceId).toHaveBeenCalledWith("ws-2");
    expect(onSwitched).toHaveBeenCalledWith(mockWorkspaces[1]);

    await waitFor(() => {
      expect(window.location.reload).toHaveBeenCalled();
    });
  });

  it("opens Create Workspace modal when clicking '+ Create Workspace'", async () => {
    render(<WorkspaceSwitcher variant="sidebar" />);

    await waitFor(() => {
      expect(screen.getByText("Default Workspace")).toBeTruthy();
    });

    // Open menu
    fireEvent.click(screen.getByRole("button", { name: /switch workspace/i }));

    // Click Create New Workspace button
    const createBtn = screen.getByText("Create New Workspace");
    fireEvent.click(createBtn);

    // Modal dialog is open
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Create New Workspace")).toBeTruthy();
    expect(screen.getByPlaceholderText(/e\.g\. Project Atlas/i)).toBeTruthy();
  });

  it("successfully creates a workspace from the dialog and switches to it", async () => {
    const newWs = {
      id: "ws-new",
      name: "Finance 2026",
      orgId: "org-1",
      role: "OWNER",
      documentCount: 0,
      memberCount: 1,
    };
    vi.mocked(api.createWorkspace).mockResolvedValue(newWs);

    render(<WorkspaceSwitcher variant="sidebar" />);

    await waitFor(() => {
      expect(screen.getByText("Default Workspace")).toBeTruthy();
    });

    // Open menu & create dialog
    fireEvent.click(screen.getByRole("button", { name: /switch workspace/i }));
    fireEvent.click(screen.getByText("Create New Workspace"));

    const input = screen.getByPlaceholderText(/e\.g\. Project Atlas/i);
    fireEvent.change(input, { target: { value: "Finance 2026" } });

    const submitBtn = screen.getByRole("button", { name: "Create Workspace" });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(api.createWorkspace).toHaveBeenCalledWith({ name: "Finance 2026" });
      expect(auth.setWorkspaceId).toHaveBeenCalledWith("ws-new");
      expect(window.location.reload).toHaveBeenCalled();
    });
  });
});
