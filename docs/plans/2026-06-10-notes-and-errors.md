# Notes Durability + Error Surfacing + Owner Calls Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the agent call-notes save reliable (retry + visible failure with the text preserved), make the other swallowed call-surface writes observable, and rework the owner Calls tab (note icon + inline accordion expand + Audio/Video filter).

**Architecture:** A tiny `reliableFetch` util (retry on network/5xx, Sentry on exhaustion) becomes the shared write primitive on the agent surfaces. The notes save is decoupled from call phase so a failure surfaces in a phase-independent banner without losing the typed text. On the owner side, a shared `CallDetailBody` is rendered both by the kept (deep-linked) detail page and by a now-expandable `CallRow`; the list query is enriched so expansion needs no extra round-trip; a `?channel=` filter mirrors the existing `?property=` pattern.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Supabase JS, `@sentry/nextjs`, Vitest (node lane + jsdom/Testing-Library lane), `@lc/shared` types, lucide-react, Tailwind v4 brand tokens.

**Spec:** `docs/specs/2026-06-10-notes-and-errors-design.md`

**Conventions for every task below:**
- All commands run from the portal package: prefix with `cd apps/portal`.
- Node-lane single test: `pnpm exec vitest run <path>`. jsdom-lane: `pnpm exec vitest run --config vitest.jsdom.config.ts <path>`.
- Full gate (run before each commit that changes code): `pnpm test && pnpm lint && pnpm typecheck`.
- Commit messages: conventional style, no emojis, trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Never hardcode hex — Tailwind brand tokens only (`destructive`, `text-muted`, `border`, etc.).

---

## Task 1: `reliableFetch` helper (TDD)

**Files:**
- Create: `apps/portal/lib/http/reliable-fetch.ts`
- Test: `apps/portal/tests/http/reliable-fetch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/http/reliable-fetch.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const captureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureException }));

import { reliableFetch } from "@/lib/http/reliable-fetch";

const noBackoff = () => 0;

describe("reliableFetch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the response on a first-try success and does not report", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);

    const res = await reliableFetch("/x", undefined, { label: "t", backoffMs: noBackoff });

    expect(res?.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captureException).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("retries on 5xx then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);

    const res = await reliableFetch("/x", undefined, { label: "t", backoffMs: noBackoff });

    expect(res?.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(captureException).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("does NOT retry a 4xx and returns it without reporting", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal("fetch", fetchMock);

    const res = await reliableFetch("/x", undefined, { label: "t", retries: 2, backoffMs: noBackoff });

    expect(res?.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captureException).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("exhausts retries on a thrown error, returns null, reports once", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await reliableFetch("/x", undefined, { label: "calls.notes", retries: 2, backoffMs: noBackoff });

    expect(res).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 + 2 retries
    expect(captureException).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("reports once when a 5xx persists through all retries", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);

    const res = await reliableFetch("/x", undefined, { label: "t", retries: 1, backoffMs: noBackoff });

    expect(res?.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(captureException).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("returns a response with no numeric status as-is (only 5xx is retryable)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true }); // no .status field
    vi.stubGlobal("fetch", fetchMock);

    const res = await reliableFetch("/x", undefined, { label: "t", backoffMs: noBackoff });

    expect(res?.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captureException).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/portal && pnpm exec vitest run tests/http/reliable-fetch.test.ts`
Expected: FAIL — cannot resolve `@/lib/http/reliable-fetch`.

- [ ] **Step 3: Implement the helper**

Create `apps/portal/lib/http/reliable-fetch.ts`:

