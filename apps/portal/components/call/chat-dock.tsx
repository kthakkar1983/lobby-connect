"use client";

import { useEffect, useRef, useState } from "react";
import { shouldSendTyping } from "@lc/shared";
import { cn } from "@/lib/utils";
import { TypingIndicator } from "./typing-indicator";
import type { ChatLine } from "@/components/dashboard/call-surface-provider";

/**
 * Self-contained chat thread + input, reused by the call tile (Task 9) and
 * the in-call overlay (Task 10) — mirrors CaptionBand/CaptionToggle's
 * reuse-across-surfaces pattern. Purely presentational: the live-call owner
 * (video-call.tsx) holds the actual LiveKit publish/subscribe and PCI
 * redaction; ChatDock only renders `lines` and forwards raw text to
 * `onSend`. Typing pings are throttled internally (~1 per `TYPING_THROTTLE_MS`,
 * via the shared `shouldSendTyping` predicate) so every consumer gets the
 * same behavior for free.
 */
export function ChatDock({
  lines,
  peerTyping,
  onSend,
  onTyping,
  className,
}: {
  readonly lines: ChatLine[];
  readonly peerTyping: boolean;
  readonly onSend: (text: string) => void;
  readonly onTyping: (state: "start" | "stop") => void;
  readonly className?: string;
}) {
  const [value, setValue] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);
  const lastTypingSentRef = useRef<number | null>(null);

  // Keep the thread pinned to the newest line/typing bubble.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, peerTyping]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setValue(next);
    if (next === "") {
      lastTypingSentRef.current = null;
      onTyping("stop");
      return;
    }
    const now = Date.now();
    if (shouldSendTyping(lastTypingSentRef.current, now)) {
      lastTypingSentRef.current = now;
      onTyping("start");
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed === "") return;
    onSend(trimmed);
    setValue("");
    lastTypingSentRef.current = null;
    onTyping("stop");
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div ref={threadRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {lines.map((line) => (
          <div
            key={line.id}
            className={cn(
              "max-w-[80%] rounded-card px-3 py-2 text-sm break-words text-pretty",
              line.from === "agent"
                ? "self-end bg-accent text-accent-foreground"
                : "self-start bg-primary text-primary-foreground",
            )}
          >
            {line.text}
          </div>
        ))}
        {peerTyping && <TypingIndicator className="self-start" />}
      </div>
      <div className="border-t border-border bg-card p-3">
        <input
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={() => onTyping("stop")}
          placeholder="Type a message…"
          className="w-full rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
      </div>
    </div>
  );
}
