"use client";

// Gate 3.0 — deskphone-tile prototype spike (stack-consolidation migration
// plan, Phase 3). Deliberately self-contained: no softphone/realtime/call
// integration. It exists to prove, on the agents' real machines:
//   1. an always-on-top Document-PiP tile opened by one "Go on duty" click
//      (which also primes ring audio) floats above fullscreen YouTube and a
//      fullscreen RustDesk session;
//   2. a ring landing while the tab is buried is loud + visible in the tile;
//   3. the open PiP window keeps the parent tab exempt from Chrome's timer
//      throttling (1s heartbeat, gaps displayed live in the tile);
//   4. the tile is resizable and stays legible.
// Pass → Phase 3 builds the real tile on this pattern. Fail → thin desktop
// shell escalation is decided before any Phase-3 build.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { createRingtone, type Ringtone } from "@/lib/video/ringtone";
import { useRingingTabTitle } from "@/lib/hooks/use-ringing-tab-title";
import { preparePipDocument } from "@/lib/duty-tile/pip-document";
import {
  classifyGap,
  formatGap,
  INITIAL_TICK_STATS,
  recordTick,
  type TickStats,
} from "@/lib/duty-tile/tick-stats";
import { TileWindow } from "@/components/duty-tile/tile-window";

const TICK_INTERVAL_MS = 1_000;
const RING_TIMEOUT_MS = 45_000;
const TILE_WIDTH = 380;
const TILE_HEIGHT = 460;

interface LogEntry {
  at: number;
  msg: string;
}

