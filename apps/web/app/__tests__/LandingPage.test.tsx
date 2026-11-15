import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import LandingPage from "../page";
import * as api from "@/lib/api";
import * as auth from "@/lib/auth";

const mockReplace = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: vi.fn(),
  }),
  useSearchParams: () => mockSearchParams,
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  };
});

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    setAuth: vi.fn(),
    isAuthenticated: vi.fn(),
    getWorkspaceId: vi.fn(),
    getCurrentUser: vi.fn(),
  };
});

describe("LandingPage Authentication Boxes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    vi.mocked(auth.isAuthenticated).mockReturnValue(false);
    vi.mocked(auth.getWorkspaceId).mockReturnValue(null);
    vi.mocked(auth.getCurrentUser).mockReturnValue(null);
  });

  it("does not show the login or register box by default until a button is clicked", () => {
    render(<LandingPage />);

    // Auth box modal should not be in the document
    expect(document.getElementById("auth-box")).toBeNull();
    expect(screen.queryByLabelText(/^password/i)).toBeNull();

    // Trigger buttons are visible
    expect(document.getElementById("nav-sign-in")).toBeTruthy();
    expect(document.getElementById("nav-register")).toBeTruthy();
    expect(document.getElementById("cta-sign-in")).toBeTruthy();
    expect(document.getElementById("cta-get-started")).toBeTruthy();
  });

  it("opens the sign in box when the Sign In button is clicked", async () => {
    render(<LandingPage />);

    fireEvent.click(document.getElementById("cta-sign-in")!);

    await waitFor(() => {
      expect(document.getElementById("auth-box")).toBeTruthy();
      expect(document.getElementById("login-email")).toBeTruthy();
      expect(document.getElementById("login-password")).toBeTruthy();
      expect(document.getElementById("login-submit")).toBeTruthy();
    });
  });

  it("opens the register box when the Create Account button is clicked", async () => {
    render(<LandingPage />);

    fireEvent.click(document.getElementById("cta-get-started")!);

    await waitFor(() => {
      expect(document.getElementById("auth-box")).toBeTruthy();
      expect(document.getElementById("register-name")).toBeTruthy();
      expect(document.getElementById("register-email")).toBeTruthy();
      expect(document.getElementById("register-password")).toBeTruthy();
      expect(document.getElementById("register-org-name")).toBeTruthy();
      expect(document.getElementById("register-submit")).toBeTruthy();
    });
  });

  it("allows closing the authentication box via the close button", async () => {
    render(<LandingPage />);

    fireEvent.click(document.getElementById("cta-sign-in")!);
    expect(document.getElementById("auth-box")).toBeTruthy();

    const closeBtn = document.getElementById("auth-modal-close");
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn!);

    await waitFor(() => {
      expect(document.getElementById("auth-box")).toBeNull();
    });
  });

  it("allows closing the authentication box via Escape key", async () => {
    render(<LandingPage />);

    fireEvent.click(document.getElementById("cta-sign-in")!);
    expect(document.getElementById("auth-box")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(document.getElementById("auth-box")).toBeNull();
    });
  });

  it("switches between sign in and register tabs inside the modal", async () => {
    render(<LandingPage />);

    fireEvent.click(document.getElementById("cta-sign-in")!);

    await waitFor(() => {
      expect(document.getElementById("login-email")).toBeTruthy();
    });

    // Switch to register tab
    fireEvent.click(document.getElementById("tab-register")!);

    await waitFor(() => {
      expect(document.getElementById("register-name")).toBeTruthy();
    });

    // Switch back to login tab
    fireEvent.click(document.getElementById("tab-login")!);

    await waitFor(() => {
      expect(document.getElementById("login-email")).toBeTruthy();
    });
  });

  it("submits login form and navigates to dashboard", async () => {
    vi.mocked(api.login).mockResolvedValue({
      token: "mock-token",
      refreshToken: "mock-refresh",
      workspaceId: "ws-test",
    });

    render(<LandingPage />);

    fireEvent.click(document.getElementById("cta-sign-in")!);

    fireEvent.change(document.getElementById("login-email")!, { target: { value: "user@example.com" } });
    fireEvent.change(document.getElementById("login-password")!, { target: { value: "secret123" } });
    fireEvent.click(document.getElementById("login-submit")!);

    await waitFor(() => {
      expect(api.login).toHaveBeenCalledWith({
        email: "user@example.com",
        password: "secret123",
      });
      expect(auth.setAuth).toHaveBeenCalledWith("mock-token", "mock-refresh", "ws-test");
      expect(mockReplace).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("submits registration form and navigates to dashboard", async () => {
    vi.mocked(api.register).mockResolvedValue({
      token: "reg-token",
      refreshToken: "reg-refresh",
      workspaceId: "ws-new",
    });

    render(<LandingPage />);

    fireEvent.click(document.getElementById("cta-get-started")!);

    fireEvent.change(document.getElementById("register-name")!, { target: { value: "Jane Founder" } });
    fireEvent.change(document.getElementById("register-email")!, { target: { value: "jane@startup.io" } });
    fireEvent.change(document.getElementById("register-password")!, { target: { value: "securepassword" } });
    fireEvent.change(document.getElementById("register-org-name")!, { target: { value: "Startup Inc" } });

    fireEvent.click(document.getElementById("register-submit")!);

    await waitFor(() => {
      expect(api.register).toHaveBeenCalledWith({
        name: "Jane Founder",
        email: "jane@startup.io",
        password: "securepassword",
        orgName: "Startup Inc",
      });
      expect(auth.setAuth).toHaveBeenCalledWith("reg-token", "reg-refresh", "ws-new");
      expect(mockReplace).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("keeps the authentication modal open and displays error message when login fails with invalid credentials", async () => {
    vi.mocked(api.login).mockRejectedValue(new api.ApiError("invalid_credentials", 401));

    render(<LandingPage />);

    // Open sign in box
    fireEvent.click(document.getElementById("cta-sign-in")!);
    expect(document.getElementById("auth-box")).toBeTruthy();

    fireEvent.change(document.getElementById("login-email")!, { target: { value: "user@example.com" } });
    fireEvent.change(document.getElementById("login-password")!, { target: { value: "wrongpass" } });
    fireEvent.click(document.getElementById("login-submit")!);

    await waitFor(() => {
      expect(screen.getByText("Invalid email or password.")).toBeTruthy();
    });

    // The modal MUST remain open so the user can correct their credentials
    expect(document.getElementById("auth-box")).toBeTruthy();
    expect(document.getElementById("login-email")).toBeTruthy();
  });

  it("renders feature highlight titles without icons above them", () => {
    render(<LandingPage />);

    expect(screen.getByText("Direct S3 Uploads")).toBeTruthy();
    expect(screen.getByText("Tenant Isolation")).toBeTruthy();
    expect(screen.getByText("Semantic AI Chat")).toBeTruthy();

    expect(screen.queryByText("⚡")).toBeNull();
    expect(screen.queryByText("🔒")).toBeNull();
    expect(screen.queryByText("🧠")).toBeNull();
  });
});
