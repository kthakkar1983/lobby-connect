"use client";

import { Mic, MicOff, Phone, PhoneOff, AlertTriangle } from "lucide-react";
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
import { PlaybookPanel } from "@/components/call/playbook-panel";

export function AudioCallOverlay({
  propertyName,
  callId,
  muted,
  roomNumber,
  notes,
  emergencyActive,
  emergencyFailed,
  onToggleMute,
  onHangUp,
  onTriggerEmergency,
  onRoomNumberChange,
  onNotesChange,
}: {
  readonly propertyName: string;
  readonly callId: string;
  readonly muted: boolean;
  readonly roomNumber: string;
  readonly notes: string;
  readonly emergencyActive: boolean;
  readonly emergencyFailed: boolean;
  readonly onToggleMute: () => void;
  readonly onHangUp: () => void;
  readonly onTriggerEmergency: () => void;
  readonly onRoomNumberChange: (value: string) => void;
  readonly onNotesChange: (value: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header strip — mirrors the video overlay's "On video · …". */}
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span className="inline-block h-2 w-2 rounded-full bg-live shadow-[0_0_0_3px_var(--color-live-glow)]" />
          On call · {propertyName}
        </span>
      </div>

      {/* Emergency banner — full-width, life-safety prominence. */}
      {emergencyActive && !emergencyFailed && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          Emergency active — 911 is being conferenced in. Stay on the line and relay the property
          address and room number.
        </div>
      )}
      {emergencyFailed && (
        <div className="border-b border-destructive bg-destructive/15 px-4 py-2 text-sm font-medium text-destructive">
          911 dispatch failed. Relay the property address and room number verbally, and have the guest
          hang up and dial 911 directly.
        </div>
      )}

      {/* Body — ~25% call-info rail (deep-navy --color-call) / ~75% playbook. */}
      <div className="flex flex-1 overflow-hidden">
        <div className="relative flex basis-1/4 flex-col items-center justify-center gap-3 bg-[var(--color-call)] p-6 text-center text-white">
          <span
            aria-hidden="true"
            className="lc-seam-drift absolute h-20 w-20 rounded-full opacity-40 blur-md"
          />
          <span className="relative grid size-14 place-items-center rounded-full border-2 border-white/20 bg-white/5">
            <Phone size={22} />
          </span>
          <p className="relative text-lg font-medium">{propertyName}</p>
          <p className="relative text-sm text-white/70">On call</p>
        </div>
        <PlaybookPanel callId={callId} basis="basis-3/4" />
      </div>

      {/* Control bar — mirrors the video overlay's bottom bar. */}
      <div className="flex items-center gap-2 border-t border-border bg-card p-3">
        <input
          value={roomNumber}
          onChange={(e) => onRoomNumberChange(e.target.value)}
          placeholder="Room #"
          className="w-24 rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
        <input
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Call notes"
          className="flex-1 rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
        <button
          type="button"
          onClick={onToggleMute}
          className="flex items-center gap-1 rounded-button border border-border px-3 py-2 text-sm text-foreground"
        >
          {muted ? <MicOff size={16} /> : <Mic size={16} />}
          {muted ? "Unmute" : "Mute"}
        </button>
        <button
          type="button"
          onClick={onHangUp}
          className="flex items-center gap-1.5 rounded-button bg-accent-strong px-3 py-2 text-[1.1875rem] font-bold leading-none text-accent-foreground"
        >
          <PhoneOff size={18} /> Hang up
        </button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              type="button"
              disabled={emergencyActive}
              className="flex items-center gap-2 rounded-button bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50"
            >
              <AlertTriangle size={16} /> {emergencyActive ? "911 active" : "Call 911 — emergency"}
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Call emergency services (911)?</AlertDialogTitle>
              <AlertDialogDescription>
                This conferences 911 into the live call — the guest, you, and the dispatcher on one line — and logs a high-priority incident.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="rounded-input border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Not life-threatening? Cancel and use the property&apos;s local non-emergency number instead. Only continue for a genuine emergency.
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={onTriggerEmergency}
                className="bg-destructive text-destructive-foreground"
              >
                Yes — call 911
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
