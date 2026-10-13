"use client";

import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";
import { useEffect, useRef } from "react";
import { AUTH_ENABLED } from "@/lib/auth-config";

/** Top-bar account control: "Sign in", or the avatar menu once signed in. */
export function AccountButton({ onChange }: { onChange: () => void }) {
  if (!AUTH_ENABLED) return null;
  return <AccountButtonInner onChange={onChange} />;
}

function AccountButtonInner({ onChange }: { onChange: () => void }) {
  const { isLoaded, isSignedIn } = useAuth();
  const previous = useRef<boolean | undefined>(undefined);

  // Refresh free checks and membership whenever someone signs in or out.
  useEffect(() => {
    if (!isLoaded) return;
    if (previous.current !== undefined && previous.current !== isSignedIn) onChange();
    previous.current = isSignedIn;
  }, [isLoaded, isSignedIn, onChange]);

  if (!isLoaded) return <span className="size-8" />;
  if (isSignedIn) return <UserButton />;
  return (
    <SignInButton mode="modal">
      <button className="rounded-full border border-border px-3 py-1.5 font-sans text-sm text-fg transition-colors hover:border-accent">
        Sign in
      </button>
    </SignInButton>
  );
}

/**
 * Shown when a check needs an account. Once the visitor signs in, the check they wanted runs
 * automatically.
 */
export function SignInGate({ freeChecks, onSignedIn }: { freeChecks: number; onSignedIn: () => void }) {
  const { isLoaded, isSignedIn } = useAuth();
  const done = useRef(false);

  useEffect(() => {
    if (isLoaded && isSignedIn && !done.current) {
      done.current = true;
      onSignedIn();
    }
  }, [isLoaded, isSignedIn, onSignedIn]);

  return (
    <section className="rise flex flex-col gap-4 rounded-2xl border border-accent/40 bg-accent/5 p-6">
      <p className="text-xs uppercase tracking-wide text-accent">Free account</p>
      <h2 className="text-2xl font-semibold tracking-tight">Sign in to check this transaction</h2>
      <p className="leading-relaxed text-muted">
        Every account gets {freeChecks} free checks. Signing in takes a few seconds with Google or your email.
        Shared links, wallet lists and the demos stay free without an account.
      </p>
      <SignInButton mode="modal">
        <button className="self-start rounded-full bg-accent px-6 py-3 font-medium text-white transition-transform hover:scale-105 active:scale-95">
          Sign in for {freeChecks} free checks
        </button>
      </SignInButton>
    </section>
  );
}
