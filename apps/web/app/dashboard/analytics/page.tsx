"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { getWorkspaceAnalytics, ApiError } from "@/lib/api";
import { getWorkspaceId, getCurrentUser } from "@/lib/auth";
import { loadChatSessions, type ChatSession } from "@/lib/chat-history";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import type { WorkspaceAnalytics } from "@/lib/types";

const WORKSPACE_CHANGED_EVENT = "core_workspace_changed";

function formatBytes(bytes?: number | null): string {
  if (typeof bytes !== "number" || isNaN(bytes)) return "0 B";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KiB`;
  return `${bytes} B`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

const CATEGORY_COLORS: Record<string, string> = {
  PDF: "#ef4444",
  "Word / Text": "#3b82f6",
  Spreadsheets: "#10b981",
  Presentations: "#f59e0b",
  Images: "#8b5cf6",
  Other: "#6b7280",
};

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<WorkspaceAnalytics | null>(null);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);

  const [workspaceId, setWorkspaceIdState] = useState<string>(() => getWorkspaceId() ?? "");

  useEffect(() => {
    const handleWorkspaceChanged = (e: any) => {
      const newId = e?.detail?.workspaceId || getWorkspaceId() || "";
      setWorkspaceIdState(newId);
    };
    window.addEventListener(WORKSPACE_CHANGED_EVENT, handleWorkspaceChanged);
    return () => window.removeEventListener(WORKSPACE_CHANGED_EVENT, handleWorkspaceChanged);
  }, []);

  const loadData = useCallback(
    async (silent = false) => {
      if (!workspaceId) {
        setError("No active workspace found.");
        setLoading(false);
        return;
      }

      if (!silent) setLoading(true);
      setRefreshing(true);
      setError(null);

      try {
        const data = await getWorkspaceAnalytics(workspaceId);
        setAnalytics(data);

        // Load client-side chat sessions for query counts & conversation stats
        const user = getCurrentUser();
        const sessions = loadChatSessions(user?.userId, workspaceId);
        setChatSessions(sessions);
      } catch (err: unknown) {
        if (err instanceof ApiError) {
          setError(err.message || "Failed to load analytics data.");
        } else {
          setError("Failed to load workspace analytics.");
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Aggregate user chat query statistics from chat sessions
  const clientQueryStats = useMemo(() => {
    let userQueries = 0;
    let assistantResponses = 0;
    let totalCitations = 0;
    let targetedSessions = 0;
    let totalWords = 0;

    chatSessions.forEach((session) => {
      if (session.selectedDocumentIds && session.selectedDocumentIds.length > 0) {
        targetedSessions += 1;
      }
      session.messages.forEach((msg) => {
        if (msg.role === "user") {
          userQueries += 1;
          totalWords += msg.text.split(/\s+/).filter(Boolean).length;
        } else if (msg.role === "assistant") {
          assistantResponses += 1;
          if (Array.isArray(msg.citations)) {
            totalCitations += msg.citations.length;
          }
        }
      });
    });

    const avgQueriesPerSession =
      chatSessions.length > 0 ? (userQueries / chatSessions.length).toFixed(1) : "0";

    return {
      totalSessions: chatSessions.length,
      userQueries,
      assistantResponses,
      totalCitations,
      targetedSessions,
      totalWords,
      avgQueriesPerSession,
    };
  }, [chatSessions]);

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">Analytics</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Real-time telemetry for document processing, storage utilization, AI ingestion, and query activity.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outlined"
            size="sm"
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5"
          >
            <svg
              className={`h-4 w-4 ${refreshing ? "animate-spin text-[var(--accent)]" : ""}`}
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
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex flex-col items-center justify-center p-16 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-color)]">
          <Spinner size="lg" />
          <p className="mt-4 text-sm text-[var(--text-secondary)]">Computing workspace analytics...</p>
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <div className="flex flex-col items-center text-center p-12 bg-[var(--bg-surface)] rounded-xl border border-rose-500/20 space-y-4">
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
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Unable to Load Analytics</h2>
            <p className="text-sm text-[var(--text-secondary)] mt-1">{error}</p>
          </div>
          <Button variant="outlined" onClick={() => loadData()}>
            Try Again
          </Button>
        </div>
      )}

      {/* Analytics Content */}
      {!loading && !error && analytics && (
        <div className="space-y-8">
          {/* Executive Overview KPI Banner */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total Documents */}
            <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl p-5 flex flex-col justify-between shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Total Documents
                </span>
                <div className="h-7 w-7 rounded-lg bg-[var(--accent)]/10 text-[var(--accent)] flex items-center justify-center">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                </div>
              </div>
              <div className="mt-3">
                <span className="text-3xl font-extrabold text-[var(--text-primary)]">
                  {analytics.documentStats.totalDocuments}
                </span>
                <div className="flex items-center gap-1.5 mt-1 text-xs text-[var(--text-secondary)]">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span>{analytics.documentStats.byStatus.READY} Ready</span>
                  <span className="text-[var(--text-muted)]">•</span>
                  <span>{analytics.documentStats.processingSuccessRate}% Success</span>
                </div>
              </div>
            </div>

            {/* Storage Consumption */}
            <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl p-5 flex flex-col justify-between shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Storage Consumed
                </span>
                <div className="h-7 w-7 rounded-lg bg-sky-500/10 text-sky-400 flex items-center justify-center">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 5.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
                  </svg>
                </div>
              </div>
              <div className="mt-3">
                <span className="text-3xl font-extrabold text-[var(--text-primary)]">
                  {formatBytes(analytics.storageStats.totalBytes)}
                </span>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  Avg {formatBytes(analytics.storageStats.avgSizeBytes)} / document
                </p>
              </div>
            </div>

            {/* AI Chunks & Embeddings */}
            <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl p-5 flex flex-col justify-between shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  AI Embeddings
                </span>
                <div className="h-7 w-7 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
                  </svg>
                </div>
              </div>
              <div className="mt-3">
                <span className="text-3xl font-extrabold text-[var(--text-primary)]">
                  {analytics.aiStats.totalEmbeddings}
                </span>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  Across {analytics.aiStats.totalChunks} chunks ({analytics.aiStats.totalIndexedTokens.toLocaleString()} tokens)
                </p>
              </div>
            </div>

            {/* Total Query Interactions */}
            <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl p-5 flex flex-col justify-between shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Queries & Activity
                </span>
                <div className="h-7 w-7 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3.75h5.25M6.75 19.5l-3 1.5.75-3.75A8.25 8.25 0 013.75 12a8.25 8.25 0 018.25-8.25h0A8.25 8.25 0 0120.25 12v.75A8.25 8.25 0 0112 21h-.75a8.25 8.25 0 01-4.5-1.5z" />
                  </svg>
                </div>
              </div>
              <div className="mt-3">
                <span className="text-3xl font-extrabold text-[var(--text-primary)]">
                  {clientQueryStats.userQueries + analytics.queryStats.totalDownloads}
                </span>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  {clientQueryStats.userQueries} chat queries • {analytics.queryStats.totalDownloads} downloads
                </p>
              </div>
            </div>
          </div>

          {/* Section 1: Document Processing Statistics */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-[var(--border-color)] pb-4">
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">
                  Document Processing Statistics
                </h2>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  Pipeline throughput, status breakdown, OCR page extraction, and queue execution.
                </p>
              </div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-semibold">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span>{analytics.documentStats.processingSuccessRate}% Success Rate</span>
              </div>
            </div>

            {/* Status Breakdown Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-4 rounded-lg bg-[var(--bg-surface-2)]/60 border border-[var(--border-color)]">
                <span className="text-xs text-[var(--text-muted)] font-medium">Ready / Indexed</span>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-2xl font-bold text-emerald-400">
                    {analytics.documentStats.byStatus.READY}
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    ({analytics.documentStats.totalDocuments > 0
                      ? Math.round((analytics.documentStats.byStatus.READY / analytics.documentStats.totalDocuments) * 100)
                      : 0}%)
                  </span>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-[var(--bg-surface-2)]/60 border border-[var(--border-color)]">
                <span className="text-xs text-[var(--text-muted)] font-medium">Processing</span>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-2xl font-bold text-sky-400">
                    {analytics.documentStats.byStatus.PROCESSING}
                  </span>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-[var(--bg-surface-2)]/60 border border-[var(--border-color)]">
                <span className="text-xs text-[var(--text-muted)] font-medium">Uploading</span>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-2xl font-bold text-amber-400">
                    {analytics.documentStats.byStatus.UPLOADING}
                  </span>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-[var(--bg-surface-2)]/60 border border-[var(--border-color)]">
                <span className="text-xs text-[var(--text-muted)] font-medium">Failed</span>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-2xl font-bold text-rose-400">
                    {analytics.documentStats.byStatus.FAILED}
                  </span>
                </div>
              </div>
            </div>

            {/* Pipeline Jobs & Content Aggregates */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              {/* Jobs Breakdown */}
              <div className="p-4 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface-2)]/30 space-y-3">
                <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                  Worker Jobs
                </span>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-[var(--text-muted)]">Completed</span>
                    <span className="font-semibold text-emerald-400">
                      {analytics.documentStats.jobsByStatus.COMPLETED}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[var(--text-muted)]">Queued</span>
                    <span className="font-semibold text-amber-400">
                      {analytics.documentStats.jobsByStatus.QUEUED}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[var(--text-muted)]">Active Processing</span>
                    <span className="font-semibold text-sky-400">
                      {analytics.documentStats.jobsByStatus.PROCESSING}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[var(--text-muted)]">Failed</span>
                    <span className="font-semibold text-rose-400">
                      {analytics.documentStats.jobsByStatus.FAILED}
                    </span>
                  </div>
                </div>
              </div>

              {/* Extraction Metrics */}
              <div className="p-4 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface-2)]/30 space-y-3">
                <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                  Text Extraction
                </span>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-[var(--text-muted)]">Total Pages Parsed</span>
                    <span className="font-semibold text-[var(--text-primary)]">
                      {analytics.documentStats.totalPagesExtracted.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[var(--text-muted)]">Total Characters</span>
                    <span className="font-semibold text-[var(--text-primary)]">
                      {analytics.documentStats.totalCharsExtracted.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[var(--text-muted)]">Avg Pages / Doc</span>
                    <span className="font-semibold text-[var(--text-primary)]">
                      {analytics.documentStats.totalDocuments > 0
                        ? (analytics.documentStats.totalPagesExtracted / analytics.documentStats.totalDocuments).toFixed(1)
                        : "0"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[var(--text-muted)]">Avg Job Duration</span>
                    <span className="font-semibold text-[var(--text-primary)]">
                      {analytics.documentStats.avgProcessingDurationSec !== null
                        ? `${analytics.documentStats.avgProcessingDurationSec}s`
                        : "Instant (<1s)"}
                    </span>
                  </div>
                </div>
              </div>

              {/* 7-Day Activity Trend */}
              <div className="p-4 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface-2)]/30 space-y-3 flex flex-col justify-between">
                <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                  7-Day Ingestion Trend
                </span>
                <div className="space-y-1.5">
                  <div className="flex items-end gap-2 h-20 pt-4">
                    {analytics.documentStats.recentTrend.map((point) => {
                      const maxUploads = Math.max(
                        ...analytics.documentStats.recentTrend.map((p) => p.uploads),
                        1,
                      );
                      const heightPct = Math.max(Math.round((point.uploads / maxUploads) * 100), 8);
                      const dayLabel = point.date.slice(5); // e.g. 11-15

                      return (
                        <div key={point.date} className="flex-1 flex flex-col items-center gap-1 h-full justify-end group">
                          <div
                            className="w-full bg-[var(--accent)]/40 group-hover:bg-[var(--accent)] rounded-t transition-colors"
                            style={{ height: `${heightPct}%` }}
                            title={`${point.date}: ${point.uploads} upload(s), ${point.ready} ready`}
                          />
                          <span className="text-[10px] text-[var(--text-muted)] scale-90">{dayLabel}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Storage Consumption */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl p-6 space-y-6">
            <div className="border-b border-[var(--border-color)] pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">Storage Consumption</h2>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  Object store footprint, categorical breakdown, and largest stored assets.
                </p>
              </div>
              <span className="text-sm font-bold text-[var(--text-primary)]">
                {formatBytes(analytics.storageStats.totalBytes)} total
              </span>
            </div>

            {/* Segmented Distribution Bar */}
            <div className="space-y-2">
              <div className="h-3 w-full bg-[var(--bg-surface-2)] rounded-full overflow-hidden flex border border-[var(--border-color)]">
                {analytics.storageStats.byCategory.map((cat) => {
                  const color = CATEGORY_COLORS[cat.category] || CATEGORY_COLORS.Other;
                  return (
                    <div
                      key={cat.category}
                      style={{ width: `${Math.max(cat.percentage, 1)}%`, backgroundColor: color }}
                      title={`${cat.category}: ${formatBytes(cat.bytes)} (${cat.percentage}%)`}
                      className="h-full transition-all duration-300"
                    />
                  );
                })}
              </div>

              {/* Category Legend & Pills */}
              <div className="flex flex-wrap gap-4 pt-2 text-xs">
                {analytics.storageStats.byCategory.map((cat) => {
                  const color = CATEGORY_COLORS[cat.category] || CATEGORY_COLORS.Other;
                  return (
                    <div key={cat.category} className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: color }} />
                      <span className="font-medium text-[var(--text-primary)]">{cat.category}:</span>
                      <span className="text-[var(--text-muted)]">
                        {formatBytes(cat.bytes)} ({cat.percentage}%)
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Largest Documents Table */}
            {analytics.storageStats.largestDocuments.length > 0 && (
              <div className="pt-2">
                <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
                  Top Storage Consumers
                </h3>
                <div className="overflow-x-auto rounded-lg border border-[var(--border-color)]">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-[var(--bg-surface-2)] text-[var(--text-muted)] uppercase border-b border-[var(--border-color)]">
                        <th className="py-2.5 px-3 font-semibold">Document Name</th>
                        <th className="py-2.5 px-3 font-semibold">File Type</th>
                        <th className="py-2.5 px-3 font-semibold">Size</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Uploaded</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-color)]">
                      {analytics.storageStats.largestDocuments.map((doc) => (
                        <tr key={doc.id} className="hover:bg-[var(--bg-surface-2)]/40 transition-colors">
                          <td className="py-2.5 px-3 font-medium text-[var(--text-primary)] max-w-xs truncate">
                            {doc.filename}
                          </td>
                          <td className="py-2.5 px-3 text-[var(--text-secondary)]">
                            <span className="px-1.5 py-0.5 rounded bg-[var(--bg-surface-2)] border border-[var(--border-color)] text-[10px]">
                              {doc.mimeType}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[var(--text-primary)] font-semibold">
                            {formatBytes(doc.sizeBytes)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-[var(--text-muted)] font-mono">
                            {formatDate(doc.createdAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Section 3: AI Usage & Ingestion */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl p-6 space-y-6">
            <div className="border-b border-[var(--border-color)] pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">AI Usage & Ingestion</h2>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  Semantic chunking, vector embeddings, token indexing, and model routing.
                </p>
              </div>
              <span className="text-xs font-mono text-purple-400 bg-purple-500/10 px-2.5 py-1 rounded-full border border-purple-500/20">
                {analytics.aiStats.embeddingModel}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="p-4 rounded-lg bg-[var(--bg-surface-2)]/60 border border-[var(--border-color)]">
                <span className="text-xs text-[var(--text-muted)] font-medium">Vector Embeddings</span>
                <span className="block text-2xl font-bold text-purple-400 mt-1">
                  {analytics.aiStats.totalEmbeddings.toLocaleString()}
                </span>
                <span className="text-[11px] text-[var(--text-muted)] mt-0.5 block">
                  768-dimensional L2 normalized
                </span>
              </div>

              <div className="p-4 rounded-lg bg-[var(--bg-surface-2)]/60 border border-[var(--border-color)]">
                <span className="text-xs text-[var(--text-muted)] font-medium">Total Chunks</span>
                <span className="block text-2xl font-bold text-[var(--text-primary)] mt-1">
                  {analytics.aiStats.totalChunks.toLocaleString()}
                </span>
                <span className="text-[11px] text-[var(--text-muted)] mt-0.5 block">
                  ~{analytics.aiStats.avgChunksPerDocument} chunks / document
                </span>
              </div>

              <div className="p-4 rounded-lg bg-[var(--bg-surface-2)]/60 border border-[var(--border-color)]">
                <span className="text-xs text-[var(--text-muted)] font-medium">Tokens Indexed</span>
                <span className="block text-2xl font-bold text-sky-400 mt-1">
                  {analytics.aiStats.totalIndexedTokens.toLocaleString()}
                </span>
                <span className="text-[11px] text-[var(--text-muted)] mt-0.5 block">
                  Avg {analytics.aiStats.avgTokensPerChunk} tokens / chunk
                </span>
              </div>

              <div className="p-4 rounded-lg bg-[var(--bg-surface-2)]/60 border border-[var(--border-color)]">
                <span className="text-xs text-[var(--text-muted)] font-medium">Chat Model</span>
                <span className="block text-lg font-bold text-emerald-400 mt-1 truncate">
                  {analytics.aiStats.chatModel}
                </span>
                <span className="text-[11px] text-[var(--text-muted)] mt-0.5 block">
                  Hybrid RAG (Vector + BM25)
                </span>
              </div>
            </div>
          </div>

          {/* Section 4: Query Counts & User Interactions */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl p-6 space-y-6">
            <div className="border-b border-[var(--border-color)] pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">Query Counts & Interactions</h2>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  User questions, conversational engagement, citation frequency, and document queries.
                </p>
              </div>
              <span className="text-xs text-[var(--text-muted)]">
                Across {clientQueryStats.totalSessions} conversation thread(s)
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="p-4 rounded-lg bg-[var(--bg-surface-2)]/60 border border-[var(--border-color)]">
                <span className="text-xs text-[var(--text-muted)] font-medium">Chat Queries</span>
                <span className="block text-2xl font-bold text-[var(--text-primary)] mt-1">
                  {clientQueryStats.userQueries}
                </span>
                <span className="text-[11px] text-[var(--text-muted)] mt-0.5 block">
                  ~{clientQueryStats.avgQueriesPerSession} queries / conversation
                </span>
              </div>

              <div className="p-4 rounded-lg bg-[var(--bg-surface-2)]/60 border border-[var(--border-color)]">
                <span className="text-xs text-[var(--text-muted)] font-medium">AI Responses</span>
                <span className="block text-2xl font-bold text-emerald-400 mt-1">
                  {clientQueryStats.assistantResponses}
                </span>
                <span className="text-[11px] text-[var(--text-muted)] mt-0.5 block">
                  With streaming answers
                </span>
              </div>

              <div className="p-4 rounded-lg bg-[var(--bg-surface-2)]/60 border border-[var(--border-color)]">
                <span className="text-xs text-[var(--text-muted)] font-medium">Citations Generated</span>
                <span className="block text-2xl font-bold text-sky-400 mt-1">
                  {clientQueryStats.totalCitations}
                </span>
                <span className="text-[11px] text-[var(--text-muted)] mt-0.5 block">
                  Document passages referenced
                </span>
              </div>

              <div className="p-4 rounded-lg bg-[var(--bg-surface-2)]/60 border border-[var(--border-color)]">
                <span className="text-xs text-[var(--text-muted)] font-medium">Targeted Queries</span>
                <span className="block text-2xl font-bold text-purple-400 mt-1">
                  {clientQueryStats.targetedSessions}
                </span>
                <span className="text-[11px] text-[var(--text-muted)] mt-0.5 block">
                  Scoped to specific document(s)
                </span>
              </div>
            </div>

            {/* Audit & File Operations Summary */}
            <div className="pt-2 border-t border-[var(--border-color)]">
              <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
                Workspace Action Volume
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-lg bg-[var(--bg-surface-2)]/40 border border-[var(--border-color)] flex justify-between items-center">
                  <span className="text-[var(--text-muted)]">Document Downloads</span>
                  <span className="font-semibold text-sky-400">{analytics.queryStats.totalDownloads}</span>
                </div>
                <div className="p-3 rounded-lg bg-[var(--bg-surface-2)]/40 border border-[var(--border-color)] flex justify-between items-center">
                  <span className="text-[var(--text-muted)]">Upload Events</span>
                  <span className="font-semibold text-emerald-400">{analytics.queryStats.totalUploadEvents}</span>
                </div>
                <div className="p-3 rounded-lg bg-[var(--bg-surface-2)]/40 border border-[var(--border-color)] flex justify-between items-center">
                  <span className="text-[var(--text-muted)]">Deletion Events</span>
                  <span className="font-semibold text-rose-400">{analytics.queryStats.totalDeleteEvents}</span>
                </div>
                <div className="p-3 rounded-lg bg-[var(--bg-surface-2)]/40 border border-[var(--border-color)] flex justify-between items-center">
                  <span className="text-[var(--text-muted)]">Member / Role Updates</span>
                  <span className="font-semibold text-amber-400">{analytics.queryStats.totalMemberEvents}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
