"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { upsertRemoteAccessAction, deleteRemoteAccessAction } from "../actions";
import { SectionCard } from "@/components/owner/section-card";

type Props = {
  propertyId: string;
  peerId: string | null;
  hasCredentials: boolean;
  lastIssuedAt: string | null;
};

export function RemoteAccessCard({
  propertyId,
  peerId,
  hasCredentials,
  lastIssuedAt,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [peerIdInput, setPeerIdInput] = useState(peerId ?? "");
  const [password, setPassword] = useState("");

  function onSave() {
    setError(null);
    startTransition(async () => {
      const result = await upsertRemoteAccessAction(
        propertyId,
        peerIdInput,
        password,
      );
      if (result.ok) {
        toast.success("Remote-access credentials saved");
        setPassword("");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function onRemove() {
    setError(null);
    startTransition(async () => {
      const result = await deleteRemoteAccessAction(propertyId);
      if (result.ok) {
        toast.success("Remote-access credentials removed");
        setPeerIdInput("");
        setPassword("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <SectionCard
      title="Remote access"
      action={
        hasCredentials ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="ghost" size="sm" disabled={pending}>
                Remove
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove remote-access credentials?</AlertDialogTitle>
                <AlertDialogDescription>
                  Agents won&apos;t be able to Connect to this property&apos;s
                  hotel PC until new credentials are saved.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onRemove} disabled={pending}>
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs text-text-muted">
          RustDesk unattended-access credentials for this property&apos;s
          hotel PC. Stored for the Connect deep link on the agent dashboard —
          never shown to agents directly.
        </p>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="peer-id">RustDesk ID</Label>
          <Input
            id="peer-id"
            value={peerIdInput}
            onChange={(e) => setPeerIdInput(e.target.value)}
            placeholder="e.g. 123456789"
            className="font-mono"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="unattended-password">Unattended password</Label>
          <PasswordInput
            id="unattended-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={hasCredentials ? "•••• saved" : ""}
          />
          {hasCredentials ? (
            <p className="text-xs text-text-muted">
              •••• saved. Leave blank to keep the current password, or enter a
              new one and Save to rotate it.
            </p>
          ) : null}
        </div>

        <p className="text-xs text-text-muted">
          Credentials last issued:{" "}
          {lastIssuedAt
            ? new Date(lastIssuedAt).toLocaleString()
            : "Never issued"}
        </p>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <Button
            type="button"
            onClick={onSave}
            disabled={pending || !peerIdInput.trim() || (!hasCredentials && !password)}
          >
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}
