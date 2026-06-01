"use client";

import { useAuth } from "@clerk/nextjs";
import { UserButton, SignInButton } from "@clerk/nextjs";

export function AuthNav() {
  const { isSignedIn, isLoaded } = useAuth();

  if (!isLoaded) return null;

  return (
    <div className="flex items-center gap-3">
      {isSignedIn ? (
        <>
          <span className="hidden text-xs text-claude-muted sm:block">Cloud mode active</span>
          <UserButton appearance={{ elements: { avatarBox: "h-8 w-8" } }} />
        </>
      ) : (
        <SignInButton mode="modal">
          <button className="rounded-lg border border-claude-border bg-claude-surface px-4 py-1.5 text-sm font-medium text-claude-text transition-colors hover:bg-claude-surface2">
            Sign in for cloud mode
          </button>
        </SignInButton>
      )}
    </div>
  );
}
