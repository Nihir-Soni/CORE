"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { logout, getMe } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { WorkspaceSwitcher } from "@/components/workspace/WorkspaceSwitcher";

/* ─── Nav definition ──────────────────────────────────────────────────────── */

const NAV_ITEMS = [
  {
    href: "/dashboard",
    id: "nav-dashboard",
    label: "Dashboard",
    exact: true,
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/documents",
    id: "nav-documents",
    label: "Object Browser",
    exact: false,
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/chat",
    id: "nav-chat",
    label: "Chat",
    exact: false,
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3.75h5.25M6.75 19.5l-3 1.5.75-3.75A8.25 8.25 0 013.75 12a8.25 8.25 0 018.25-8.25h0A8.25 8.25 0 0120.25 12v.75A8.25 8.25 0 0112 21h-.75a8.25 8.25 0 01-4.5-1.5z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/members",
    id: "nav-members",
    label: "Members",
    exact: false,
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/activity",
    id: "nav-activity",
    label: "Activity and Audit",
    exact: false,
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/analytics",
    id: "nav-analytics",
    label: "Analytics",
    exact: false,
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
  },
];

/* ─── Sidebar ─────────────────────────────────────────────────────────────── */

function getInitials(name?: string | null, email?: string | null): string {
  if (name && name.trim().length > 0) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  }
  if (email && email.trim().length > 0) {
    return email.slice(0, 2).toUpperCase();
  }
  return "U";
}

function Sidebar({ onLogout, signingOut }: { onLogout: () => void; signingOut: boolean }) {
  const pathname = usePathname();
  const [userName, setUserName] = useState<string | null>(() => getCurrentUser()?.name ?? null);
  const [userEmail, setUserEmail] = useState<string | null>(() => getCurrentUser()?.email ?? null);

  useEffect(() => {
    const current = getCurrentUser();
    if (current) {
      if (current.name) setUserName(current.name);
      if (current.email) setUserEmail(current.email);
    }
    getMe()
      .then((profile) => {
        if (profile.name) setUserName(profile.name);
        if (profile.email) setUserEmail(profile.email);
      })
      .catch(() => {});
  }, []);

  return (
    <aside
      className="flex shrink-0 flex-col"
      style={{
        width: "var(--sidebar-width)",
        background: "var(--sidebar-bg)",
        minHeight: "100vh",
      }}
      aria-label="Console navigation"
    >
      {/* Logo */}
      <div
        className="flex items-center gap-3 px-5 shrink-0"
        style={{
          height: "var(--header-height)",
          borderBottom: "1px solid var(--sidebar-divider)",
        }}
      >
        <div
          className="h-6 w-6 rounded flex items-center justify-center shrink-0"
          style={{ background: "var(--accent)" }}
        >
          <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75M3.75 10.125v3.75" />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-white leading-none">CORE</p>
          <p className="text-[10px] mt-0.5" style={{ color: "var(--sidebar-text)" }}>
            Object Store
          </p>
        </div>
      </div>

      {/* Workspace Switcher */}
      <div className="px-3 pt-3 pb-1">
        <WorkspaceSwitcher variant="sidebar" />
      </div>

      {/* Navigation */}
      <nav
        className="flex-1 py-3 overflow-y-auto"
        aria-label="Application navigation"
      >
        {/* Main nav */}
        <div className="px-2 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                id={item.id}
                href={item.href}
                className={[
                  "flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors",
                  active
                    ? "font-semibold"
                    : "hover:bg-white/6",
                ].join(" ")}
                style={
                  active
                    ? { background: "var(--accent)", color: "#fff" }
                    : { color: "var(--sidebar-text)" }
                }
                aria-current={active ? "page" : undefined}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* User profile & Logout footer */}
      <div
        className="shrink-0 px-3 py-3 space-y-2"
        style={{ borderTop: "1px solid var(--sidebar-divider)" }}
      >
        {(userName || userEmail) && (
          <div
            id="sidebar-user-badge"
            className="flex items-center gap-2.5 px-2.5 py-2 rounded"
            style={{ background: "rgba(255, 255, 255, 0.04)" }}
          >
            <div
              className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
              style={{ background: "var(--accent)" }}
              aria-hidden="true"
            >
              {getInitials(userName, userEmail)}
            </div>
            <div className="min-w-0 flex-1">
              <p
                id="sidebar-user-name"
                className="text-xs font-semibold text-white truncate leading-tight"
              >
                {userName || "User"}
              </p>
              {userEmail && (
                <p
                  id="sidebar-user-email"
                  className="text-[10px] truncate leading-tight mt-0.5"
                  style={{ color: "var(--sidebar-text)" }}
                >
                  {userEmail}
                </p>
              )}
            </div>
          </div>
        )}

        <button
          id="sidebar-logout"
          onClick={onLogout}
          disabled={signingOut}
          className="flex w-full items-center gap-3 rounded px-3 py-2 text-sm transition-colors disabled:opacity-50"
          style={{ color: "var(--sidebar-text)" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
          </svg>
          {signingOut ? "Signing out…" : "Sign Out"}
        </button>
      </div>
    </aside>
  );
}

/* ─── Layout ──────────────────────────────────────────────────────────────── */

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);

  async function handleLogout() {
    setSigningOut(true);
    try { await logout(); } finally { router.replace("/"); }
  }

  // Breadcrumb from pathname
  const crumbs = pathname
    .split("/")
    .filter(Boolean)
    .map((part, i, arr) => ({
      label: part.charAt(0).toUpperCase() + part.slice(1),
      href: "/" + arr.slice(0, i + 1).join("/"),
      isLast: i === arr.length - 1,
    }));

  return (
    <AuthGuard>
      <div className="flex min-h-screen" style={{ background: "var(--bg-page)" }}>
        <Sidebar onLogout={handleLogout} signingOut={signingOut} />

        <div className="flex flex-1 flex-col min-w-0">
          {/* Top bar */}
          <header
            className="flex items-center shrink-0 px-6 gap-2"
            style={{
              height: "var(--header-height)",
              background: "var(--header-bg)",
              borderBottom: "1px solid var(--header-border)",
            }}
          >
            {/* Breadcrumb */}
            <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm min-w-0">
              {crumbs.map((crumb, i) => (
                <span key={crumb.href} className="flex items-center gap-1 min-w-0">
                  {i > 0 && (
                    <svg className="h-3 w-3 shrink-0" style={{ color: "var(--text-muted)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  )}
                  {crumb.isLast ? (
                    <span className="font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                      {crumb.label}
                    </span>
                  ) : (
                    <Link
                      href={crumb.href}
                      className="truncate transition-colors hover:underline"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {crumb.label}
                    </Link>
                  )}
                </span>
              ))}
            </nav>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Header Workspace Switcher */}
            <div className="hidden sm:block">
              <WorkspaceSwitcher variant="header" />
            </div>

            {/* Right side — version tag */}
            <span
              className="hidden sm:inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
              style={{ background: "var(--bg-surface-2)", color: "var(--text-muted)", border: "1px solid var(--border-color)" }}
            >
              Community Edition
            </span>
          </header>

          {/* Page content */}
          <main
            className="flex-1 overflow-y-auto p-6"
            id="main-content"
            tabIndex={-1}
          >
            {children}
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}