export function DutyTilePrototype({ agentName }: { agentName: string }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [tileBody, setTileBody] = useState<HTMLElement | null>(null);
  const [tileSize, setTileSize] = useState<{ w: number; h: number } | null>(null);
  const [stats, setStats] = useState<TickStats>(INITIAL_TICK_STATS);
  const [parentHidden, setParentHidden] = useState(false);
  const [pendingDueAt, setPendingDueAt] = useState<number | null>(null);
  const [ringing, setRinging] = useState<{ startedAt: number; lateMs: number } | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);

  const pipRef = useRef<Window | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ringtoneRef = useRef<Ringtone | null>(null);
  const ringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addLog = useCallback((msg: string) => {
    setLog((prev) => [{ at: Date.now(), msg }, ...prev].slice(0, 100));
  }, []);

  // Feature-detect after mount (SSR has no window).
  useEffect(() => {
    setSupported("documentPictureInPicture" in window);
  }, []);

  // The throttle probe: a 1s heartbeat that runs for the whole page life, so
  // Kumar can also observe the CONTRAST case (tile closed + tab hidden →
  // Chrome throttles → gaps grow; tile open → gaps stay ~1s).
  useEffect(() => {
    const id = setInterval(() => {
      setStats((s) => recordTick(s, Date.now()));
    }, TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Logged (not just displayed) so a pasted report proves the tab was hidden
  // when a ring fired — the remote tester can't be asked follow-ups mid-shift.
  useEffect(() => {
    const onVisibility = () => {
      const hidden = document.visibilityState === "hidden";
      setParentHidden(hidden);
      addLog(hidden ? "Tab hidden" : "Tab visible again");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [addLog]);

  // Flash the tab title while ringing (same affordance as real incoming calls).
  useRingingTabTitle(ringing !== null, "Incoming call · tile test");

  const clearRingTimers = useCallback(() => {
    if (ringTimerRef.current) {
      clearTimeout(ringTimerRef.current);
      ringTimerRef.current = null;
    }
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
  }, []);

  // Teardown on navigation away: silence audio, cancel timers, close the tile.
  useEffect(() => {
    return () => {
      ringtoneRef.current?.stop();
      clearRingTimers();
      pipRef.current?.close();
    };
  }, [clearRingTimers]);

  const stopRing = useCallback(
    (result: string) => {
      clearRingTimers();
      ringtoneRef.current?.stop();
      setRinging(null);
      setLastResult(result);
    },
    [clearRingTimers],
  );

  const fireRing = useCallback(
    (dueAt: number) => {
      const now = Date.now();
      const lateMs = Math.max(0, now - dueAt);
      setPendingDueAt(null);
      setRinging({ startedAt: now, lateMs });
      ringtoneRef.current?.start();
      addLog(
        `RING fired ${formatGap(lateMs)} after its scheduled time${lateMs < 1_500 ? " (on time)" : " (LATE — throttled?)"}`,
      );
      // createRingtone swallows play() rejections by design; for the gate we
      // want an audio failure in the report, not a silent visual-only ring.
      setTimeout(() => {
        if (ringTimeoutRef.current && audioRef.current?.paused) {
          addLog("Ring audio is NOT playing (blocked?) — ring was visual-only");
        }
      }, 600);
      ringTimeoutRef.current = setTimeout(() => {
        stopRing("missed (rang 45s unanswered)");
        addLog("Ring timed out after 45s — marked missed");
      }, RING_TIMEOUT_MS);
    },
    [addLog, stopRing],
  );

  const scheduleRing = useCallback(
    (seconds: number) => {
      clearRingTimers();
      ringtoneRef.current?.stop();
      setRinging(null);
      const dueAt = Date.now() + seconds * 1_000;
      setPendingDueAt(dueAt);
      addLog(`Ring scheduled in ${seconds}s — put something fullscreen on top now`);
      ringTimerRef.current = setTimeout(() => fireRing(dueAt), seconds * 1_000);
    },
    [addLog, clearRingTimers, fireRing],
  );

  const cancelPending = useCallback(() => {
    clearRingTimers();
    setPendingDueAt(null);
    addLog("Scheduled ring cancelled");
  }, [addLog, clearRingTimers]);

  const answerRing = useCallback(() => {
    if (!ringing) return;
    const waited = ((Date.now() - ringing.startedAt) / 1_000).toFixed(1);
    stopRing(`answered from the tile after ${waited}s`);
    addLog(`Answered from the tile after ${waited}s`);
  }, [addLog, ringing, stopRing]);

  const dismissRing = useCallback(() => {
    stopRing("dismissed from the tile");
    addLog("Dismissed from the tile");
  }, [addLog, stopRing]);

  const goOnDuty = useCallback(async () => {
    const docPip = window.documentPictureInPicture;
    if (!docPip) return;

    // Prime the ringtone inside this click's user activation (the session-22
    // pattern: play+pause now unlocks programmatic play() later, even with the
    // tab buried behind a fullscreen app).
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

    try {
      const pip = await docPip.requestWindow({ width: TILE_WIDTH, height: TILE_HEIGHT });
      pipRef.current = pip;
      const mount = preparePipDocument(pip.document);
      setTileBody(mount);
      setTileSize({ w: pip.innerWidth, h: pip.innerHeight });
      pip.addEventListener("resize", () => {
        setTileSize({ w: pip.innerWidth, h: pip.innerHeight });
      });
      pip.addEventListener("pagehide", () => {
        pipRef.current = null;
        setTileBody(null);
        addLog("Tile closed");
      });
      addLog(`On duty — tile opened at ${pip.innerWidth}×${pip.innerHeight}, audio primed`);
    } catch (err) {
      addLog(`Could not open the tile: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [addLog]);

  const goOffDuty = useCallback(() => {
    clearRingTimers();
    ringtoneRef.current?.stop();
    setPendingDueAt(null);
    setRinging(null);
    addLog("Went off duty");
    pipRef.current?.close(); // its pagehide handler clears tile state
  }, [addLog, clearRingTimers]);

  const resetStats = useCallback(() => {
    setStats(INITIAL_TICK_STATS);
    addLog("Tick stats reset");
  }, [addLog]);

  const copyReport = useCallback(async () => {
    const lines = [
      "Deskphone tile prototype — Gate 3.0 report",
      `When: ${new Date().toString()}`,
      `Tester: ${agentName}`,
      `Browser: ${navigator.userAgent}`,
      `Tab ticks: ${stats.count} · last gap ${formatGap(stats.lastGapMs)} · max gap ${formatGap(stats.maxGapMs)} (${classifyGap(stats.maxGapMs).toUpperCase()})`,
      `Tile: ${tileBody ? `open at ${tileSize?.w}×${tileSize?.h}` : "closed"}`,
      "",
      "Event log (oldest first):",
      ...[...log]
        .reverse()
        .map((e) => `${new Date(e.at).toLocaleTimeString()}  ${e.msg}`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      addLog("Report copied to clipboard — paste it back to Kumar/Claude");
    } catch {
      addLog("Clipboard blocked — screenshot this page instead");
    }
  }, [addLog, agentName, log, stats, tileBody, tileSize]);

  const onDuty = tileBody !== null;
  const gapClass = classifyGap(stats.maxGapMs);

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-foreground">
          Deskphone tile — Gate 3.0 prototype
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Proves the always-on-top tile before Phase 3 is built. Chrome or Edge on a desktop —
          your real work machine, not a phone.
        </p>
      </header>

      {supported === false ? (
        <div className="rounded-lg border border-attention bg-attention/10 p-4 text-sm text-attention-text">
          This browser does not support Document Picture-in-Picture. Use Chrome or Edge
          (version 116 or newer) on a desktop.
        </div>
      ) : null}

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-label text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
          What to test
        </h2>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-foreground">
          <li>
            Click <strong>Go on duty</strong> — the tile opens and ring audio is primed.
          </li>
          <li>
            In the tile, tap <strong>Test ring → 60s</strong>, then play a YouTube video
            fullscreen. The tile must stay on top, and the ring must be loud and visible.
            Answer from the tile.
          </li>
          <li>Repeat with a fullscreen RustDesk session instead of YouTube.</li>
          <li>
            Use <strong>6 min</strong> once, with this tab hidden the whole time — that covers
            Chrome&apos;s deeper &quot;intensive throttling&quot; window. The max-gap pill in the
            tile must stay OK (~1s).
          </li>
          <li>Drag the tile&apos;s corners — smaller and larger. It should stay usable.</li>
          <li>
            Click <strong>Copy report</strong> and paste the result back.
          </li>
        </ol>
      </section>

      <section className="flex flex-wrap items-center gap-2">
        {!onDuty ? (
          <Button onClick={goOnDuty} disabled={supported !== true}>
            Go on duty
          </Button>
        ) : (
          <>
            <span className="text-sm text-text-muted">Ring the tile in:</span>
            {[
              { label: "15s", seconds: 15 },
              { label: "60s", seconds: 60 },
              { label: "6 min", seconds: 360 },
            ].map((o) => (
              <Button
                key={o.seconds}
                variant="outline"
                size="sm"
                onClick={() => scheduleRing(o.seconds)}
              >
                {o.label}
              </Button>
            ))}
            <Button variant="neutral" size="sm" onClick={goOffDuty}>
              Go off duty
            </Button>
          </>
        )}
        <Button variant="ghost" size="sm" onClick={resetStats}>
          Reset stats
        </Button>
        <Button variant="ghost" size="sm" onClick={copyReport}>
          Copy report
        </Button>
      </section>

      <section className="rounded-lg border border-border bg-card p-4 text-sm">
        <h2 className="font-label text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
          Live status
        </h2>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-text-muted">Tile</dt>
            <dd className="font-medium">
              {onDuty ? `open ${tileSize ? `· ${tileSize.w}×${tileSize.h}` : ""}` : "closed"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Tab ticks</dt>
            <dd className="font-medium tabular-nums">{stats.count}</dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Last / max gap</dt>
            <dd className="font-medium tabular-nums">
              {formatGap(stats.lastGapMs)} / {formatGap(stats.maxGapMs)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Throttling</dt>
            <dd
              className={`font-semibold uppercase ${
                gapClass === "ok"
                  ? "text-live-foreground"
                  : gapClass === "degraded"
                    ? "text-attention-text"
                    : "text-destructive"
              }`}
            >
              {gapClass}
            </dd>
          </div>
        </dl>
        {lastResult ? (
          <p className="mt-2 text-xs text-text-muted">Last ring: {lastResult}</p>
        ) : null}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-label text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
          Event log
        </h2>
        {log.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">Nothing yet — go on duty to start.</p>
        ) : (
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto font-mono text-xs text-foreground">
            {log.map((e) => (
              <li key={`${e.at}-${e.msg}`}>
                <span className="text-text-muted">
                  {new Date(e.at).toLocaleTimeString()}
                </span>{" "}
                {e.msg}
              </li>
            ))}
          </ul>
        )}
      </section>

      {tileBody
        ? createPortal(
            <TileWindow
              agentName={agentName}
              stats={stats}
              parentHidden={parentHidden}
              pendingDueAt={pendingDueAt}
              ringing={ringing}
              lastResult={lastResult}
              tileSize={tileSize}
              onScheduleRing={scheduleRing}
              onCancelPending={cancelPending}
              onAnswer={answerRing}
              onDismiss={dismissRing}
              onOffDuty={goOffDuty}
            />,
            tileBody,
          )
        : null}
    </main>
  );
}
