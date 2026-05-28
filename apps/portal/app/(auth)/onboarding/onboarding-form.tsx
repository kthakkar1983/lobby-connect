"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { onboardingAction, type OnboardingState } from "./actions";

const initialState: OnboardingState = { error: null };

export default function OnboardingForm({
  defaultName,
}: {
  readonly defaultName: string;
}) {
  const [state, formAction, pending] = useActionState(
    onboardingAction,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">
          Welcome to Lobby Connect
        </h1>
        <p className="text-sm text-text-muted">
          Set a password and confirm your name to finish creating your
          account.
        </p>
      </header>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="onboard-name">Full name</Label>
        <Input
          id="onboard-name"
          name="full_name"
          type="text"
          required
          defaultValue={defaultName}
          autoComplete="name"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="onboard-password">New password</Label>
        <Input
          id="onboard-password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="onboard-confirm">Confirm password</Label>
        <Input
          id="onboard-confirm"
          name="confirm"
          type="password"
          required
          autoComplete="new-password"
        />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Finish setup"}
      </Button>
    </form>
  );
}
