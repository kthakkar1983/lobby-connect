import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { shouldSendTyping } from "@lc/shared";
import type { VideoTrackHandle } from "../lib/video/types";
import { CallControls } from "./CallControls";
import { TypingIndicator } from "../components/TypingIndicator";

function useElapsed(): string {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

interface ChatLine {
  id: string;
  from: "guest" | "agent";
  text: string;
  ts: number;
}

export function Connected({
  remoteVideo, localVideo, muted, cameraOff, onMute, onCamera, onEnd,
  chatOpen, chatLines, peerTyping, onType, onSend, onTyping,
}: {
  remoteVideo: VideoTrackHandle | null;
  localVideo: VideoTrackHandle | null;
  muted: boolean;
  cameraOff: boolean;
  onMute: () => void;
  onCamera: () => void;
  onEnd: () => void;
  chatOpen: boolean;
  chatLines: ChatLine[];
  peerTyping: boolean;
  onType: () => void;
  onSend: (text: string) => void;
  onTyping: (state: "start" | "stop") => void;
}) {
  const remoteRef = useRef<HTMLDivElement>(null);
  const localRef = useRef<HTMLDivElement>(null);
  const elapsed = useElapsed();
  useEffect(() => { if (remoteVideo && remoteRef.current) remoteVideo.attach(remoteRef.current); }, [remoteVideo]);
  useEffect(() => { if (localVideo && localRef.current) localVideo.attach(localRef.current); }, [localVideo]);

  return (
    <div className="relative flex h-full overflow-hidden bg-call">
      {/* Video stage — ALWAYS the first child at this same tree position (never
          conditionally swapped out), so remoteRef/localRef stay attached to the
          same DOM nodes across the chatOpen toggle: only this wrapper's own
          size/position changes (full-bleed vs a 55% left column), never its
          identity, so the attach()'d <video> element is never torn down. */}
      <div className={chatOpen ? "relative h-full w-[55%] shrink-0 overflow-hidden" : "absolute inset-0"}>
        <div ref={remoteRef} className="absolute inset-0" />
        <div className="seam-ring lc-seam-drift pointer-events-none absolute inset-0 p-[2px]" aria-hidden />

        <div className="absolute left-4 top-4 flex items-center gap-2.5 rounded-pill border border-white/10 bg-call/60 py-1.5 pl-2.5 pr-3.5">
          <span className="lc-anim-pulse size-2.5 rounded-pill bg-live" aria-hidden />
          <span className="text-sm font-semibold leading-tight text-white">
            Connected
            <span className="block font-mono text-[10px] font-medium text-white/65">
              Front desk · {elapsed}
            </span>
          </span>
        </div>

        <div className="absolute right-5 top-5 z-10 h-[104px] w-[152px] overflow-hidden rounded-card border-2 border-white/45">
          <div ref={localRef} className="absolute inset-0" />
          <span className="absolute bottom-1.5 left-2 font-label text-[10px] font-semibold uppercase tracking-[0.12em] text-white/70">
            You
          </span>
        </div>

        <CallControls
          muted={muted}
          cameraOff={cameraOff}
          onMute={onMute}
          onCamera={onCamera}
          primary={{ label: "End", onClick: onEnd }}
          onType={onType}
        />
      </div>

      {chatOpen && (
        <ChatPanel lines={chatLines} peerTyping={peerTyping} onSend={onSend} onTyping={onTyping} />
      )}
    </div>
  );
}

/**
 * Option A side-by-side chat column (~45%, docked right of the ~55% video
 * stage). Chat consumes HORIZONTAL space while the on-screen keyboard
 * consumes VERTICAL space, so the two overlap in one corner instead of
 * stacking — that's why side-by-side survives the keyboard opening. Exact
 * split ratios are a live-eyeball item on the real iPad.
 *
 * Kiosk perspective: the LOCAL user here is the GUEST (the inverse of the
 * portal/agent side) — a "guest" line is this kiosk's own sent message
 * (right-aligned, teal); an "agent" line is received from the remote agent
 * (left-aligned, navy).
 */
function ChatPanel({
  lines, peerTyping, onSend, onTyping,
}: {
  lines: ChatLine[];
  peerTyping: boolean;
  onSend: (text: string) => void;
  onTyping: (state: "start" | "stop") => void;
}) {
  const [value, setValue] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);
  const lastTypingSentRef = useRef<number | null>(null);

  // Keep the thread pinned to the newest line/typing bubble.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, peerTyping]);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
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

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
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
    <div className="flex h-full min-w-0 flex-1 flex-col border-l border-border bg-card">
      <div ref={threadRef} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-4">
        {lines.map((line) => (
          <div
            key={line.id}
            className={
              line.from === "guest"
                ? "max-w-[85%] self-end break-words rounded-card bg-accent px-3.5 py-2.5 text-base text-accent-foreground"
                : "max-w-[85%] self-start break-words rounded-card bg-primary px-3.5 py-2.5 text-base text-primary-foreground"
            }
          >
            {line.text}
          </div>
        ))}
        {peerTyping && <TypingIndicator className="self-start" />}
      </div>
      <div className="shrink-0 border-t border-border p-4">
        <input
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={() => onTyping("stop")}
          placeholder="Type a message…"
          aria-label="Type a message"
          className="w-full rounded-input border border-border bg-background px-4 py-3 text-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Please don&apos;t type card numbers.
        </p>
      </div>
    </div>
  );
}
