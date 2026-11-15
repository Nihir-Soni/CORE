"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import {
  getWorkspaceMembers,
  getWorkspaceInvitations,
  getWorkspaceRole,
  ApiError,
} from "@/lib/api";
import { getWorkspaceId, getCurrentUser } from "@/lib/auth";

const WORKSPACE_CHANGED_EVENT = "core_workspace_changed";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { InviteMemberDialog } from "@/components/members/InviteMemberDialog";
import { ChangeRoleDialog } from "@/components/members/ChangeRoleDialog";
import { RemoveMemberDialog } from "@/components/members/RemoveMemberDialog";
import { RevokeInvitationDialog } from "@/components/members/RevokeInvitationDialog";
import type {
  WorkspaceMember,
  WorkspaceInvitation,
  CreateInvitationResponse,
} from "@/lib/types";

type LoadPhase = "loading" | "ready" | "forbidden" | "error";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, { bg: string; color: string; border: string }> = {
    OWNER: {
      bg: "rgba(124, 58, 237, 0.12)",
      color: "#a78bfa",
      border: "rgba(124, 58, 237, 0.3)",
    },
    ADMIN: {
      bg: "rgba(59, 130, 246, 0.12)",
      color: "#60a5fa",
      border: "rgba(59, 130, 246, 0.3)",
    },
    MEMBER: {
      bg: "rgba(107, 114, 128, 0.12)",
      color: "#9ca3af",
      border: "rgba(107, 114, 128, 0.3)",
    },
  };

  const style = styles[role] ?? styles.MEMBER;

  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold uppercase tracking-wider"
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

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; color: string }> = {
    PENDING: { bg: "rgba(245, 158, 11, 0.15)", color: "#fbbf24" },
    ACCEPTED: { bg: "rgba(16, 185, 129, 0.15)", color: "#34d399" },
    REVOKED: { bg: "rgba(239, 68, 68, 0.15)", color: "#f87171" },
    EXPIRED: { bg: "rgba(156, 163, 175, 0.15)", color: "#9ca3af" },
  };

  const style = styles[status] ?? { bg: "rgba(156, 163, 175, 0.15)", color: "#9ca3af" };

  return (
    <span
      className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: style.bg, color: style.color }}
    >
      {status}
    </span>
  );
}

