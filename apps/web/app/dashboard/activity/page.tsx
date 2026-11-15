"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { getWorkspaceAuditLogs, getWorkspaceRole, ApiError } from "@/lib/api";
import { getWorkspaceId } from "@/lib/auth";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import type { AuditLog, AuditAction } from "@/lib/types";

const WORKSPACE_CHANGED_EVENT = "core_workspace_changed";

type LoadPhase = "loading" | "ready" | "forbidden" | "error";

function formatBytes(bytes?: number | null): string {
  if (typeof bytes !== "number" || isNaN(bytes)) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KiB`;
  return `${bytes} B`;
}

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
  return "??";
}

function formatTimestamp(iso: string): { relative: string; full: string } {
  try {
    const date = new Date(iso);
    const now = Date.now();
    const diffMs = now - date.getTime();
    const full = date.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });

    if (diffMs < 0 || isNaN(diffMs)) {
      return { relative: full, full };
    }

    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return { relative: "Just now", full };

    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return { relative: `${diffMin}m ago`, full };

    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return { relative: `${diffHours}h ago`, full };

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return { relative: `${diffDays}d ago`, full };

    return { relative: full, full };
  } catch {
    return { relative: iso, full: iso };
  }
}

interface ActionMeta {
  label: string;
  badgeBg: string;
  badgeColor: string;
  badgeBorder: string;
  icon: React.ReactNode;
}

const ACTION_METAS: Record<AuditAction, ActionMeta> = {
  DOCUMENT_UPLOADED: {
    label: "Document Uploaded",
    badgeBg: "rgba(16, 185, 129, 0.12)",
    badgeColor: "#34d399",
    badgeBorder: "rgba(16, 185, 129, 0.3)",
    icon: (
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
      </svg>
    ),
  },
  DOCUMENT_DOWNLOADED: {
    label: "Document Downloaded",
    badgeBg: "rgba(56, 189, 248, 0.12)",
    badgeColor: "#38bdf8",
    badgeBorder: "rgba(56, 189, 248, 0.3)",
    icon: (
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
      </svg>
    ),
  },
  DOCUMENT_DELETED: {
    label: "Document Deleted",
    badgeBg: "rgba(244, 63, 94, 0.12)",
    badgeColor: "#fb7185",
    badgeBorder: "rgba(244, 63, 94, 0.3)",
    icon: (
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
      </svg>
    ),
  },
  MEMBER_INVITED: {
    label: "Member Invited",
    badgeBg: "rgba(168, 85, 247, 0.12)",
    badgeColor: "#c084fc",
    badgeBorder: "rgba(168, 85, 247, 0.3)",
    icon: (
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.765z" />
      </svg>
    ),
  },
  ROLE_CHANGED: {
    label: "Role Changed",
    badgeBg: "rgba(245, 158, 11, 0.12)",
    badgeColor: "#fbbf24",
    badgeBorder: "rgba(245, 158, 11, 0.3)",
    icon: (
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
      </svg>
    ),
  },
};

function RolePill({ role }: { role: string }) {
  const styles: Record<string, { bg: string; color: string; border: string }> = {
    OWNER: { bg: "rgba(124, 58, 237, 0.12)", color: "#a78bfa", border: "rgba(124, 58, 237, 0.3)" },
    ADMIN: { bg: "rgba(59, 130, 246, 0.12)", color: "#60a5fa", border: "rgba(59, 130, 246, 0.3)" },
    MEMBER: { bg: "rgba(107, 114, 128, 0.12)", color: "#9ca3af", border: "rgba(107, 114, 128, 0.3)" },
  };
  const style = styles[role] ?? styles.MEMBER;

  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
      style={{
        backgroundColor: style.bg,
        color: style.color,
        border: `1px solid ${style.border}`,
      }}
    >
      {role}
    </span>
  );
}

export default function ActivityAuditPage() {
  const [phase, setPhase] = useState<LoadPhase>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filters
  const [actionFilter, setActionFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const [workspaceId, setWorkspaceIdState] = useState<string>(() => getWorkspaceId() ?? "");

  useEffect(() => {
    const handleWorkspaceChanged = (e: any) => {
      const newId = e?.detail?.workspaceId || getWorkspaceId() || "";
      setWorkspaceIdState(newId);
    };
    window.addEventListener(WORKSPACE_CHANGED_EVENT, handleWorkspaceChanged);
    return () => window.removeEventListener(WORKSPACE_CHANGED_EVENT, handleWorkspaceChanged);
  }, []);

  const loadLogs = useCallback(
    async (silent = false) => {
      if (!workspaceId) {
        setPhase("error");
        setErrorMessage("No active workspace found.");
        return;
      }

      if (!silent) {
        setPhase("loading");
      }
      setIsRefreshing(true);
      setErrorMessage(null);

      try {
        const role = await getWorkspaceRole(workspaceId);

        if (role === "MEMBER") {
          setPhase("forbidden");
          setIsRefreshing(false);
          return;
        }

        const data = await getWorkspaceAuditLogs(workspaceId, {
          action: actionFilter !== "ALL" ? actionFilter : undefined,
          limit: 100,
        });

        setLogs(data.logs);
        setTotalCount(data.total);
        setPhase("ready");
      } catch (err: unknown) {
        if (err instanceof ApiError && err.status === 403) {
          setPhase("forbidden");
        } else {
          setPhase("error");
          setErrorMessage("Failed to load workspace activity logs.");
        }
      } finally {
        setIsRefreshing(false);
      }
    },
    [workspaceId, actionFilter],
  );

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // Client-side filtering by search query
  const filteredLogs = useMemo(() => {
    if (!searchQuery.trim()) return logs;
    const q = searchQuery.toLowerCase().trim();

    return logs.filter((log) => {
      const actorName = log.user?.name?.toLowerCase() ?? "";
      const actorEmail = log.user?.email?.toLowerCase() ?? "";
      const resourceName = log.resourceName?.toLowerCase() ?? "";
      const actionName = log.action.toLowerCase();
      const detailsStr = log.details ? JSON.stringify(log.details).toLowerCase() : "";

      return (
        actorName.includes(q) ||
        actorEmail.includes(q) ||
        resourceName.includes(q) ||
        actionName.includes(q) ||
        detailsStr.includes(q)
      );
    });
  }, [logs, searchQuery]);

  // Summary counts computed from loaded logs
  const counts = useMemo(() => {
    const summary = {
      total: totalCount,
      uploaded: 0,
      downloaded: 0,
      deleted: 0,
      membership: 0,
    };
    logs.forEach((log) => {
      if (log.action === "DOCUMENT_UPLOADED") summary.uploaded += 1;
      else if (log.action === "DOCUMENT_DOWNLOADED") summary.downloaded += 1;
      else if (log.action === "DOCUMENT_DELETED") summary.deleted += 1;
      else if (log.action === "MEMBER_INVITED" || log.action === "ROLE_CHANGED") summary.membership += 1;
    });
    return summary;
  }, [logs, totalCount]);

  const hasActiveFilters = actionFilter !== "ALL" || searchQuery.trim().length > 0;

  return (
    <div className="space-y-6">
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            Activity and Audit
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Audit logs for document uploads, downloads, deletions, member invitations, and permission changes.
          </p>
        </div>

        {phase === "ready" && (
          <div className="flex items-center gap-2">
            <Button
              variant="outlined"
              size="sm"
              onClick={() => loadLogs(true)}
              disabled={isRefreshing}
              className="flex items-center gap-1.5"
            >
              <svg
                className={`h-4 w-4 ${isRefreshing ? "animate-spin text-[var(--accent)]" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
                />
              </svg>
              <span>Refresh</span>
            </Button>
          </div>
        )}
      </div>

      {/* Loading Phase */}
      {phase === "loading" && (
        <div className="flex flex-col items-center justify-center p-12 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-color)]">
          <Spinner size="lg" />
          <p className="mt-4 text-sm text-[var(--text-secondary)]">Loading workspace activity logs...</p>
        </div>
      )}

      {/* Forbidden / Member Phase */}
      {phase === "forbidden" && (
        <div
          role="region"
          aria-label="Access Restricted"
          className="flex flex-col items-center text-center p-12 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-color)] space-y-3"
        >
          <div className="h-12 w-12 rounded-full flex items-center justify-center bg-[var(--bg-surface-2)] text-[var(--text-muted)] border border-[var(--border-color)]">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
              />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Access Restricted</h2>
          <p className="text-sm text-[var(--text-secondary)] max-w-md">
            You are a Member of this workspace. Activity and audit logs are only accessible to workspace Owners and Administrators.
          </p>
        </div>
      )}

      {/* Error Phase */}
      {phase === "error" && (
        <div
          role="alert"
          className="flex flex-col items-center text-center p-12 bg-[var(--bg-surface)] rounded-xl border border-rose-500/20 space-y-4"
        >
          <div className="h-12 w-12 rounded-full flex items-center justify-center bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
              />
            </svg>
          </div>
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Failed to Load Activity Logs</h2>
            <p className="text-sm text-[var(--text-secondary)] mt-1">{errorMessage}</p>
          </div>
          <Button variant="outlined" onClick={() => loadLogs()}>
            Try Again
          </Button>
        </div>
      )}

      {/* Ready Phase */}
      {phase === "ready" && (
        <div className="space-y-6">
          {/* Summary Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl p-4 flex flex-col justify-between">
              <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                Total Events
              </span>
              <span className="text-2xl font-bold text-[var(--text-primary)] mt-2">
                {counts.total}
              </span>
            </div>
            <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                  Uploads
                </span>
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
              </div>
              <span className="text-2xl font-bold text-emerald-400 mt-2">
                {counts.uploaded}
              </span>
            </div>
            <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                  Downloads
                </span>
                <span className="h-2 w-2 rounded-full bg-sky-400" />
              </div>
              <span className="text-2xl font-bold text-sky-400 mt-2">
                {counts.downloaded}
              </span>
            </div>
            <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                  Deletions
                </span>
                <span className="h-2 w-2 rounded-full bg-rose-400" />
              </div>
              <span className="text-2xl font-bold text-rose-400 mt-2">
                {counts.deleted}
              </span>
            </div>
          </div>

          {/* Filters Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[var(--bg-surface)] p-3 rounded-xl border border-[var(--border-color)]">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
              {/* Search input */}
              <div className="relative flex-1 max-w-md">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[var(--text-muted)]">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                  </svg>
                </div>
                <input
                  type="text"
                  placeholder="Search by user, document, or event details..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-sm bg-[var(--bg-surface-2)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                />
              </div>

              {/* Action type filter */}
              <div className="flex items-center gap-2">
                <label htmlFor="action-filter" className="text-xs font-medium text-[var(--text-muted)] whitespace-nowrap">
                  Action:
                </label>
                <select
                  id="action-filter"
                  value={actionFilter}
                  onChange={(e) => setActionFilter(e.target.value)}
                  className="py-1.5 px-3 text-sm bg-[var(--bg-surface-2)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] cursor-pointer"
                >
                  <option value="ALL">All Actions</option>
                  <option value="DOCUMENT_UPLOADED">Document Uploaded</option>
                  <option value="DOCUMENT_DOWNLOADED">Document Downloaded</option>
                  <option value="DOCUMENT_DELETED">Document Deleted</option>
                  <option value="MEMBER_INVITED">Member Invited</option>
                  <option value="ROLE_CHANGED">Role Changed</option>
                </select>
              </div>
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setActionFilter("ALL");
                  setSearchQuery("");
                }}
                className="text-xs text-[var(--accent)] hover:underline self-end sm:self-center"
              >
                Clear Filters
              </button>
            )}
          </div>

          {/* Activity Logs Table */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl overflow-hidden shadow-sm">
            {filteredLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 text-center">
                <div className="h-10 w-10 rounded-full flex items-center justify-center bg-[var(--bg-surface-2)] text-[var(--text-muted)] mb-3">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  {hasActiveFilters ? "No matching activity records" : "No activity recorded yet"}
                </h3>
                <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-sm">
                  {hasActiveFilters
                    ? "Try adjusting your search query or selecting a different action filter."
                    : "Activity events such as uploads, downloads, deletions, and member updates will be logged here in real-time."}
                </p>
                {hasActiveFilters && (
                  <Button
                    variant="outlined"
                    size="sm"
                    className="mt-4"
                    onClick={() => {
                      setActionFilter("ALL");
                      setSearchQuery("");
                    }}
                  >
                    Reset Filters
                  </Button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--border-color)] bg-[var(--bg-surface-2)] text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                      <th className="py-3 px-4">Actor</th>
                      <th className="py-3 px-4">Action</th>
                      <th className="py-3 px-4">Target / Description</th>
                      <th className="py-3 px-4 text-right">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-color)]">
                    {filteredLogs.map((log) => {
                      const meta = ACTION_METAS[log.action] ?? {
                        label: log.action,
                        badgeBg: "rgba(107, 114, 128, 0.12)",
                        badgeColor: "#9ca3af",
                        badgeBorder: "rgba(107, 114, 128, 0.3)",
                        icon: null,
                      };

                      const time = formatTimestamp(log.createdAt);

                      return (
                        <tr
                          key={log.id}
                          className="hover:bg-[var(--bg-surface-2)]/50 transition-colors group"
                        >
                          {/* Actor */}
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="flex items-center gap-3">
                              <div className="h-8 w-8 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] font-semibold text-xs flex items-center justify-center border border-[var(--accent)]/20 shrink-0">
                                {getInitials(log.user?.name, log.user?.email)}
                              </div>
                              <div className="flex flex-col">
                                <span className="font-medium text-[var(--text-primary)] text-sm">
                                  {log.user?.name || log.user?.email || "Unknown User"}
                                </span>
                                {log.user?.name && log.user?.email && (
                                  <span className="text-xs text-[var(--text-muted)]">
                                    {log.user.email}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* Action Badge */}
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span
                              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide"
                              style={{
                                backgroundColor: meta.badgeBg,
                                color: meta.badgeColor,
                                border: `1px solid ${meta.badgeBorder}`,
                              }}
                            >
                              {meta.icon}
                              {meta.label}
                            </span>
                          </td>

                          {/* Target / Details */}
                          <td className="py-3 px-4">
                            <div className="flex flex-col gap-1 max-w-md">
                              {/* Resource Name / Target */}
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-[var(--text-primary)] break-all">
                                  {log.resourceName || log.resourceId || "—"}
                                </span>
                              </div>

                              {/* Action-specific context details */}
                              {log.action === "DOCUMENT_UPLOADED" && (
                                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                                  {log.details?.sizeBytes && (
                                    <span>{formatBytes(log.details.sizeBytes)}</span>
                                  )}
                                  {log.details?.mimeType && (
                                    <>
                                      <span>•</span>
                                      <span className="truncate">{log.details.mimeType}</span>
                                    </>
                                  )}
                                  {log.details?.multipart && (
                                    <>
                                      <span>•</span>
                                      <span className="text-[10px] font-medium px-1 rounded bg-[var(--bg-surface-2)] border border-[var(--border-color)]">
                                        Multipart
                                      </span>
                                    </>
                                  )}
                                </div>
                              )}

                              {log.action === "DOCUMENT_DOWNLOADED" && (
                                <div className="text-xs text-[var(--text-muted)]">
                                  {log.details?.downloadType === "presigned_url"
                                    ? "Generated presigned download link"
                                    : "Downloaded direct file stream"}
                                  {log.details?.sizeBytes ? ` (${formatBytes(log.details.sizeBytes)})` : ""}
                                </div>
                              )}

                              {log.action === "DOCUMENT_DELETED" && (
                                <div className="text-xs text-rose-400/80">
                                  Permanently deleted from workspace storage
                                </div>
                              )}

                              {log.action === "MEMBER_INVITED" && (
                                <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                                  <span>Invited with role:</span>
                                  {log.details?.role && <RolePill role={log.details.role} />}
                                </div>
                              )}

                              {log.action === "ROLE_CHANGED" && (
                                <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                                  <span>Role modified:</span>
                                  {log.details?.oldRole && <RolePill role={log.details.oldRole} />}
                                  <span>→</span>
                                  {log.details?.newRole && <RolePill role={log.details.newRole} />}
                                </div>
                              )}
                            </div>
                          </td>

                          {/* Timestamp */}
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <span
                              className="text-xs text-[var(--text-secondary)] font-mono cursor-default"
                              title={time.full}
                            >
                              {time.relative}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Table Footer */}
            {filteredLogs.length > 0 && (
              <div className="py-2.5 px-4 bg-[var(--bg-surface-2)]/30 border-t border-[var(--border-color)] flex items-center justify-between text-xs text-[var(--text-muted)]">
                <span>
                  Showing <strong className="text-[var(--text-primary)]">{filteredLogs.length}</strong> of{" "}
                  <strong className="text-[var(--text-primary)]">{logs.length}</strong> activity event(s)
                </span>
                <span>Sorted by most recent</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
