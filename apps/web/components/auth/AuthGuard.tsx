"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated, getWorkspaceId } from "@/lib/auth";
import { Spinner } from "@/components/ui/Spinner";

interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * Client-side auth guard.
 * Redirects to / if there is no access token in localStorage.
 * Also redirects to / if workspaceId is missing (account incomplete).
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!isAuthenticated() || !getWorkspaceId()) {
      router.replace("/");
    } else {
      setChecked(true);
    }
  }, [router]);

  if (!checked) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner size="lg" label="Loading workspace..." />
      </div>
    );
  }

  return <>{children}</>;
}
