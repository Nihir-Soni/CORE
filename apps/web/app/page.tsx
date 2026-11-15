"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { login, register, ApiError, logout } from "@/lib/api";
import { setAuth, isAuthenticated, getCurrentUser, getWorkspaceId } from "@/lib/auth";

type AuthMode = "login" | "register";

interface LoginFormState {
  email: string;
  password: string;
}

interface LoginFormErrors {
  email?: string;
  password?: string;
}

interface RegisterFormState {
  name: string;
  email: string;
  password: string;
  orgName: string;
}

interface RegisterFormErrors {
  name?: string;
  email?: string;
  password?: string;
  orgName?: string;
}

function validateLogin(v: LoginFormState): LoginFormErrors {
  const e: LoginFormErrors = {};
  if (!v.email) e.email = "Email is required.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) e.email = "Enter a valid email address.";
  if (!v.password) e.password = "Password is required.";
  return e;
}

function validateRegister(v: RegisterFormState): RegisterFormErrors {
  const e: RegisterFormErrors = {};
  if (!v.name.trim()) e.name = "Name is required.";
  if (!v.email) e.email = "Email is required.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) e.email = "Enter a valid email address.";
  if (!v.password) e.password = "Password is required.";
  else if (v.password.length < 8) e.password = "Minimum 8 characters.";
  if (!v.orgName.trim()) e.orgName = "Organization is required.";
  return e;
}

function LandingPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlMode = searchParams.get("mode");
  const returnTo = searchParams.get("returnTo");

  // Only open auth box initially if a mode query param was explicitly passed (e.g. from an invite link)
  const [isAuthOpen, setIsAuthOpen] = useState<boolean>(() => Boolean(urlMode));
  const [mode, setMode] = useState<AuthMode>(urlMode === "register" ? "register" : "login");
  const [authedUser, setAuthedUser] = useState<{ userId: string; email: string; name?: string | null } | null>(null);

  // Login form state
  const [loginValues, setLoginValues] = useState<LoginFormState>({ email: "", password: "" });
  const [loginErrors, setLoginErrors] = useState<LoginFormErrors>({});
  const [loginApiError, setLoginApiError] = useState<string | null>(null);
  const [loginSubmitting, setLoginSubmitting] = useState(false);

  // Register form state
  const [regValues, setRegValues] = useState<RegisterFormState>({ name: "", email: "", password: "", orgName: "" });
  const [regErrors, setRegErrors] = useState<RegisterFormErrors>({});
  const [regApiError, setRegApiError] = useState<string | null>(null);
  const [regSubmitting, setRegSubmitting] = useState(false);

  // Check existing login on client
  useEffect(() => {
    if (isAuthenticated() && getWorkspaceId()) {
      setAuthedUser(getCurrentUser());
    }
  }, []);

  // Sync mode with query param when it changes
  useEffect(() => {
    const qMode = searchParams.get("mode");
    if (qMode === "register" || qMode === "login") {
      setMode(qMode);
      setIsAuthOpen(true);
    }
  }, [searchParams]);

  // Handle escape key to dismiss auth box
  const closeAuth = useCallback(() => {
    setIsAuthOpen(false);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isAuthOpen) {
        closeAuth();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isAuthOpen, closeAuth]);

  const openAuth = (targetMode: AuthMode) => {
    setMode(targetMode);
    setIsAuthOpen(true);
  };

  const handleLoginChange = (field: keyof LoginFormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setLoginValues((prev) => ({ ...prev, [field]: e.target.value }));
    if (loginErrors[field]) setLoginErrors((prev) => ({ ...prev, [field]: undefined }));
    if (loginApiError) setLoginApiError(null);
  };

  const handleRegChange = (field: keyof RegisterFormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setRegValues((prev) => ({ ...prev, [field]: e.target.value }));
    if (regErrors[field]) setRegErrors((prev) => ({ ...prev, [field]: undefined }));
    if (regApiError) setRegApiError(null);
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ve = validateLogin(loginValues);
    if (Object.keys(ve).length > 0) {
      setLoginErrors(ve);
      return;
    }

    setLoginSubmitting(true);
    setLoginApiError(null);
    try {
      const res = await login({ email: loginValues.email, password: loginValues.password });
      setAuth(res.token, res.refreshToken, res.workspaceId);
      router.replace(returnTo || "/dashboard");
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 422)) {
        setLoginApiError("Invalid email or password.");
      } else {
        setLoginApiError("Unable to connect. Please try again.");
      }
    } finally {
      setLoginSubmitting(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ve = validateRegister(regValues);
    if (Object.keys(ve).length > 0) {
      setRegErrors(ve);
      return;
    }

    setRegSubmitting(true);
    setRegApiError(null);
    try {
      const res = await register({
        name: regValues.name.trim(),
        email: regValues.email.trim(),
        password: regValues.password,
        orgName: regValues.orgName.trim(),
      });
      setAuth(res.token, res.refreshToken, res.workspaceId);
      router.replace(returnTo || "/dashboard");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setRegErrors((prev) => ({ ...prev, email: "An account with this email already exists." }));
      } else {
        setRegApiError("Unable to create account. Please try again.");
      }
    } finally {
      setRegSubmitting(false);
    }
  };

  const handleSignOutExisting = async () => {
    await logout();
    setAuthedUser(null);
  };

  return (
    <div className="min-h-full flex flex-col" style={{ background: "var(--sidebar-bg)" }}>
      {/* Top navigation */}
      <header className="flex items-center justify-between px-6 sm:px-12 h-16 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded bg-[var(--accent)] flex items-center justify-center shadow-sm">
              <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75M3.75 10.125v3.75" />
              </svg>
            </div>
            <span className="text-base font-bold text-white tracking-tight select-none">
              CORE
            </span>
          </div>
          <span className="hidden sm:inline-flex items-center rounded bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/60">
            Community Edition
          </span>
        </div>

        <nav className="flex items-center gap-3" aria-label="Main navigation">
          {authedUser ? (
            <Link
              href="/dashboard"
              className="inline-flex h-9 items-center gap-2 rounded bg-[var(--accent)] px-4 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] transition-colors shadow-sm"
            >
              <span>Dashboard</span>
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </Link>
          ) : (
            <>
              <button
                type="button"
                id="nav-sign-in"
                onClick={() => openAuth("login")}
                className="text-xs font-medium text-white/70 hover:text-white px-3 py-1.5 rounded transition-colors"
              >
                Sign In
              </button>
              <button
                type="button"
                id="nav-register"
                onClick={() => openAuth("register")}
                className="inline-flex h-8 items-center rounded bg-[var(--accent)] px-3.5 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] transition-colors shadow-sm"
              >
                Create Account
              </button>
            </>
          )}
        </nav>
      </header>

      {/* Hero section */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 sm:px-12 py-16 lg:py-24 text-center">
        <div className="max-w-3xl w-full mx-auto space-y-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs text-white/70">
            <span className="h-2 w-2 rounded-full bg-[var(--status-ready)] animate-pulse" aria-hidden="true" />
            <span>High-Performance Object Storage & RAG Engine</span>
          </div>

          <div className="space-y-4">
            <h1 className="text-4xl sm:text-6xl font-extrabold text-white tracking-tight leading-[1.1]">
              Document Intelligence <br />
              <span className="text-[var(--accent)]">for Your Organization</span>
            </h1>
            <p className="text-base sm:text-lg text-white/60 max-w-2xl mx-auto leading-relaxed">
              Upload, store, and query enterprise documents with S3 compatibility,
              multi-tenant workspace isolation, and conversational RAG retrieval.
            </p>
          </div>

          {/* Action buttons to trigger the login / register boxes */}
          <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
            {authedUser ? (
              <div className="flex items-center gap-3">
                <Link
                  href="/dashboard"
                  className="inline-flex h-11 items-center gap-2 rounded bg-[var(--accent)] px-6 text-sm font-semibold text-white hover:bg-[var(--accent-hover)] transition-colors shadow-lg"
                >
                  <span>Open Console Dashboard</span>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                </Link>
                <button
                  type="button"
                  onClick={handleSignOutExisting}
                  className="inline-flex h-11 items-center rounded border border-white/20 bg-white/5 px-5 text-sm font-medium text-white/80 hover:border-white/40 hover:text-white transition-colors"
                >
                  Switch Account
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  id="cta-get-started"
                  onClick={() => openAuth("register")}
                  className="inline-flex h-11 items-center rounded bg-[var(--accent)] px-7 text-sm font-semibold text-white hover:bg-[var(--accent-hover)] transition-colors shadow-lg shadow-[var(--accent)]/20 cursor-pointer"
                >
                  Create Organization Account
                </button>
                <button
                  type="button"
                  id="cta-sign-in"
                  onClick={() => openAuth("login")}
                  className="inline-flex h-11 items-center rounded border border-white/20 bg-white/5 px-6 text-sm font-medium text-white/80 hover:border-white/40 hover:text-white transition-colors cursor-pointer"
                >
                  Sign In to Console →
                </button>
              </>
            )}
          </div>

          {/* Feature Highlights Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-8 text-left">
            <div className="rounded-xl border border-white/10 bg-white/5 p-5 transition-colors hover:border-white/20">
              <p className="text-sm font-bold text-white">Direct S3 Uploads</p>
              <p className="text-xs text-white/50 mt-1 leading-relaxed">
                Pre-signed storage URLs bypass proxy bottlenecks for maximum throughput.
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-5 transition-colors hover:border-white/20">
              <p className="text-sm font-bold text-white">Tenant Isolation</p>
              <p className="text-xs text-white/50 mt-1 leading-relaxed">
                Workspaces strictly segregated by Owner, Admin, and Member permissions.
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-5 transition-colors hover:border-white/20">
              <p className="text-sm font-bold text-white">Semantic AI Chat</p>
              <p className="text-xs text-white/50 mt-1 leading-relaxed">
                Automated document extraction, chunk vector embeddings, and RAG search.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Authentication Modal / Popup Box (Only rendered when isAuthOpen is true) */}
      {isAuthOpen && (
        <div
          id="auth-modal-overlay"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
          onClick={(e) => {
            // Close when clicking backdrop
            if (e.target === e.currentTarget) {
              closeAuth();
            }
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="auth-modal-title"
        >
          <div
            id="auth-box"
            className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl border border-white/15 animate-scale-up"
            style={{ background: "var(--bg-surface)" }}
          >
            {/* Modal header bar */}
            <div
              className="flex items-center justify-between px-6 py-4 border-b border-white/10"
              style={{ background: "var(--sidebar-bg)" }}
            >
              <div className="flex items-center gap-2.5">
                <div className="h-6 w-6 rounded bg-[var(--accent)] flex items-center justify-center shadow-sm">
                  <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75M3.75 10.125v3.75" />
                  </svg>
                </div>
                <span id="auth-modal-title" className="text-xs font-bold text-white tracking-wide">
                  CORE Console
                </span>
              </div>

              <div className="flex items-center gap-3">
                {/* Mode toggle tabs */}
                <div
                  role="tablist"
                  className="flex items-center rounded bg-white/10 p-0.5"
                  aria-label="Authentication mode"
                >
                  <button
                    type="button"
                    id="tab-login"
                    role="tab"
                    aria-selected={mode === "login"}
                    aria-controls="auth-panel-login"
                    onClick={() => setMode("login")}
                    className={[
                      "px-3 py-1 text-xs font-semibold rounded transition-all cursor-pointer",
                      mode === "login"
                        ? "bg-[var(--accent)] text-white shadow-sm"
                        : "text-white/70 hover:text-white hover:bg-white/5",
                    ].join(" ")}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    id="tab-register"
                    role="tab"
                    aria-selected={mode === "register"}
                    aria-controls="auth-panel-register"
                    onClick={() => setMode("register")}
                    className={[
                      "px-3 py-1 text-xs font-semibold rounded transition-all cursor-pointer",
                      mode === "register"
                        ? "bg-[var(--accent)] text-white shadow-sm"
                        : "text-white/70 hover:text-white hover:bg-white/5",
                    ].join(" ")}
                  >
                    Register
                  </button>
                </div>

                {/* Dismiss Close Button */}
                <button
                  type="button"
                  id="auth-modal-close"
                  onClick={closeAuth}
                  aria-label="Close authentication modal"
                  className="p-1 rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Modal body */}
            <div className="p-6">
              {mode === "login" ? (
                /* ─── Sign In Form Box ───────────────────────────── */
                <div id="auth-panel-login" role="tabpanel" aria-labelledby="tab-login" className="space-y-4">
                  <div>
                    <h2 className="text-base font-bold text-[var(--text-primary)]">
                      Sign In to Console
                    </h2>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      Enter your credentials to access your workspaces.
                    </p>
                  </div>

                  <form onSubmit={handleLoginSubmit} noValidate className="space-y-3.5">
                    <Input
                      label="Email"
                      id="login-email"
                      type="email"
                      autoComplete="email"
                      placeholder="admin@example.com"
                      value={loginValues.email}
                      onChange={handleLoginChange("email")}
                      error={loginErrors.email}
                      disabled={loginSubmitting}
                      required
                    />
                    <Input
                      label="Password"
                      id="login-password"
                      type="password"
                      autoComplete="current-password"
                      placeholder="••••••••"
                      value={loginValues.password}
                      onChange={handleLoginChange("password")}
                      error={loginErrors.password}
                      disabled={loginSubmitting}
                      required
                    />

                    {loginApiError && (
                      <div className="rounded p-2.5 flex items-start gap-2" style={{ background: "var(--status-failed-bg)", border: "1px solid var(--accent-border)" }}>
                        <svg className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "var(--status-failed)" }} fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
                        </svg>
                        <p role="alert" className="text-xs font-medium" style={{ color: "var(--status-failed)" }}>
                          {loginApiError}
                        </p>
                      </div>
                    )}

                    <Button
                      type="submit"
                      id="login-submit"
                      variant="primary"
                      size="md"
                      className="w-full mt-2"
                      loading={loginSubmitting}
                      disabled={loginSubmitting}
                    >
                      {loginSubmitting ? "Signing in…" : "Sign In"}
                    </Button>
                  </form>

                  <div className="pt-2 text-center border-t border-[var(--border-subtle)]">
                    <p className="text-xs text-[var(--text-muted)]">
                      Don&apos;t have an account?{" "}
                      <button
                        type="button"
                        onClick={() => setMode("register")}
                        className="font-semibold transition-colors hover:underline cursor-pointer"
                        style={{ color: "var(--accent)" }}
                      >
                        Create Account
                      </button>
                    </p>
                  </div>
                </div>
              ) : (
                /* ─── Register Form Box ──────────────────────────── */
                <div id="auth-panel-register" role="tabpanel" aria-labelledby="tab-register" className="space-y-4">
                  <div>
                    <h2 className="text-base font-bold text-[var(--text-primary)]">
                      Create Organization Account
                    </h2>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      Set up your organization, default workspace, and owner access.
                    </p>
                  </div>

                  <form onSubmit={handleRegisterSubmit} noValidate className="space-y-3">
                    <Input
                      label="Full Name"
                      id="register-name"
                      type="text"
                      autoComplete="name"
                      placeholder="Your full name"
                      value={regValues.name}
                      onChange={handleRegChange("name")}
                      error={regErrors.name}
                      disabled={regSubmitting}
                      required
                    />
                    <Input
                      label="Email Address"
                      id="register-email"
                      type="email"
                      autoComplete="email"
                      placeholder="admin@company.com"
                      value={regValues.email}
                      onChange={handleRegChange("email")}
                      error={regErrors.email}
                      disabled={regSubmitting}
                      required
                    />
                    <Input
                      label="Password"
                      id="register-password"
                      type="password"
                      autoComplete="new-password"
                      placeholder="Min. 8 characters"
                      value={regValues.password}
                      onChange={handleRegChange("password")}
                      error={regErrors.password}
                      disabled={regSubmitting}
                      required
                    />
                    <Input
                      label="Organization Name"
                      id="register-org-name"
                      type="text"
                      autoComplete="organization"
                      placeholder="Acme Corporation"
                      value={regValues.orgName}
                      onChange={handleRegChange("orgName")}
                      error={regErrors.orgName}
                      disabled={regSubmitting}
                      required
                    />

                    {regApiError && (
                      <div className="rounded p-2.5 flex items-start gap-2" style={{ background: "var(--status-failed-bg)", border: "1px solid var(--accent-border)" }}>
                        <svg className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "var(--status-failed)" }} fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
                        </svg>
                        <p role="alert" className="text-xs font-medium" style={{ color: "var(--status-failed)" }}>
                          {regApiError}
                        </p>
                      </div>
                    )}

                    <Button
                      type="submit"
                      id="register-submit"
                      variant="primary"
                      size="md"
                      className="w-full mt-2"
                      loading={regSubmitting}
                      disabled={regSubmitting}
                    >
                      {regSubmitting ? "Creating account…" : "Create Account"}
                    </Button>
                  </form>

                  <div className="pt-2 text-center border-t border-[var(--border-subtle)]">
                    <p className="text-xs text-[var(--text-muted)]">
                      Already registered?{" "}
                      <button
                        type="button"
                        onClick={() => setMode("login")}
                        className="font-semibold transition-colors hover:underline cursor-pointer"
                        style={{ color: "var(--accent)" }}
                      >
                        Sign In
                      </button>
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-white/10 px-6 sm:px-12 py-5 shrink-0 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-white/50">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-ready)]" />
          <span>All Storage & Vector Services Operational</span>
        </div>
        <p>
          CORE / CHiE — Comachi Hyper Intelligence Encyclopedia.
        </p>
      </footer>
    </div>
  );
}

export default function LandingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--sidebar-bg)" }}>
          <Spinner size="lg" label="Loading CORE Console…" />
        </div>
      }
    >
      <LandingPageContent />
    </Suspense>
  );
}
