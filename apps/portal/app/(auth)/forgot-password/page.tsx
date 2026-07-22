"use client";

import { useActionState } from "react";
import { forgotPasswordAction, type ForgotPasswordState } from "./actions";

const initialState: ForgotPasswordState = { error: null, success: false };

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(
    forgotPasswordAction,
    initialState,
  );

  if (state.success) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold text-foreground">
          Check your inbox
        </h1>
        <p className="text-sm text-text-muted">
          If that email is registered, you&apos;ll receive a reset link
          shortly.
        </p>
        <a href="/sign-in" className="text-sm text-primary hover:underline">
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">
          Reset password
        </h1>
        <p className="text-sm text-text-muted">
          Enter your email and we&apos;ll send a reset link.
        </p>
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
        {pending ? "Sending…" : "Send reset link"}
      </button>

      <a
        href="/sign-in"
        className="text-center text-sm text-text-muted hover:text-foreground"
      >
        Back to sign in
      </a>
    </form>
  );
}