```ts
import * as Sentry from "@sentry/nextjs";

type ReliableOpts = {
  /** A short, stable label for Sentry grouping, e.g. "calls.notes". */
  label: string;
  /** Additional attempts after the first. Default 2 (≤3 total). */
  retries?: number;
  /** Backoff before retry N (0-indexed). Default 300ms · 2^N. Injectable for tests. */
  backoffMs?: (attempt: number) => number;
};

const delay = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/**
 * A fetch that retries transient failures (thrown / 5xx) and reports to Sentry
 * when it ultimately fails. Returns the Response for any received response
 * (including 4xx, which is NOT retried), or null when every attempt threw.
 * Callers treat `null || !res.ok` as failure.
 */
export async function reliableFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  opts: ReliableOpts,
): Promise<Response | null> {
  const retries = opts.retries ?? 2;
  const backoff = opts.backoffMs ?? ((n: number) => 300 * 2 ** n);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(input, init);
      // Only a 5xx is retryable; success / 4xx / unknown-status return as-is.
      if (!(res.status >= 500)) return res;
      if (attempt === retries) {
        Sentry.captureException(new Error(`reliableFetch ${opts.label} ${res.status}`), {
          extra: { label: opts.label, status: res.status },
        });
        return res;
      }
    } catch (err) {
      if (attempt === retries) {
        Sentry.captureException(err, { extra: { label: opts.label } });
        return null;
      }
    }
    await delay(backoff(attempt));
  }
  return null; // unreachable; satisfies the type checker
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/portal && pnpm exec vitest run tests/http/reliable-fetch.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/http/reliable-fetch.ts apps/portal/tests/http/reliable-fetch.test.ts
git commit -m "feat(http): reliableFetch retry+Sentry helper" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Softphone — notes save through the helper + unsaved-notes banner

**Files:**
- Modify: `apps/portal/components/softphone/softphone.tsx`
- Test: `apps/portal/tests/components/softphone.test.tsx`

- [ ] **Step 1: Add imports**

At the top of `softphone.tsx`, add to the existing imports:

```tsx
import * as Sentry from "@sentry/nextjs";
import { reliableFetch } from "@/lib/http/reliable-fetch";
```

- [ ] **Step 2: Add notes-save state + a stable `saveNotes`**

After the existing `notesRef` mirror block (around line 76, after `notesRef.current = notes;`), add:

```tsx
  // Notes save is decoupled from call phase: a failure surfaces in a banner that
  // outlives the call so the typed text is never silently lost.
  const [notesSave, setNotesSave] = useState<"idle" | "saving" | "failed">("idle");
  const [pendingNotes, setPendingNotes] = useState<
    { callId: string; roomNumber: string; notes: string } | null
  >(null);

  const saveNotes = useCallback(
    async (payload: { callId: string; roomNumber: string; notes: string }) => {
      setNotesSave("saving");
      const res = await reliableFetch(
        "/api/calls/notes",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
        { label: "calls.notes" },
      );
      if (res && res.ok) {
        setNotesSave("idle");
        setPendingNotes(null);
      } else {
        setNotesSave("failed");
        setPendingNotes(payload);
      }
    },
    [],
  );
```

- [ ] **Step 3: Rewire `acceptCall`, `endCall`, `triggerEmergency`**

In `acceptCall`, replace the answered fetch:

```tsx
    await fetch("/api/twilio/voice/answered", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callId: callIdRef.current }),
    }).catch(() => {});
```

with:

```tsx
    await reliableFetch(
      "/api/twilio/voice/answered",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ callId: callIdRef.current }),
      },
      { label: "calls.answered" },
    );
```

Replace the whole `endCall` body (keep its `useCallback`, change deps to `[saveNotes]`):

```tsx
  const endCall = useCallback(async () => {
    const id = callIdRef.current;
    if (emergencyActiveRef.current && id) {
      // SDK can't disconnect the redirected leg — remove the agent from the
      // conference server-side. Guest + 911 continue (endConferenceOnExit=false).
      await reliableFetch(
        `/api/calls/${id}/emergency/control`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "leave" }),
        },
        { label: "emergency.control" },
      );
    }
    try {
      callRef.current?.disconnect();
    } catch {
      // ignore
    }
    callRef.current = null;
    // Capture typed values before clearing, then reset the call UI immediately
    // (the call is over). The save runs in the background; a failure shows a
    // phase-independent banner without blocking a new incoming call.
    const room = roomNumberRef.current;
    const note = notesRef.current;
    setRoomNumber("");
    setNotes("");
    setMuted(false);
    setEmergencyActive(false);
    setEmergencyFailed(false);
    setPhase("ready");
    await postPresence(readyRef.current ? "AVAILABLE" : "AWAY");
    if (id && (room || note)) {
      void saveNotes({ callId: id, roomNumber: room, notes: note });
    }
  }, [saveNotes]);
