"use client";

import { useActionState } from "react";
import { signInAction, type SignInState } from "./actions";
import { PasswordInput } from "@/components/ui/password-input";
import { Wordmark } from "@/components/brand/wordmark";

const initialState: SignInState = { error: null };

export default function SignInPage() {
  const [state, formAction, pending] = useActionState(signInAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <Wordmark className="mb-1" />
        <p className="text-sm text-text-muted">Sign in to your account.</p>
      </header>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="rounded-md border border-input bg-background px-3 py-2 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">Password</span>
        <PasswordInput
          name="password"
          autoComplete="current-password"
          required
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
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>

      <p className="text-center text-sm text-text-muted">
        Forgot your password? Contact your administrator.
      </p>
    </form>
  );
}
