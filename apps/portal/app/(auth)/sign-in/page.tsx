"use client";

import { useActionState } from "react";
import { signInAction, type SignInState } from "./actions";
import { PasswordInput } from "@/components/ui/password-input";

const initialState: SignInState = { error: null };

export default function SignInPage() {
  const [state, formAction, pending] = useActionState(signInAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <header className="flex flex-col gap-1 text-center">
        <h1 className="font-display text-3xl font-semibold text-foreground">
          Welcome back
        </h1>
        <p className="text-sm text-text-muted">Sign in to your account.</p>
      </header>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          placeholder="you@example.com"
          className="rounded-md border border-input bg-background px-3 py-2 text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">Password</span>
        <PasswordInput
          name="password"
          autoComplete="current-password"
          required
          placeholder="Enter your password"
          className="h-auto rounded-md border-input bg-background px-3 py-2"
        />
      </label>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-live px-4 py-2 text-sm font-medium text-ink disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>

      <p className="text-center text-sm text-text-muted">
        Forgot your password? Contact your administrator.
      </p>
    </form>
  );
}
