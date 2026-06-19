"use client";

import { useActionState } from "react";
import { updatePasswordAction, type UpdatePasswordState } from "./actions";
import { PasswordInput } from "@/components/ui/password-input";

const initialState: UpdatePasswordState = { error: null };

export default function UpdatePasswordPage() {
  const [state, formAction, pending] = useActionState(
    updatePasswordAction,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">
          Set new password
        </h1>
        <p className="text-sm text-text-muted">
          Enter a new password for your account.
        </p>
      </header>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">New password</span>
        <PasswordInput
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
          className="h-auto rounded-md border-input bg-background px-3 py-2"
        />
        <p className="text-xs text-text-muted">Must be at least 8 characters.</p>
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">Confirm password</span>
        <PasswordInput
          name="confirm"
          autoComplete="new-password"
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
        className="rounded-md bg-live px-4 py-2 text-sm font-medium text-ink disabled:opacity-60"
      >
        {pending ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