```

In `triggerEmergency`, add a Sentry report to both failure branches. Replace:

```tsx
        setEmergencyActive(Boolean(body.agentRedirected));
        setEmergencyFailed(true);
        console.error("[softphone] emergency trigger failed:", res.status);
```

with:

```tsx
        setEmergencyActive(Boolean(body.agentRedirected));
        setEmergencyFailed(true);
        console.error("[softphone] emergency trigger failed:", res.status);
        Sentry.captureException(new Error(`emergency.trigger ${res.status}`), {
          extra: { label: "emergency.trigger", status: res.status },
        });
```

and replace:

```tsx
    } catch (err) {
      // Unknown server state — keep controls server-side (safer) and warn.
      setEmergencyFailed(true);
      console.error("[softphone] emergency trigger error:", err);
    }
```

with:

```tsx
    } catch (err) {
      // Unknown server state — keep controls server-side (safer) and warn.
      setEmergencyFailed(true);
      console.error("[softphone] emergency trigger error:", err);
      Sentry.captureException(err, { extra: { label: "emergency.trigger" } });
    }
```

Leave `toggleMute`'s `emergency/control` fetch and `postPresence` as raw `fetch`/best-effort
(`postPresence` is an intentionally fire-and-forget heartbeat — a missed tick self-heals in 20s).

- [ ] **Step 4: Render the unsaved-notes banner**

Inside the root `<div className="rounded-lg border …">`, immediately after the header row
(`<div className="flex items-center justify-between">…</div>`), add:

```tsx
      {pendingNotes && (
        <div className="mt-3 rounded-input border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <p className="font-medium">Couldn&apos;t save notes from the last call.</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={notesSave === "saving"}
              onClick={() => void saveNotes(pendingNotes)}
              className="rounded-button bg-destructive px-3 py-1 font-medium text-destructive-foreground disabled:opacity-50"
            >
              {notesSave === "saving" ? "Saving…" : "Retry"}
            </button>
            <button
              type="button"
              disabled={notesSave === "saving"}
              onClick={() => {
                setPendingNotes(null);
                setNotesSave("idle");
              }}
              className="rounded-button border border-border px-3 py-1 text-foreground disabled:opacity-50"
            >
              Discard
            </button>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Add the failure-banner regression test**

In `apps/portal/tests/components/softphone.test.tsx`, add a Sentry mock next to the existing
`vi.mock` calls (so the real helper's import is inert):

```tsx
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
```

Then add a second test inside the `describe` block:

```tsx
  it("shows a preserved-text banner when the notes save fails, and Retry re-POSTs", async () => {
    const user = userEvent.setup();
    // Notes endpoint always 500s; everything else ok.
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/twilio/token") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ token: "t" }) });
      }
      if (url === "/api/calls/notes") return Promise.resolve({ ok: false, status: 500 });
      return Promise.resolve({ ok: true, status: 200 });
    });

    render(<Softphone role="AGENT" />);
    await waitFor(() => screen.getByText(/Ready — accepting calls/i));
    await act(async () => twilio.fireIncoming());
    await user.click(screen.getByText("Accept"));
    await user.type(screen.getByPlaceholderText("Room #"), "507");
    await user.type(screen.getByPlaceholderText("Call notes"), "VIP guest");
    await act(async () => twilio.fireDisconnect());

    // Banner appears after retries are exhausted (real backoff ~0.9s).
    await waitFor(
      () => expect(screen.getByText(/Couldn.t save notes/i)).toBeInTheDocument(),
      { timeout: 4000 },
    );

    // Let the notes endpoint succeed, click Retry, banner clears.
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve({ ok: true, status: url === "/api/calls/notes" ? 204 : 200 }),
    );
    await user.click(screen.getByText("Retry"));
    await waitFor(() => expect(screen.queryByText(/Couldn.t save notes/i)).toBeNull());
  });
```

- [ ] **Step 6: Run the component tests**

Run: `cd apps/portal && pnpm exec vitest run --config vitest.jsdom.config.ts tests/components/softphone.test.tsx`
Expected: PASS (the original H1 test + the new failure-banner test).

- [ ] **Step 7: Full gate + commit**

Run: `cd apps/portal && pnpm test && pnpm lint && pnpm typecheck`
Expected: all green.

```bash
git add apps/portal/components/softphone/softphone.tsx apps/portal/tests/components/softphone.test.tsx
git commit -m "feat(softphone): reliable notes save + preserved-text failure banner" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Video-call — reliable notes save + keep-overlay-on-failure

**Files:**
- Modify: `apps/portal/components/video-call/video-call.tsx`

- [ ] **Step 1: Add imports + state**

Add the import:

```tsx
import { reliableFetch } from "@/lib/http/reliable-fetch";
```

Add state next to the existing `useState` calls (after `const [notes, setNotes] = useState("");`):

```tsx
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
```

- [ ] **Step 2: Add a `saveNotes` helper + rewrite `handleEnd`**

Replace the entire `handleEnd` function:

```tsx
  async function saveNotes(): Promise<boolean> {
    if (!roomNumberRef.current && !notesRef.current) return true; // nothing to save
    setSaving(true);
    const res = await reliableFetch(
      "/api/calls/notes",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          callId,
          roomNumber: roomNumberRef.current,
          notes: notesRef.current,
        }),
      },
      { label: "calls.notes" },
    );
    setSaving(false);
    const ok = !!res && res.ok;
    setSaveFailed(!ok);
    return ok;
  }

  async function handleEnd() {
    // Idempotent: user-left (guest hung up / crashed) and the End button can both
    // reach here. Tear down video + finalize the row exactly once; the call is over
    // regardless. Then persist notes — and if that fails, keep the overlay mounted
    // (in a "call ended — notes unsaved" state) so the typed text isn't lost.
    if (!finalizingRef.current) {
      finalizingRef.current = true;
      await reliableFetch(
        `/api/calls/${callId}/end-video`,
        { method: "POST" },
        { label: "calls.end_video" },
      );
      audioRef.current?.close();
      videoRef.current?.close();
      await clientRef.current?.leave().catch(() => {});
    }
    const ok = await saveNotes();
    if (ok) onClose();
  }
