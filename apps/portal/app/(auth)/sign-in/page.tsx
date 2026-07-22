"use client";

import { useActionState, useEffect, useState } from "react";
import { signInAction, type SignInState } from "./actions";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { cn } from "@/lib/utils";

const initialState: SignInState = { error: null };

export default function SignInPage() {
  const [state, formAction, pending] = useActionState(signInAction, initialState);
  const hasError = state.error != null;
  const [shaking, setShaking] = useState(false);

  // Replay the shake on every failed attempt. useActionState returns a fresh
  // state object per submit, so this fires even when the error text repeats;
  // the button is disabled while pending, so the animation always finishes
  // (and resets via onAnimationEnd) before the next attempt can land.
  useEffect(() => {
    if (state.error) setShaking(true);
  }, [state]);

  return (
    <form action={formAction} noValidate className="flex flex-col gap-5">
      <header className="flex flex-col gap-1 text-center">
        <h1 className="font-display text-3xl font-semibold text-foreground">
          Welcome back
        </h1>
        <p className="text-sm text-text-muted">Sign in to your account.</p>
      </header>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">Email</span>
        <div
          className={cn(shaking && "lc-shake")}
          onAnimationEnd={() => setShaking(false)}
        >
          <Input
            name="email"
            type="email"
            autoComplete="username"
            required
            aria-invalid={hasError || undefined}
            placeholder="you@example.com"
            className="h-auto rounded-md border-input bg-background px-3 py-2"
          />
        </div>
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">Password</span>
        <div
          className={cn(shaking && "lc-shake")}
          onAnimationEnd={() => setShaking(false)}
        >
          <PasswordInput
            name="password"
            autoComplete="current-password"
            required
            aria-invalid={hasError || undefined}
            placeholder="Enter your password"
            className="h-auto rounded-md border-input bg-background px-3 py-2"
          />
        </div>
      </label>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-live px-4 py-2 text-sm font-medium text-ink disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>

      <p className="text-center text-sm text-text-muted">
        Forgot your password? Contact your administrator.
      </p>
    </form>
  );
}
