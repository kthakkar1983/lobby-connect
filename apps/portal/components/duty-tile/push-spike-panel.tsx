"use client";
// TEMPORARY — Gate 3.1 spike panel (lives on /duty-tile-prototype; removed
// with the prototype). Subscribe → schedule a server push → minimized-browser
// drill. The TAB plays the ring on the SW message; the toast is observed only.

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { createRingtone, type Ringtone } from "@/lib/video/ringtone";
import {
  ensurePushSubscription,
  pushSupported,
  type SubscriptionKeys,
} from "@/lib/push/sw-registration";

interface LogEntry {
  at: number;
  msg: string;
}

export function PushSpikePanel() {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionKeys | null>(null);
  const [ringing, setRinging] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ringtoneRef = useRef<Ringtone | null>(null);
  const pendingPushRef = useRef<{ sentAtMs: number; delaySeconds: number } | null>(null);

  const addLog = useCallback((msg: string) => {
    setLog((l) => [{ at: Date.now(), msg }, ...l].slice(0, 100));
  }, []);

  // SW messages: ring + measure. Listener attached for the page's lifetime.
  useEffect(() => {
    if (!pushSupported()) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as {
        source?: string;
        type?: string;
        scheduledFor?: number;
        receivedAt?: number;
      };
      if (data?.source !== "lc-push") return;
      const pending = pendingPushRef.current;
      // Client-clock latency: everything measured on THIS machine's clock —
      // (now - sentAt) minus the requested delay = delivery + request overhead.
      const clientLatencyMs = pending
        ? Math.max(0, Date.now() - (pending.sentAtMs + pending.delaySeconds * 1_000))
        : null;
      // Cross-clock number kept for reference only (server scheduledFor vs client
      // receivedAt) — meaningless if the OS clocks disagree, so labelled as such.
      const crossClockMs =
        data.receivedAt && data.scheduledFor ? data.receivedAt - data.scheduledFor : null;
      addLog(
        `PUSH received (tab ${document.visibilityState}) — latency ${
          clientLatencyMs === null ? "unknown" : `${(clientLatencyMs / 1000).toFixed(1)}s`
        } (client clock)${
          crossClockMs === null ? "" : ` · cross-clock ${(crossClockMs / 1000).toFixed(1)}s (assumes clocks agree)`
        }`,
      );
      setRinging(true);
      ringtoneRef.current?.start();
      setTimeout(() => {
        if (audioRef.current?.paused) {
          addLog("Ring audio is NOT playing (blocked?) — ring was visual-only");
        }
      }, 600);
      setTimeout(() => {
        ringtoneRef.current?.stop();
        setRinging(false);
      }, 20_000);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [addLog]);

  const subscribe = useCallback(async () => {
    // Prime the ringtone inside this click (Gate-3.0 pattern).
    if (!audioRef.current) {
      const audio = new Audio("/sounds/ring.mp3");
      audio.loop = true;
      audio.preload = "auto";
      audioRef.current = audio;
      ringtoneRef.current = createRingtone(audio);
    }
    const audio = audioRef.current;
    if (audio.paused) {
      void Promise.resolve(audio.play())
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
        })
        .catch(() => {});
    }
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!publicKey) {
      addLog("NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set in this env");
      return;
    }
    const sub = await ensurePushSubscription(publicKey);
    if (!sub) {
      addLog("Subscribe failed (permission denied or unsupported browser)");
      return;
    }
    setSubscription(sub);
    addLog(`Subscribed — audio primed. Endpoint …${sub.endpoint.slice(-16)}`);
  }, [addLog]);

  const schedule = useCallback(
    async (delaySeconds: number) => {
      if (!subscription) return;
      pendingPushRef.current = { sentAtMs: Date.now(), delaySeconds };
      addLog(`Push scheduled in ${delaySeconds}s — minimize the browser NOW, put RustDesk fullscreen`);
      const res = await fetch("/api/push-spike", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscription, delaySeconds }),
      }).catch(() => null);
      if (!res || !res.ok) addLog(`Schedule/send failed (${res ? res.status : "network"})`);
      else addLog("Server confirms the push was sent");
    },
    [addLog, subscription],
  );

  const copyReport = useCallback(async () => {
    const lines = [
      "Push-ring spike — Gate 3.1 report",
      `When: ${new Date().toString()}`,
      `Browser: ${navigator.userAgent}`,
      `Notification permission: ${typeof Notification !== "undefined" ? Notification.permission : "unsupported"}`,
      "",
      "Event log (oldest first):",
      ...[...log].reverse().map((e) => `${new Date(e.at).toLocaleTimeString()}  ${e.msg}`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      addLog("Report copied to clipboard");
    } catch {
      addLog("Clipboard blocked — screenshot this panel instead");
    }
  }, [addLog, log]);

  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-card p-5 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Gate 3.1 — push ring
      </h2>
      {!pushSupported() && (
        <p className="mt-2 text-sm text-attention-text">This browser does not support Web Push.</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={() => void subscribe()}>
          {subscription ? "Re-subscribe" : "Subscribe + prime audio"}
        </Button>
        {[15, 60, 360].map((s) => (
          <Button
            key={s}
            variant="neutral"
            disabled={!subscription}
            onClick={() => void schedule(s)}
          >
            Push in {s >= 60 ? `${s / 60}m` : `${s}s`}
          </Button>
        ))}
        <Button variant="neutral" onClick={() => void copyReport()}>
          Copy report
        </Button>
        {ringing && (
          <span className="rounded-pill bg-live/15 px-3 py-1 text-sm font-medium text-live-foreground">
            RINGING (push)
          </span>
        )}
      </div>
      <ol className="mt-4 max-h-56 space-y-1 overflow-y-auto font-mono text-xs text-muted-foreground">
        {log.map((e) => (
          <li key={`${e.at}-${e.msg}`}>
            {new Date(e.at).toLocaleTimeString()} {e.msg}
          </li>
        ))}
      </ol>
    </section>
  );
}