```

> Note: `finalizingRef` now guards only the one-time teardown; `saveNotes`/`handleEnd` can run
> again via Retry without re-tearing-down.

- [ ] **Step 3: Add the failure banner to the control bar**

Immediately **before** the control-bar `<div className="flex items-center gap-2 border-t …">`,
add:

```tsx
      {saveFailed && (
        <div className="flex items-center justify-between gap-3 border-t border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <span>Couldn&apos;t save notes. They&apos;re still here — retry or discard.</span>
          <span className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleEnd()}
              className="rounded-button bg-destructive px-3 py-1 font-medium text-destructive-foreground disabled:opacity-50"
            >
              {saving ? "Saving…" : "Retry"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="rounded-button border border-border px-3 py-1 disabled:opacity-50"
            >
              Discard
            </button>
          </span>
        </div>
      )}
```

(The note `<input>`s in the control bar stay editable, so the agent can fix and Retry.)

- [ ] **Step 4: Gate + commit**

Run: `cd apps/portal && pnpm test && pnpm lint && pnpm typecheck`
Expected: all green (no new test; existing video-call H1 test still passes — it asserts the notes
POST fires on `user-left`, which still happens).

```bash
git add apps/portal/components/video-call/video-call.tsx
git commit -m "feat(video-call): reliable notes save, keep overlay on save failure" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Extract `CallDetailBody` and point the detail page at it (no behavior change)

**Files:**
- Create: `apps/portal/components/owner/call-detail-body.tsx`
- Modify: `apps/portal/app/(owner)/owner/calls/[id]/page.tsx`

- [ ] **Step 1: Create the shared body component**

