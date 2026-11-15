import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import DashboardLayout from "../layout";
import * as api from "@/lib/api";
import * as auth from "@/lib/auth";

// Mock Next.js navigation
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("@/components/auth/AuthGuard", () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => <div data-testid="auth-guard">{children}</div>,
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    logout: vi.fn(),
    getMe: vi.fn(),
    getWorkspaces: vi.fn(),
    getWorkspace: vi.fn(),
  };
});

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getCurrentUser: vi.fn(),
  };
});

describe("DashboardLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getMe).mockResolvedValue({
      id: "u-1",
      email: "jane@example.com",
      name: "Jane Doe",
    });
    vi.mocked(auth.getCurrentUser).mockReturnValue({
      userId: "u-1",
      email: "jane@example.com",
      name: "Jane Doe",
    });
    vi.mocked(api.getWorkspaces).mockResolvedValue([
      { id: "ws-1", name: "Default", orgId: "org-1", role: "OWNER" },
    ]);
  });

  it("renders user name and email badge in the sidebar", async () => {
    render(
      <DashboardLayout>
        <div>Content</div>
      </DashboardLayout>
    );

    await waitFor(() => {
      const userNameElem = document.getElementById("sidebar-user-name");
      expect(userNameElem?.textContent).toBe("Jane Doe");
      const userEmailElem = document.getElementById("sidebar-user-email");
      expect(userEmailElem?.textContent).toBe("jane@example.com");
    });
  });

  it("renders the workspace switcher in the sidebar", async () => {
    render(
      <DashboardLayout>
        <div>Content</div>
      </DashboardLayout>
    );

    await waitFor(() => {
      expect(document.getElementById("workspace-switcher-button")).toBeTruthy();
    });
  });

  it("does not render coming soon section or placeholders", async () => {
    render(
      <DashboardLayout>
        <div>Content</div>
      </DashboardLayout>
    );

    await waitFor(() => {
      expect(screen.queryByText("Coming Soon")).toBeNull();
      expect(screen.queryByText("Access Keys")).toBeNull();
      expect(screen.queryByText("Monitoring")).toBeNull();
      expect(screen.queryByText("Settings")).toBeNull();
      expect(document.getElementById("nav-access-keys")).toBeNull();
      expect(document.getElementById("nav-monitoring")).toBeNull();
      expect(document.getElementById("nav-settings")).toBeNull();
    });
  });
});
