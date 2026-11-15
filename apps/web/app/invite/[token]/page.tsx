"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  getInvitationDetails,
  acceptInvitation,
  logout,
  ApiError,
} from "@/lib/api";
import { isAuthenticated, getCurrentUser, getWorkspaceId } from "@/lib/auth";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import type { InvitationDetailsResponse } from "@/lib/types";

type Phase = "loading" | "ready" | "not_found" | "accepted" | "error";

export default function InviteAcceptPage() {
  const params = useParams();
  const router = useRouter();
  const token = typeof params.token === "string" ? params.token : "";

  const [phase, setPhase] = useState<Phase>("loading");
  const [invitation, setInvitation] = useState<InvitationDetailsResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const authed = isAuthenticated();
  const currentUser = getCurrentUser();

  const loadDetails = useCallback(async () => {
    if (!token) {
      setPhase("not_found");
      return;
    }

    setPhase("loading");
    setErrorMessage(null);

    try {
      const details = await getInvitationDetails(token);
      setInvitation(details);
      setPhase("ready");
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 404) {
        setPhase("not_found");
      } else {
        setPhase("error");
        setErrorMessage("Unable to verify invitation. Please check your link or network.");
      }
    }
  }, [token]);

  useEffect(() => {
    loadDetails();
  }, [loadDetails]);

  const handleAccept = async () => {
    if (!token || isSubmitting) return;

    setIsSubmitting(true);
    setAcceptError(null);

    try {
      const res = await acceptInvitation(token);
      // Switch active workspace to accepted workspace
      if (typeof window !== "undefined") {
        localStorage.setItem("core_workspace_id", res.workspaceId);
      }
      setPhase("accepted");
      setTimeout(() => {
        router.push("/dashboard");
      }, 1500);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 409 || err.message === "already_member") {
          // If already member, update workspace and redirect
          if (invitation?.workspaceId && typeof window !== "undefined") {
            localStorage.setItem("core_workspace_id", invitation.workspaceId);
          }
          setPhase("accepted");
          setTimeout(() => {
            router.push("/dashboard");
          }, 1500);
          return;
        } else if (err.status === 403 && err.message === "email_mismatch") {
          setAcceptError(
            `You are signed in with the wrong account. This invite was sent to ${invitation?.email}.`,
          );
        } else if (err.message === "invitation_expired") {
          setAcceptError("This invitation has expired.");
        } else if (err.message === "invitation_revoked") {
          setAcceptError("This invitation has been revoked by an administrator.");
        } else if (err.message === "invitation_already_accepted") {
          setAcceptError("This invitation has already been accepted.");
        } else {
          setAcceptError(err.message || "Failed to accept invitation.");
        }
      } else {
        setAcceptError("A network error occurred. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSwitchAccount = async () => {
    await logout();
    router.push(`/?mode=login&returnTo=/invite/${encodeURIComponent(token)}`);
  };

  const isEmailMismatch =
    authed &&
    currentUser &&
    invitation &&
    currentUser.email.trim().toLowerCase() !== invitation.email.trim().toLowerCase();

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "var(--bg-page)" }}
    >
      <div className="w-full max-w-md bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-2xl shadow-2xl overflow-hidden animate-fade-in">
        {/* Header */}
        <div className="p-6 text-center border-b border-[var(--border-color)] bg-[var(--sidebar-bg)]">
          <div
            className="h-12 w-12 rounded-xl mx-auto flex items-center justify-center text-white font-bold shadow-md"
            style={{ background: "var(--accent)" }}
          >
            <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.999-3.199a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
            </svg>
          </div>
          <h1 className="mt-4 text-lg font-bold text-white">
            Workspace Invitation
          </h1>
          <p className="text-xs text-[var(--sidebar-text)] mt-1">
            Comachi Hyper Intelligence Encyclopedia (CHiE)
          </p>
        </div>

        {/* Loading */}
        {phase === "loading" && (
          <div className="p-12 flex flex-col items-center justify-center space-y-3 text-center">
            <Spinner size="lg" />
            <p className="text-xs text-[var(--text-secondary)]">Verifying invitation link…</p>
          </div>
        )}

        {/* Not Found */}
        {phase === "not_found" && (
          <div className="p-8 text-center space-y-4">
            <div className="h-10 w-10 rounded-full mx-auto flex items-center justify-center bg-rose-500/10 text-rose-400">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Invitation Not Found
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                This invitation link is invalid or has expired. Please ask a workspace administrator to send a new invitation.
              </p>
            </div>
            <Link href="/login">
              <Button variant="secondary" size="md" className="w-full">
                Go to Sign In
              </Button>
            </Link>
          </div>
        )}

        {/* Error */}
        {phase === "error" && (
          <div className="p-8 text-center space-y-4">
            <p className="text-xs text-[var(--status-failed)]">{errorMessage}</p>
            <Button variant="secondary" size="md" onClick={loadDetails} className="w-full">
              Retry
            </Button>
          </div>
        )}

        {/* Accepted Success */}
        {phase === "accepted" && (
          <div className="p-8 text-center space-y-4">
            <div className="h-12 w-12 rounded-full mx-auto flex items-center justify-center bg-emerald-500/10 text-emerald-400">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                Welcome to {invitation?.workspaceName || "the workspace"}!
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                You have joined successfully. Redirecting you to the dashboard…
              </p>
            </div>
          </div>
        )}

        {/* Ready phase */}
        {phase === "ready" && invitation && (
          <div className="p-6 space-y-5">
            {acceptError && (
              <div
                role="alert"
                className="p-3 text-xs rounded bg-[var(--status-failed-bg)] border border-[var(--status-failed)]/20 text-[var(--status-failed)]"
              >
                {acceptError}
              </div>
            )}

            {/* Invalid status */}
            {invitation.status !== "PENDING" ? (
              <div className="p-4 rounded-lg bg-[var(--bg-surface-2)] border border-[var(--border-color)] text-center space-y-2">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider bg-rose-500/10 text-rose-400 border border-rose-500/20">
                  {invitation.status}
                </span>
                <p className="text-xs text-[var(--text-secondary)]">
                  This invitation is no longer valid because it is{" "}
                  <span className="font-semibold">{invitation.status.toLowerCase()}</span>.
                </p>
              </div>
            ) : (
              <>
                {/* Workspace Details Card */}
                <div className="p-4 rounded-xl bg-[var(--bg-surface-2)] border border-[var(--border-color)] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--text-secondary)] uppercase tracking-wider font-semibold">
                      Workspace
                    </span>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20">
                      {invitation.role}
                    </span>
                  </div>
                  <p className="text-base font-bold text-[var(--text-primary)]">
                    {invitation.workspaceName}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    Invited as: <span className="font-mono text-[var(--text-primary)]">{invitation.email}</span>
                  </p>
                  {invitation.invitedBy && (
                    <p className="text-[11px] text-[var(--text-muted)]">
                      Sent by {invitation.invitedBy.name || invitation.invitedBy.email}
                    </p>
                  )}
                </div>

                {/* Not Authenticated State */}
                {!authed && (
                  <div className="space-y-3 pt-1">
                    <p className="text-xs text-[var(--text-secondary)] text-center">
                      Sign in or create an account with <span className="font-mono font-semibold">{invitation.email}</span> to accept this invitation.
                    </p>
                    <div className="flex flex-col gap-2">
                      <Link
                        href={`/?mode=login&returnTo=/invite/${encodeURIComponent(token)}`}
                        className="w-full"
                      >
                        <Button variant="primary" size="md" className="w-full">
                          Sign In to Accept
                        </Button>
                      </Link>
                      <Link
                        href={`/?mode=register&returnTo=/invite/${encodeURIComponent(token)}`}
                        className="w-full"
                      >
                        <Button variant="secondary" size="md" className="w-full">
                          Create Account
                        </Button>
                      </Link>
                    </div>
                  </div>
                )}

                {/* Authenticated State */}
                {authed && (
                  <div className="space-y-4 pt-1">
                    {isEmailMismatch ? (
                      <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 space-y-3">
                        <div className="flex items-start gap-2">
                          <svg className="h-5 w-5 shrink-0 text-amber-400 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                          </svg>
                          <div className="text-xs space-y-1">
                            <p className="font-semibold text-amber-200">Email Address Mismatch</p>
                            <p>
                              You are currently signed in as <span className="font-mono font-semibold">{currentUser?.email}</span>.
                            </p>
                            <p>
                              This invitation was issued exclusively to <span className="font-mono font-semibold">{invitation.email}</span>.
                            </p>
                          </div>
                        </div>

                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleSwitchAccount}
                          className="w-full text-xs"
                        >
                          Switch Account
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-xs text-[var(--text-secondary)] text-center">
                          Signed in as <span className="font-mono font-medium text-[var(--text-primary)]">{currentUser?.email}</span>
                        </p>
                        <Button
                          id="accept-invitation-button"
                          variant="primary"
                          size="md"
                          loading={isSubmitting}
                          onClick={handleAccept}
                          className="w-full"
                        >
                          Accept Invitation
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