Create `apps/portal/components/owner/call-detail-body.tsx`:

```tsx
import Link from "next/link";
import { Siren } from "lucide-react";
import type { CallState } from "@lc/shared";
import { SectionCard } from "@/components/owner/section-card";
import { formatCallTime, formatDuration } from "@/lib/owner/format";

export type CallDetail = {
  readonly id: string;
  readonly channel: string; // "AUDIO" | "VIDEO"
  readonly state: CallState;
  readonly caller_number: string | null;
  readonly room_number: string | null;
  readonly ring_started_at: string;
  readonly duration_seconds: number | null;
  readonly notes: string | null;
  readonly recording_url: string | null;
  readonly propertyName: string;
  readonly timeZone: string;
  readonly handlerName: string; // resolved name, or "Unanswered" / "—"
  readonly incidentId: string | null;
};

function Field({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-label text-[10px] uppercase tracking-[0.06em] text-text-muted">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

export function CallDetailBody({ data }: { readonly data: CallDetail }) {
  return (
    <div className="flex flex-col gap-4">
      {data.incidentId && (
        <Link
          href={`/owner/incidents/${data.incidentId}` as never}
          className="flex items-center gap-2 rounded-card border border-destructive/40 bg-destructive/5 p-4 text-sm font-medium text-destructive hover:bg-destructive/10"
        >
          <Siren className="size-4" aria-hidden="true" /> Emergency — view incident
        </Link>
      )}

      <SectionCard title="Call">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Property" value={data.propertyName} />
          <Field label="Handled by" value={data.handlerName} />
          <Field label="Started" value={formatCallTime(data.ring_started_at, data.timeZone)} />
          <Field label="Duration" value={formatDuration(data.duration_seconds)} />
          <Field label="Caller" value={data.caller_number ?? "—"} />
          <Field label="Room" value={data.room_number ?? "—"} />
        </div>
      </SectionCard>

      {data.notes && (
        <SectionCard title="Notes">
          <p className="whitespace-pre-wrap text-sm text-foreground">{data.notes}</p>
        </SectionCard>
      )}

      {/* Recording seam: dark until call recording ships. */}
      {data.recording_url && (
        <SectionCard title="Recording">
          <audio controls src={data.recording_url} className="w-full">
            <track kind="captions" />
          </audio>
        </SectionCard>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Rewrite the detail page to build a `CallDetail` and render the body**

Replace `apps/portal/app/(owner)/owner/calls/[id]/page.tsx` in full:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { StatusPill } from "@/components/owner/status-pill";
import { CallDetailBody, type CallDetail } from "@/components/owner/call-detail-body";

export default async function OwnerCallDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireRole("OWNER");
  const supabase = await createServerClient();

  const { data: call } = await supabase
    .from("calls")
    .select(
      "id, property_id, channel, state, caller_number, room_number, ring_started_at, duration_seconds, handled_by_user_id, notes, recording_url",
    )
    .eq("id", id)
    .maybeSingle();

  if (!call) notFound();

  const { data: property } = await supabase
    .from("properties")
    .select("name, timezone")
    .eq("id", call.property_id)
    .maybeSingle();

  let handlerName = "Unanswered";
  if (call.handled_by_user_id) {
    const { data: h } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", call.handled_by_user_id)
      .maybeSingle();
    handlerName = h?.full_name ?? "—";
  }

  const { data: incident } = await supabase
    .from("incidents")
    .select("id")
    .eq("call_id", id)
    .maybeSingle();

  const detail: CallDetail = {
    id: call.id,
    channel: call.channel,
    state: call.state,
    caller_number: call.caller_number,
    room_number: call.room_number,
    ring_started_at: call.ring_started_at,
    duration_seconds: call.duration_seconds,
    notes: call.notes,
    recording_url: call.recording_url,
    propertyName: property?.name ?? "—",
    timeZone: property?.timezone ?? "UTC",
    handlerName,
    incidentId: incident?.id ?? null,
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <Link
        href="/owner/calls"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden="true" /> Calls
      </Link>

      <div className="flex items-center gap-3">
        <h1 className="font-display text-3xl text-foreground">
          {call.channel === "VIDEO" ? "Video call" : "Phone call"}
        </h1>
        <StatusPill kind="call" status={call.state} />
      </div>

      <CallDetailBody data={detail} />
    </div>
  );
}
```

