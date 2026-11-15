"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { getWorkspaces, getWorkspace } from "@/lib/api";
import { getWorkspaceId, setWorkspaceId, WORKSPACE_CHANGED_EVENT } from "@/lib/auth";
import type { Workspace } from "@/lib/types";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";

interface WorkspaceSwitcherProps {
  variant?: "sidebar" | "header";
  className?: string;
  onWorkspaceSwitched?: (workspace: Workspace) => void;
}

function getInitials(name: string): string {
  if (!name || !name.trim()) return "W";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function getRoleBadgeStyle(role?: string | null): { bg: string; color: string; border: string } {
  switch (role) {
    case "OWNER":
      return {
        bg: "rgba(147, 51, 234, 0.12)",
        color: "#a855f7",
        border: "rgba(147, 51, 234, 0.25)",
      };
    case "ADMIN":
      return {
        bg: "rgba(59, 130, 246, 0.12)",
        color: "#60a5fa",
        border: "rgba(59, 130, 246, 0.25)",
      };
    default:
      return {
        bg: "rgba(156, 163, 175, 0.12)",
        color: "#9ca3af",
        border: "rgba(156, 163, 175, 0.25)",
      };
  }
}

export function WorkspaceSwitcher({
  variant = "sidebar",
  className = "",
  onWorkspaceSwitched,
}: WorkspaceSwitcherProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);

  const loadWorkspaces = useCallback(async () => {
    try {
      setIsLoading(true);
      const list = await getWorkspaces();
      setWorkspaces(list);

      const currentId = getWorkspaceId();
      if (currentId && list.some((w) => w.id === currentId)) {
        setActiveWorkspaceId(currentId);
      } else if (list.length > 0) {
        // Fallback to first workspace if none or mismatch
        const fallback = list[0].id;
        setActiveWorkspaceId(fallback);
        setWorkspaceId(fallback);
      }
    } catch {
      // Fallback: load single workspace if list fails
      const currentId = getWorkspaceId();
      if (currentId) {
        setActiveWorkspaceId(currentId);
        getWorkspace(currentId)
          .then((ws) => setWorkspaces([ws]))
          .catch(() => {});
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWorkspaces();

    const handleStorageChange = () => {
      const currentId = getWorkspaceId();
      if (currentId) setActiveWorkspaceId(currentId);
    };

    window.addEventListener(WORKSPACE_CHANGED_EVENT, handleStorageChange);
    window.addEventListener("storage", handleStorageChange);

    return () => {
      window.removeEventListener(WORKSPACE_CHANGED_EVENT, handleStorageChange);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [loadWorkspaces]);

  // Click outside listener
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const activeWorkspace =
    workspaces.find((w) => w.id === activeWorkspaceId) ||
    (workspaces.length > 0 ? workspaces[0] : null);

  const handleSelectWorkspace = (target: Workspace) => {
    if (target.id === activeWorkspaceId) {
      setIsOpen(false);
      return;
    }

    setIsSwitching(target.id);
    setActiveWorkspaceId(target.id);
    setWorkspaceId(target.id);
    setIsOpen(false);
    onWorkspaceSwitched?.(target);

    // Refresh/reload page seamlessly to load target workspace data without logging out
    setTimeout(() => {
      window.location.reload();
    }, 100);
  };

  const handleWorkspaceCreated = (newWs: Workspace) => {
    setWorkspaces((prev) => [...prev, newWs]);
    setActiveWorkspaceId(newWs.id);
  };

  const isSidebar = variant === "sidebar";

  return (
    <div
      ref={containerRef}
      className={`relative ${className}`}
      data-testid="workspace-switcher"
    >
      {/* ── Trigger Button ── */}
      <button
        type="button"
        id="workspace-switcher-button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`Switch workspace, currently active: ${activeWorkspace?.name || "Workspace"}`}
        className={[
          "flex items-center gap-2.5 rounded-lg transition-all cursor-pointer select-none text-left w-full outline-none",
          isSidebar
            ? "px-3 py-2 border hover:border-white/20"
            : "px-2.5 py-1.5 border text-xs shadow-xs",
        ].join(" ")}
        style={
          isSidebar
            ? {
                background: isOpen ? "rgba(255, 255, 255, 0.08)" : "rgba(255, 255, 255, 0.04)",
                borderColor: isOpen ? "rgba(255, 255, 255, 0.15)" : "var(--sidebar-divider)",
                color: "#ffffff",
              }
            : {
                background: "var(--bg-surface)",
                borderColor: "var(--border-color)",
                color: "var(--text-primary)",
              }
        }
      >
        {/* Workspace Avatar */}
        <div
          className={[
            "rounded-md flex items-center justify-center font-bold text-white shrink-0 shadow-xs",
            isSidebar ? "h-6 w-6 text-xs" : "h-5 w-5 text-[10px]",
          ].join(" ")}
          style={{
            background: "linear-gradient(135deg, var(--accent) 0%, #e11d48 100%)",
          }}
        >
          {getInitials(activeWorkspace?.name || "W")}
        </div>

        {/* Workspace Info */}
        <div className="flex-1 min-w-0">
          <p
            id="workspace-switcher-active-name"
            className={[
              "truncate font-semibold leading-tight",
              isSidebar ? "text-xs text-white" : "text-xs text-[var(--text-primary)]",
            ].join(" ")}
          >
            {activeWorkspace ? activeWorkspace.name : isLoading ? "Loading…" : "Workspace"}
          </p>
          {activeWorkspace?.role && (
            <p
              className="text-[10px] leading-tight mt-0.5 uppercase tracking-wider font-semibold opacity-70 truncate"
              style={
                isSidebar
                  ? { color: "var(--sidebar-text)" }
                  : { color: "var(--text-muted)" }
              }
            >
              {activeWorkspace.role.toLowerCase()}
            </p>
          )}
        </div>

        {/* Chevron Icon */}
        <svg
          className={[
            "shrink-0 transition-transform duration-150",
            isSidebar ? "h-3.5 w-3.5 text-white/60" : "h-3.5 w-3.5 text-[var(--text-muted)]",
            isOpen ? "rotate-180" : "",
          ].join(" ")}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {/* ── Dropdown Popover ── */}
      {isOpen && (
        <div
          role="menu"
          id="workspace-switcher-menu"
          className={[
            "absolute z-50 rounded-xl shadow-2xl border overflow-hidden transition-all",
            isSidebar
              ? "left-0 right-0 top-full mt-1.5 w-full min-w-[240px]"
              : "right-0 top-full mt-1.5 w-72",
          ].join(" ")}
          style={{
            background: "var(--bg-surface)",
            borderColor: "var(--border-color)",
          }}
        >
          {/* Header */}
          <div
            className="px-3.5 py-2.5 border-b flex items-center justify-between"
            style={{
              background: "var(--bg-surface-2)",
              borderColor: "var(--border-color)",
            }}
          >
            <span
              className="text-[11px] font-bold uppercase tracking-wider"
              style={{ color: "var(--text-secondary)" }}
            >
              Workspaces
            </span>
            <span
              className="text-[10px] px-1.5 py-0.2 rounded-full font-semibold"
              style={{
                background: "var(--bg-surface)",
                color: "var(--text-muted)",
                border: "1px solid var(--border-color)",
              }}
            >
              {workspaces.length}
            </span>
          </div>

          {/* Workspaces List */}
          <div className="max-h-60 overflow-y-auto p-1.5 space-y-1">
            {workspaces.length === 0 ? (
              <p
                className="py-4 text-center text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                No workspaces available.
              </p>
            ) : (
              workspaces.map((ws) => {
                const isActive = ws.id === activeWorkspaceId;
                const roleStyle = getRoleBadgeStyle(ws.role);
                const isTargetSwitching = isSwitching === ws.id;

                return (
                  <button
                    key={ws.id}
                    type="button"
                    role="menuitem"
                    onClick={() => handleSelectWorkspace(ws)}
                    className={[
                      "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors cursor-pointer outline-none select-none",
                      isActive
                        ? "bg-[var(--accent-light)] font-semibold"
                        : "hover:bg-[var(--bg-surface-2)]",
                    ].join(" ")}
                    aria-current={isActive ? "true" : undefined}
                  >
                    {/* Workspace Avatar */}
                    <div
                      className="h-7 w-7 rounded-md flex items-center justify-center text-xs font-bold text-white shrink-0 shadow-2xs"
                      style={{
                        background: isActive
                          ? "var(--accent)"
                          : "linear-gradient(135deg, #475569 0%, #334155 100%)",
                      }}
                    >
                      {getInitials(ws.name)}
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p
                          className="text-xs truncate font-medium"
                          style={{
                            color: isActive
                              ? "var(--accent)"
                              : "var(--text-primary)",
                          }}
                        >
                          {ws.name}
                        </p>
                        {ws.role && (
                          <span
                            className="text-[9px] px-1.5 py-0.2 rounded font-semibold uppercase tracking-wider shrink-0 border"
                            style={{
                              background: roleStyle.bg,
                              color: roleStyle.color,
                              borderColor: roleStyle.border,
                            }}
                          >
                            {ws.role}
                          </span>
                        )}
                      </div>

                      {typeof ws.documentCount === "number" && (
                        <p
                          className="text-[10px] mt-0.5 truncate"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {ws.documentCount} {ws.documentCount === 1 ? "document" : "documents"}
                          {typeof ws.memberCount === "number" ? ` · ${ws.memberCount} ${ws.memberCount === 1 ? "member" : "members"}` : ""}
                        </p>
                      )}
                    </div>

                    {/* Active Checkmark or Switching Indicator */}
                    {isTargetSwitching ? (
                      <span className="text-[10px] text-[var(--accent)] font-semibold shrink-0 animate-pulse">
                        Switching…
                      </span>
                    ) : isActive ? (
                      <svg
                        className="h-4 w-4 shrink-0 text-[var(--accent)]"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                        aria-label="Active workspace"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>

          {/* ── Footer: Create Workspace Button ── */}
          <div
            className="p-1.5 border-t"
            style={{
              background: "var(--bg-surface-2)",
              borderColor: "var(--border-color)",
            }}
          >
            <button
              type="button"
              id="create-workspace-btn"
              onClick={() => {
                setIsOpen(false);
                setIsCreateOpen(true);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer hover:bg-[var(--bg-surface)] text-[var(--text-primary)] hover:text-[var(--accent)]"
            >
              <svg
                className="h-3.5 w-3.5 text-[var(--accent)]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              <span>Create New Workspace</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Modal Dialog for Creating Workspace ── */}
      <CreateWorkspaceDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={handleWorkspaceCreated}
      />
    </div>
  );
}