export default function MembersPage() {
  const [phase, setPhase] = useState<LoadPhase>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Dialog states
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [memberToChangeRole, setMemberToChangeRole] = useState<WorkspaceMember | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<WorkspaceMember | null>(null);
  const [invitationToRevoke, setInvitationToRevoke] = useState<WorkspaceInvitation | null>(null);

  const [workspaceId, setWorkspaceIdState] = useState<string>(() => getWorkspaceId() ?? "");

  useEffect(() => {
    const handleWorkspaceChanged = (e: any) => {
      const newId = e?.detail?.workspaceId || getWorkspaceId() || "";
      setWorkspaceIdState(newId);
    };
    window.addEventListener(WORKSPACE_CHANGED_EVENT, handleWorkspaceChanged);
    return () => window.removeEventListener(WORKSPACE_CHANGED_EVENT, handleWorkspaceChanged);
  }, []);
  const currentUser = useMemo(() => getCurrentUser(), []);

  const showNotification = useCallback((msg: string) => {
    setSuccessToast(msg);
    setTimeout(() => {
      setSuccessToast((prev) => (prev === msg ? null : prev));
    }, 4000);
  }, []);

  const loadData = useCallback(async () => {
    if (!workspaceId) {
      setPhase("error");
      setErrorMessage("No active workspace found.");
      return;
    }

    setPhase("loading");
    setErrorMessage(null);

    try {
      const role = await getWorkspaceRole(workspaceId);
      setUserRole(role);

      if (role === "MEMBER") {
        setPhase("forbidden");
        return;
      }

      const [membersData, invitationsData] = await Promise.all([
        getWorkspaceMembers(workspaceId),
        getWorkspaceInvitations(workspaceId),
      ]);

      setMembers(membersData);
      setInvitations(invitationsData);
      setPhase("ready");
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 403) {
        setPhase("forbidden");
      } else {
        setPhase("error");
        setErrorMessage("Failed to load workspace members and invitations.");
      }
    }
  }, [workspaceId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredMembers = useMemo(() => {
    if (!searchQuery.trim()) return members;
    const query = searchQuery.toLowerCase();
    return members.filter(
      (m) =>
        m.email.toLowerCase().includes(query) ||
        (m.name && m.name.toLowerCase().includes(query)),
    );
  }, [members, searchQuery]);

  // Handle invitation created
  const handleInvitationSuccess = (newInvite: CreateInvitationResponse) => {
    setInvitations((prev) => [
      {
        id: newInvite.id,
        workspaceId: newInvite.workspaceId,
        email: newInvite.email,
        role: newInvite.role,
        status: newInvite.status,
        expiresAt: newInvite.expiresAt,
        createdAt: newInvite.createdAt,
      },
      ...prev,
    ]);
    showNotification(`Invitation sent to ${newInvite.email}`);
  };

  // Handle role changed
  const handleRoleChangeSuccess = (updated: { userId: string; role: string }) => {
    setMembers((prev) =>
      prev.map((m) =>
        m.userId === updated.userId ? { ...m, role: updated.role as WorkspaceMember["role"] } : m,
      ),
    );
    showNotification("Member role updated successfully.");
  };

  // Handle member removed
  const handleMemberRemoveSuccess = (removedUserId: string) => {
    setMembers((prev) => prev.filter((m) => m.userId !== removedUserId));
    showNotification("Member removed from workspace.");
  };

  // Handle invitation revoked
  const handleRevokeSuccess = (revokedId: string) => {
    setInvitations((prev) =>
      prev.map((inv) => (inv.id === revokedId ? { ...inv, status: "REVOKED" } : inv)),
    );
    showNotification("Invitation revoked.");
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-6xl mx-auto">
      {/* Toast Notification */}
      {successToast && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-between p-3.5 rounded-lg border bg-emerald-500/10 border-emerald-500/30 text-emerald-300 text-sm shadow-md"
        >
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 shrink-0 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            <span>{successToast}</span>
          </div>
          <button
            onClick={() => setSuccessToast(null)}
            className="text-emerald-400 hover:text-emerald-200 transition-colors"
            aria-label="Dismiss notification"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
            Workspace Members
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-0.5">
            Manage collaborators, assign workspace permissions, and send invitations.
          </p>
        </div>

        {phase === "ready" && (userRole === "OWNER" || userRole === "ADMIN") && (
          <Button
            id="invite-member-button"
            variant="primary"
            onClick={() => setIsInviteOpen(true)}
            startIcon={
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.765z" />
              </svg>
            }
          >
            Invite Member
          </Button>
        )}
      </div>

      {/* Loading Phase */}
      {phase === "loading" && (
        <div className="flex flex-col items-center justify-center p-16 space-y-3 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-color)]">
          <Spinner size="lg" />
          <p className="text-sm text-[var(--text-secondary)]">Loading workspace members…</p>
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
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            Access Restricted
          </h2>
          <p className="text-sm text-[var(--text-secondary)] max-w-md">
            You are a Member of this workspace. Member management and invitation controls are only accessible to workspace Owners and Administrators.
          </p>
        </div>
      )}

      {/* Error Phase */}
      {phase === "error" && (
        <div
          role="alert"
          className="p-6 bg-[var(--bg-surface)] rounded-xl border border-[var(--status-failed)]/20 text-center space-y-3"
        >
          <p className="text-sm text-[var(--status-failed)]">
            {errorMessage || "An error occurred while loading workspace members."}
          </p>
          <Button variant="secondary" onClick={loadData}>
            Retry
          </Button>
        </div>
      )}

      {/* Ready Phase */}
      {phase === "ready" && (
        <div className="space-y-8">
          {/* Members Section */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-[var(--border-color)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[var(--sidebar-bg)]">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Active Members ({members.length})
                </h2>
                <p className="text-xs text-[var(--sidebar-text)]">
                  Users who currently have access to this workspace.
                </p>
              </div>

              {/* Search */}
              <div className="relative w-full sm:w-64">
                <input
                  type="text"
                  placeholder="Filter by name or email…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 w-full pl-8 pr-3 text-xs rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--text-primary)] outline-none focus:border-[var(--input-border-focus)] transition-colors"
                />
                <svg
                  className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-[var(--text-muted)] pointer-events-none"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--border-color)] bg-[var(--bg-surface-2)] text-[var(--text-secondary)]">
                    <th scope="col" className="px-4 py-3 font-semibold uppercase tracking-wider">
                      User
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold uppercase tracking-wider">
                      Role
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold uppercase tracking-wider">
                      Joined Date
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold uppercase tracking-wider text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-color)]">
                  {filteredMembers.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-[var(--text-muted)]">
                        {searchQuery ? "No members match your search criteria." : "No members found."}
                      </td>
                    </tr>
                  ) : (
                    filteredMembers.map((member) => {
                      const isSelf = currentUser?.userId === member.userId;
                      const isTargetOwner = member.role === "OWNER";
                      const isTargetAdmin = member.role === "ADMIN";

                      // OWNER can change roles of ADMIN and MEMBER
                      const canChangeRole = userRole === "OWNER" && !isSelf;

                      // OWNER can remove ADMIN and MEMBER.
                      // ADMIN can remove MEMBER, but CANNOT remove OWNER or other ADMINs.
                      const canRemove =
                        !isSelf &&
                        (userRole === "OWNER" ||
                          (userRole === "ADMIN" && !isTargetOwner && !isTargetAdmin));

                      return (
                        <tr
                          key={member.userId}
                          className="hover:bg-[var(--bg-surface-2)]/50 transition-colors"
                        >
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-2.5">
                              <div className="h-8 w-8 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] flex items-center justify-center font-bold text-xs uppercase">
                                {(member.name || member.email)[0]}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <p className="font-medium text-[var(--text-primary)] truncate">
                                    {member.name || member.email}
                                  </p>
                                  {isSelf && (
                                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-[var(--bg-surface-2)] text-[var(--text-muted)] border border-[var(--border-color)]">
                                      You
                                    </span>
                                  )}
                                </div>
                                {member.name && (
                                  <p className="text-[11px] text-[var(--text-muted)] truncate font-mono">
                                    {member.email}
                                  </p>
                                )}
                              </div>
                            </div>
                          </td>

                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <RoleBadge role={member.role} />
                          </td>

                          <td className="px-4 py-3.5 whitespace-nowrap text-[var(--text-secondary)]">
                            {formatDate(member.createdAt)}
                          </td>

                          <td className="px-4 py-3.5 whitespace-nowrap text-right">
                            <div className="inline-flex items-center gap-1.5">
                              {canChangeRole && (
                                <button
                                  type="button"
                                  onClick={() => setMemberToChangeRole(member)}
                                  className="px-2.5 py-1 text-xs rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-2)] transition-colors"
                                >
                                  Change Role
                                </button>
                              )}

                              {canRemove && (
                                <button
                                  type="button"
                                  onClick={() => setMemberToRemove(member)}
                                  className="px-2.5 py-1 text-xs rounded border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 transition-colors"
                                >
                                  Remove
                                </button>
                              )}

                              {!canChangeRole && !canRemove && (
                                <span className="text-[11px] text-[var(--text-muted)] italic">
                                  {isSelf ? "Current user" : "Protected"}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pending Invitations Section */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-[var(--border-color)] bg-[var(--sidebar-bg)]">
              <h2 className="text-sm font-semibold text-white">
                Workspace Invitations ({invitations.length})
              </h2>
              <p className="text-xs text-[var(--sidebar-text)]">
                Invitations sent to prospective members.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--border-color)] bg-[var(--bg-surface-2)] text-[var(--text-secondary)]">
                    <th scope="col" className="px-4 py-3 font-semibold uppercase tracking-wider">
                      Invited Email
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold uppercase tracking-wider">
                      Role
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold uppercase tracking-wider">
                      Status
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold uppercase tracking-wider">
                      Expires At
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold uppercase tracking-wider text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-color)]">
                  {invitations.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-[var(--text-muted)]">
                        No invitations have been sent yet.
                      </td>
                    </tr>
                  ) : (
                    invitations.map((inv) => {
                      const canRevoke =
                        inv.status === "PENDING" &&
                        (userRole === "OWNER" || userRole === "ADMIN");

                      return (
                        <tr
                          key={inv.id}
                          className="hover:bg-[var(--bg-surface-2)]/50 transition-colors"
                        >
                          <td className="px-4 py-3.5">
                            <span className="font-mono text-[var(--text-primary)]">
                              {inv.email}
                            </span>
                            {inv.invitedBy && (
                              <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                                Invited by {inv.invitedBy.name || inv.invitedBy.email}
                              </p>
                            )}
                          </td>

                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <RoleBadge role={inv.role} />
                          </td>

                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <StatusBadge status={inv.status} />
                          </td>

                          <td className="px-4 py-3.5 whitespace-nowrap text-[var(--text-secondary)]">
                            {formatDate(inv.expiresAt)}
                          </td>

                          <td className="px-4 py-3.5 whitespace-nowrap text-right">
                            {canRevoke ? (
                              <button
                                type="button"
                                onClick={() => setInvitationToRevoke(inv)}
                                className="px-2.5 py-1 text-xs rounded border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 transition-colors"
                              >
                                Revoke
                              </button>
                            ) : (
                              <span className="text-[11px] text-[var(--text-muted)]">
                                —
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Dialogs */}
      <InviteMemberDialog
        workspaceId={workspaceId}
        isOpen={isInviteOpen}
        onClose={() => setIsInviteOpen(false)}
        onSuccess={handleInvitationSuccess}
      />

      <ChangeRoleDialog
        member={memberToChangeRole}
        workspaceId={workspaceId}
        isOpen={Boolean(memberToChangeRole)}
        onClose={() => setMemberToChangeRole(null)}
        onSuccess={handleRoleChangeSuccess}
      />

      <RemoveMemberDialog
        member={memberToRemove}
        workspaceId={workspaceId}
        isOpen={Boolean(memberToRemove)}
        onClose={() => setMemberToRemove(null)}
        onSuccess={handleMemberRemoveSuccess}
      />

      <RevokeInvitationDialog
        invitation={invitationToRevoke}
        workspaceId={workspaceId}
        isOpen={Boolean(invitationToRevoke)}
        onClose={() => setInvitationToRevoke(null)}
        onSuccess={handleRevokeSuccess}
      />
    </div>
  );
}