- [ ] **Step 3: Gate + commit**

Run: `cd apps/portal && pnpm test && pnpm lint && pnpm typecheck`
Expected: green. Manually confirm the detail page still renders the same (it's a pure refactor).

```bash
git add apps/portal/components/owner/call-detail-body.tsx "apps/portal/app/(owner)/owner/calls/[id]/page.tsx"
git commit -m "refactor(owner): extract CallDetailBody from the call detail page" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Owner list — enrich query, incidents map, build `CallDetail` per row

**Files:**
- Modify: `apps/portal/app/(owner)/owner/calls/page.tsx`

> `CallRowData` gains a new shape (`{ secondary, detail }`); its definition lives in `call-row.tsx`,
> which is **fully rewritten in Task 6**. This task only edits `page.tsx` to build the new shape, so
> **typecheck stays red until Task 6** — Tasks 5 and 6 are a pair and commit together (end of Task 6).

- [ ] **Step 1: Enrich the list query + build per-row `CallDetail`**

In `apps/portal/app/(owner)/owner/calls/page.tsx`:

(a) Extend the select — replace:

```tsx
    .select(
      "id, property_id, channel, state, ring_started_at, duration_seconds, handled_by_user_id, room_number",
    )
```

with:

```tsx
    .select(
      "id, property_id, channel, state, ring_started_at, duration_seconds, handled_by_user_id, room_number, caller_number, notes, recording_url",
    )
```

(b) After the handler-name block (after the `for (const h of handlers ?? []) …` loop), add a
batched incidents lookup:

```tsx
  // Incident existence per call — one batched query → Map<call_id, incidentId>.
  const incidentByCall = new Map<string, string>();
  const callIds = rows.map((c) => c.id);
  if (callIds.length > 0) {
    const { data: incidents } = await supabase
      .from("incidents")
      .select("id, call_id")
      .in("call_id", callIds);
    for (const inc of incidents ?? []) incidentByCall.set(inc.call_id, inc.id);
  }
```

(c) Replace the grouping loop's `item` construction. Replace:

```tsx
    const item: CallRowData = {
      id: c.id,
      channel: c.channel,
      state: c.state,
      ring_started_at: c.ring_started_at,
      duration_seconds: c.duration_seconds,
      timeZone: tz,
      secondary,
    };
```

with:

```tsx
    const item: CallRowData = {
      secondary,
      detail: {
        id: c.id,
        channel: c.channel,
        state: c.state,
        caller_number: c.caller_number,
        room_number: c.room_number,
        ring_started_at: c.ring_started_at,
        duration_seconds: c.duration_seconds,
        notes: c.notes,
        recording_url: c.recording_url,
        propertyName: nameById.get(c.property_id) ?? "—",
        timeZone: tz,
        handlerName: c.handled_by_user_id
          ? (handlerName.get(c.handled_by_user_id) ?? "—")
          : "Unanswered",
        incidentId: incidentByCall.get(c.id) ?? null,
      },
    };
```

(d) The existing import line
`import { CallRow, type CallRowData } from "@/components/owner/call-row";` stays as-is —
`CallRowData`'s new shape is provided by Task 6.

- [ ] **Step 2 (verify):** typecheck stays red until Task 6 rewrites `CallRow`. Proceed directly to
  Task 6; do not commit yet.

---

## Task 6: `CallRow` — client component, note icon, inline expand

**Files:**
- Modify: `apps/portal/components/owner/call-row.tsx`

- [ ] **Step 1: Rewrite `CallRow` as an expandable client component**

Replace the **entire** `apps/portal/components/owner/call-row.tsx` with:

```tsx
"use client";

import { useId, useState } from "react";
import { Phone, Video, StickyNote, ChevronDown } from "lucide-react";
import { StatusPill } from "@/components/owner/status-pill";
import { formatTimeOnly, formatDuration } from "@/lib/owner/format";
import { CallDetailBody, type CallDetail } from "@/components/owner/call-detail-body";
import { cn } from "@/lib/utils";

export type CallRowData = {
  readonly secondary: string; // pre-composed (handler · property · room …)
  readonly detail: CallDetail;
};

export function CallRow({ call }: { readonly call: CallRowData }) {
  const { detail, secondary } = call;
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const Icon = detail.channel === "VIDEO" ? Video : Phone;
  const hasNotes = Boolean(detail.notes?.trim());

  return (
    <div className="rounded-card border border-border bg-card shadow-sm">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:border-accent/40"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-input bg-muted text-foreground">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        {hasNotes && (
          <StickyNote className="size-3.5 shrink-0 text-text-muted" aria-label="Has notes" />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="font-medium text-foreground">
              {formatTimeOnly(detail.ring_started_at, detail.timeZone)}
            </span>
            <StatusPill kind="call" status={detail.state} />
          </span>
          <span className="mt-0.5 block truncate text-xs text-text-muted">
            {secondary}
            {` · ${formatDuration(detail.duration_seconds)}`}
          </span>
        </span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-text-muted transition-transform", expanded && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {expanded && (
        <div id={panelId} className="border-t border-border p-4">
          <CallDetailBody data={detail} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Gate**

Run: `cd apps/portal && pnpm test && pnpm lint && pnpm typecheck`
Expected: green (Tasks 5 + 6 together restore type consistency).

- [ ] **Step 3: Manual check**

Run `cd apps/portal && pnpm dev`, open `/owner/calls`, confirm: rows with notes show the note icon;
clicking a row expands it inline showing the full detail (no navigation); chevron rotates.

- [ ] **Step 4: Commit (Tasks 5 + 6)**

```bash
git add "apps/portal/app/(owner)/owner/calls/page.tsx" apps/portal/components/owner/call-row.tsx
git commit -m "feat(owner): note icon + inline expand for call rows" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Owner Calls — Audio/Video channel filter

**Files:**
- Modify: `apps/portal/app/(owner)/owner/calls/page.tsx`

- [ ] **Step 1: Parse + apply the channel param**

(a) Widen the `searchParams` type — replace:

```tsx
  searchParams: Promise<{ property?: string; limit?: string }>;
```

with:

```tsx
  searchParams: Promise<{ property?: string; limit?: string; channel?: string }>;
```

(b) Destructure + validate — replace:

```tsx
  const { property, limit: limitParam } = await searchParams;
```

with:

```tsx
  const { property, limit: limitParam, channel: channelParam } = await searchParams;
  const activeChannel: CallChannel | null =
    channelParam === "AUDIO" || channelParam === "VIDEO" ? channelParam : null;
```

(c) Add the import at the top (extend the existing `@lc/shared` usage — add a new import line):

```tsx
import type { CallChannel } from "@lc/shared";
```

(d) Apply to the query — after the property `if/else` block that sets `callsQuery`, add:

```tsx
  if (activeChannel) {
    callsQuery = callsQuery.eq("channel", activeChannel);
  }
```

- [ ] **Step 2: Preserve `channel` in the Load-more href + property pills; add channel pills**

(a) Replace the `moreHref` IIFE:

```tsx
  const moreHref = (() => {
    const sp = new URLSearchParams();
    if (activeProperty) sp.set("property", activeProperty);
    sp.set("limit", String(limit + DEFAULT_LIMIT));
    return `/owner/calls?${sp.toString()}`;
  })();
```

with a small href builder used by all the links:

```tsx
  const buildHref = (next: { property?: string | null; channel?: string | null; limit?: number }) => {
    const sp = new URLSearchParams();
    const p = next.property === undefined ? activeProperty : next.property;
    const ch = next.channel === undefined ? activeChannel : next.channel;
    if (p) sp.set("property", p);
    if (ch) sp.set("channel", ch);
    if (next.limit) sp.set("limit", String(next.limit));
    const qs = sp.toString();
    return `/owner/calls${qs ? `?${qs}` : ""}`;
  };
  const moreHref = buildHref({ limit: limit + DEFAULT_LIMIT });
```

(b) Update the existing property-filter pills to preserve `channel` — replace the
`href={"/owner/calls" as never}` "All" link and the per-property link `href`:

```tsx
            href={"/owner/calls" as never}
```
→
```tsx
            href={buildHref({ property: null }) as never}
```

and

```tsx
              href={`/owner/calls?property=${p.id}` as never}
```
→
```tsx
              href={buildHref({ property: p.id }) as never}
```

(c) Add the channel-filter pill row. Immediately after the closing `)}` of the `multiProperty &&`
block (before `{rows.length === 0 ? …}`), add:

```tsx
      <div className="flex flex-wrap gap-2">
        {(
          [
            { label: "All", value: null },
            { label: "Phone", value: "AUDIO" as const },
            { label: "Video", value: "VIDEO" as const },
          ] as const
        ).map((opt) => (
          <Link
            key={opt.label}
            href={buildHref({ channel: opt.value }) as never}
            className={cn(
              "rounded-pill border px-3 py-1 text-sm",
              activeChannel === opt.value
                ? "border-accent-strong bg-accent/10 text-accent-text"
                : "border-border text-text-muted",
            )}
          >
            {opt.label}
          </Link>
        ))}
      </div>
```

- [ ] **Step 3: Gate**

Run: `cd apps/portal && pnpm test && pnpm lint && pnpm typecheck`
Expected: green.

- [ ] **Step 4: Manual check**

On `/owner/calls`: All/Phone/Video pills filter the list; the active pill is highlighted; switching
channel preserves any active property filter and vice-versa; Load-more keeps both.

- [ ] **Step 5: Commit**

```bash
git add "apps/portal/app/(owner)/owner/calls/page.tsx"
git commit -m "feat(owner): Audio/Video channel filter on the calls list" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Final verification + status update

- [ ] **Step 1: Full suite + lint + typecheck**

Run: `cd apps/portal && pnpm test && pnpm lint && pnpm typecheck`
Expected: all green; the new `reliable-fetch` (5) + softphone failure-banner test pass; existing
suite unaffected.

- [ ] **Step 2: Manual prod-parity smoke (dev or preview)**

- Agent softphone: take a call, type room + notes, hang up → notes persist (check the row /
  `/owner/calls` detail). Force a failure (DevTools offline or block `/api/calls/notes`) → the
  preserved-text banner appears; restore + Retry → it clears.
- Video call: same notes-failure path keeps the overlay with Retry/Discard.
- Owner Calls: note icon on note-bearing rows; click expands inline (no navigation); All/Phone/Video
  filter; incident→call deep-link still opens the standalone detail page.

- [ ] **Step 3: Update TASKS.md + project status**

Add a row under the audit-remediation section of `TASKS.md` marking this work done (notes
durability + error surfacing + owner calls tab), and append a session note to
`memory/project-status.md` per the repo's pattern. Commit:

```bash
git add TASKS.md memory/project-status.md
git commit -m "docs: notes-and-errors + owner calls tab complete" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Deploy + prod smoke** (per the repo's deploy-and-smoke workflow — voice/video can
  only be smoke-tested on prod). Push `main`; Vercel auto-deploys; re-run the Step 2 smoke on prod.

---

## Notes for the executor

- **Tasks 5 + 6 are a pair** — `CallRowData` changes shape in 5 and `CallRow`'s body is rewritten in
  6; typecheck only goes green after 6. Don't commit between them.
- **`reliableFetch` is deliberately not used for the emergency *trigger*** (life-safety, not proven
  idempotent on the client path) — only Sentry reporting was added there. It *is* used for
  `emergency/control` (leave/mute), `answered`, `end-video`, and `notes`.
- **`postPresence` stays raw `fetch`** by design — a missed 20s heartbeat self-heals.
- **No migrations, no RLS, no route-handler changes.** `POST /api/calls/notes` is untouched.
