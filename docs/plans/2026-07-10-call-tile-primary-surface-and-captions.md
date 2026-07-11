# Call tile as primary call surface + captions in the tile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Document-PiP call tile the primary call surface while it's open (the in-tab overlay collapses to playbook-only), move live captions into the tile (default OFF, per-call reset), and show the hotel clock on the tile for both channels.

**Architecture:** Keyed on one deterministic fact — *is the tile open* (`tileMount != null`) — the two in-call overlays hide their left panel (guest-video stage / audio call card) via a `collapsed` prop so the playbook fills the width. Caption *enabled* state moves into `CallSurfaceProvider` (shared by the overlay + tile toggles, default OFF, reset per call); caption *text* rides an isolated external store (`useSyncExternalStore`) so per-partial updates don't re-render the whole tree. A small read-only `timezone` plumb through the incoming-video route lets the video tile render the hotel clock it already computes.

**Tech Stack:** Next.js (App Router), React 19, TypeScript, Tailwind, Vitest (`vitest.jsdom.config.ts` for component tests, default config for route tests), Testing Library.

**Spec:** `docs/specs/2026-07-10-call-tile-primary-surface-and-captions-design.md`

---

## Test commands (referenced throughout)

- Component (jsdom) single file: `cd apps/portal && pnpm exec vitest run --config vitest.jsdom.config.ts <path>`
- Route (node) single file: `cd apps/portal && pnpm exec vitest run <path>`
- Full portal suite (both configs): `pnpm -F @lc/portal test`
- Typecheck / lint: `pnpm -F @lc/portal typecheck` · `pnpm -F @lc/portal lint`
- Repo gates: `pnpm typecheck` · `pnpm lint` · `pnpm check:routes` · `pnpm test`

## File Structure

| File | Responsibility after this change |
|---|---|
| `apps/portal/components/dashboard/call-surface-provider.tsx` | Owns caption `enabled`/`toggle` (default OFF, per-call reset) + the caption-text external store; still the call-state mirror. |
| `apps/portal/components/call-tile/call-tile.tsx` | Tile face: video/clock + basic controls + **caption band** (former notes slot) + **compact CC toggle**; hotel-clock chip top-left on video. No notes. |
| `apps/portal/components/call/caption-toggle.tsx` | Shared CC toggle; gains a `compact` (icon-only) variant for the tile. |
| `apps/portal/components/softphone/audio-call-overlay.tsx` | Audio in-call overlay; gains `collapsed` → hide call card, full-width playbook. |
| `apps/portal/components/softphone/softphone.tsx` | Audio call owner; reads caption enabled/toggle from surface, publishes caption text, passes `collapsed`. |
| `apps/portal/components/video-call/video-call.tsx` | Video call owner; `collapsed` prop hides guest-video stage; reads/publishes captions from/to surface. |
| `apps/portal/components/video-call/video-call-host.tsx` | Publishes VIDEO active-call info incl. `timeZone`; computes + passes `collapsed`. |
| `apps/portal/app/api/calls/incoming-video/route.ts` | Adds read-only `timezone` to the property join. |
| `apps/portal/lib/hooks/use-incoming-video-calls.ts` | `IncomingVideoCall` carries `timezone`. |
| `apps/portal/lib/captions/use-captions-enabled.ts` | **Deleted** — enabled state now lives in the provider. |

**Task order & dependencies:** 1 (provider caption API) → 2 (timezone plumb, independent) → 3 (collapse props, independent) → 4 (producers read captions from surface; needs 1) → 5 (tile UI; needs 1) → 6 (drop dead `saveNote`; needs 5). Each task leaves the full suite green.

---

### Task 1: Provider — caption enabled/toggle/per-call-reset + caption-text store

**Files:**
- Modify: `apps/portal/components/dashboard/call-surface-provider.tsx`
- Test: `apps/portal/tests/components/call-surface-provider.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append this `describe` block inside the top-level `describe("CallSurfaceProvider", …)` in `call-surface-provider.test.tsx`, and add `useSyncExternalStore` to the `react` import at the top of the file (`import { useSyncExternalStore } from "react";`):

```tsx
describe("captions", () => {
  function CaptionHarness() {
    const s = useCallSurface();
    const snap = useSyncExternalStore(s.subscribeCaptions, s.getCaptionSnapshot);
    const publishActiveCall = (callId: string) =>
      s.publishActive("AUDIO", {
        callId,
        channel: "AUDIO",
        propertyId: "prop-1",
        propertyName: "Hotel A",
        onHold: false,
        answeredAt: 0,
        timeZone: null,
      });
    return (
      <div>
        <div data-testid="cap-enabled">{s.captionsEnabled ? "on" : "off"}</div>
        <div data-testid="cap-finals">{snap.finals.join("|")}</div>
        <div data-testid="cap-partial">{snap.partial}</div>
        <button onClick={s.toggleCaptions}>toggle captions</button>
        <button onClick={() => s.publishCaptions(["hi"], "there")}>publish captions</button>
        <button onClick={() => publishActiveCall("call-1")}>start call-1</button>
        <button onClick={() => publishActiveCall("call-2")}>start call-2</button>
        <button onClick={() => s.publishActive("AUDIO", null)}>end call</button>
      </div>
    );
  }

  it("captions default OFF and toggleCaptions flips them", async () => {
    render(
      <CallSurfaceProvider>
        <CaptionHarness />
      </CallSurfaceProvider>,
    );
    expect(screen.getByTestId("cap-enabled").textContent).toBe("off");
    await act(async () => screen.getByText("toggle captions").click());
    expect(screen.getByTestId("cap-enabled").textContent).toBe("on");
  });

  it("resets captions to OFF on a new call (non-persistent, billing safety)", async () => {
    render(
      <CallSurfaceProvider>
        <CaptionHarness />
      </CallSurfaceProvider>,
    );
    await act(async () => screen.getByText("start call-1").click());
    await act(async () => screen.getByText("toggle captions").click());
    expect(screen.getByTestId("cap-enabled").textContent).toBe("on");
    // A different callId (call-B overwrites call-A) must reset captions OFF.
    await act(async () => screen.getByText("start call-2").click());
    expect(screen.getByTestId("cap-enabled").textContent).toBe("off");
  });

  it("relays published caption text to a useSyncExternalStore subscriber", async () => {
    render(
      <CallSurfaceProvider>
        <CaptionHarness />
      </CallSurfaceProvider>,
    );
    await act(async () => screen.getByText("publish captions").click());
    expect(screen.getByTestId("cap-finals").textContent).toBe("hi");
    expect(screen.getByTestId("cap-partial").textContent).toBe("there");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/portal && pnpm exec vitest run --config vitest.jsdom.config.ts tests/components/call-surface-provider.test.tsx`
Expected: FAIL — `s.captionsEnabled` / `s.toggleCaptions` / `s.publishCaptions` / `s.subscribeCaptions` / `s.getCaptionSnapshot` are `undefined` (TS + runtime).

- [ ] **Step 3: Add the caption fields to the `CallSurfaceValue` interface**

In `call-surface-provider.tsx`, inside the `interface CallSurfaceValue extends CallSurfaceSnapshot { … }`, add:

```ts
  /**
   * Live-caption ENABLED state (spec D6/D7). Shared by the overlay toggle AND
   * the tile toggle. Default OFF, non-persistent, reset to false on every call
   * transition — captions bill per audio-minute, so they run only when the
   * agent deliberately turns them on, and never carry into the next call.
   */
  captionsEnabled: boolean;
  toggleCaptions: () => void;
  /**
   * Caption TEXT relay (spec D8). Kept OUT of the memoized value — per-partial
   * updates would re-render every consumer. The live-call owner publishes; the
   * tile's band reads via useSyncExternalStore, so only the band re-renders.
   */
  publishCaptions: (finals: string[], partial: string) => void;
  subscribeCaptions: (cb: () => void) => () => void;
  getCaptionSnapshot: () => { finals: string[]; partial: string };
```

- [ ] **Step 4: Implement the caption state, store, and per-call reset**

In the `CallSurfaceProvider` body (after the existing `silencedKeys` state is fine; place it near the other state), add:

```ts
  // Captions (spec D6–D8). Enabled is shared + default OFF + reset per call.
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const toggleCaptions = useCallback(() => setCaptionsEnabled((p) => !p), []);

  // Caption-text external store: refs + a listener set keep per-partial churn
  // off the memoized `value`. getCaptionSnapshot returns the ref's CURRENT
  // object (stable identity between publishes) so useSyncExternalStore is happy.
  const captionStoreRef = useRef<{ finals: string[]; partial: string }>({ finals: [], partial: "" });
  const captionListenersRef = useRef<Set<() => void>>(new Set());
  const publishCaptions = useCallback((finals: string[], partial: string) => {
    captionStoreRef.current = { finals, partial };
    for (const cb of captionListenersRef.current) cb();
  }, []);
  const subscribeCaptions = useCallback((cb: () => void) => {
    captionListenersRef.current.add(cb);
    return () => {
      captionListenersRef.current.delete(cb);
    };
  }, []);
  const getCaptionSnapshot = useCallback(() => captionStoreRef.current, []);
```

Then add the per-call reset effect (place it near the other `active`-keyed effects, e.g. just above the auto-close effect):

```ts
  // Per-call caption reset (spec D7): a new callId — or call end (null) — turns
  // captions OFF and clears the relay. A forgotten "on" never bills the next call.
  useEffect(() => {
    setCaptionsEnabled(false);
    captionStoreRef.current = { finals: [], partial: "" };
    for (const cb of captionListenersRef.current) cb();
  }, [active?.callId]);
```

Add the five names to the `value` object AND to its dependency array (the store callbacks are `[]`-stable; `captionsEnabled` is the only new render-relevant dep):

```ts
      // …inside useMemo(() => ({ … }))
      captionsEnabled,
      toggleCaptions,
      publishCaptions,
      subscribeCaptions,
      getCaptionSnapshot,
```
```ts
    // …inside the deps array
      captionsEnabled,
      toggleCaptions,
      publishCaptions,
      subscribeCaptions,
      getCaptionSnapshot,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/portal && pnpm exec vitest run --config vitest.jsdom.config.ts tests/components/call-surface-provider.test.tsx`
Expected: PASS (all existing provider tests + the three new caption tests).

- [ ] **Step 6: Commit**

```bash
git add apps/portal/components/dashboard/call-surface-provider.tsx apps/portal/tests/components/call-surface-provider.test.tsx
git commit -m "feat(call-tile): caption enabled/toggle/reset + text store in CallSurfaceProvider"
```

---

### Task 2: Hotel-timezone plumb for the video tile (D10)

**Files:**
- Modify: `apps/portal/app/api/calls/incoming-video/route.ts`
- Modify: `apps/portal/lib/hooks/use-incoming-video-calls.ts`
- Modify: `apps/portal/components/video-call/video-call-host.tsx`
- Test: `apps/portal/tests/app/calls/incoming-video.test.ts`

- [ ] **Step 1: Write the failing test**

In `incoming-video.test.ts`, widen the `propertyRows` type and seed a timezone, then add an assertion. Change the declaration near the top:

```ts
let propertyRows: Array<{ id: string; name: string; timezone?: string | null }> = [];
```

In `beforeEach`, set:

```ts
  propertyRows = [{ id: "prop-1", name: "The Sample Hotel", timezone: "America/Chicago" }];
```

Add this test inside `describe("GET /api/calls/incoming-video", …)`:

```ts
  it("includes the property timezone per call (D10 hotel-clock plumb)", async () => {
    const body = await (await GET(request)).json();
    expect(body.calls[0].timezone).toBe("America/Chicago");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/portal && pnpm exec vitest run tests/app/calls/incoming-video.test.ts`
Expected: FAIL — `body.calls[0].timezone` is `undefined`.

- [ ] **Step 3: Add `timezone` to the route's property join and response**

In `route.ts`, replace the name-only property block (currently `let nameById = new Map…` through the `if (propertyIds.length > 0) { … }`) with:

```ts
  let nameById = new Map<string, string>();
  let tzById = new Map<string, string | null>();
  if (propertyIds.length > 0) {
    const { data: props } = await admin
      .from("properties")
      .select("id, name, timezone")
      .in("id", propertyIds);
    nameById = new Map((props ?? []).map((p) => [p.id as string, p.name as string]));
    tzById = new Map((props ?? []).map((p) => [p.id as string, (p.timezone as string | null) ?? null]));
  }
```

And add `timezone` to the mapped response:

```ts
    calls: calls.map((c) => ({
      id: c.id,
      channelName: c.agora_channel_name,
      propertyId: c.property_id,
      propertyName: nameById.get(c.property_id as string) ?? "Property",
      timezone: tzById.get(c.property_id as string) ?? null,
      ringStartedAt: c.ring_started_at,
    })),
```

- [ ] **Step 4: Carry `timezone` on the hook type and publish it from the host**

In `use-incoming-video-calls.ts`, add to `interface IncomingVideoCall`:

```ts
  timezone: string | null;
```

In `video-call-host.tsx`, replace `timeZone: null,` (in the `publishActive("VIDEO", … )` object) with:

```ts
            timeZone: active.timezone ?? null,
```

- [ ] **Step 5: Run the route test + typecheck**

Run: `cd apps/portal && pnpm exec vitest run tests/app/calls/incoming-video.test.ts`
Expected: PASS.
Run: `pnpm -F @lc/portal typecheck`
Expected: PASS (the host now reads `active.timezone`, which the widened `IncomingVideoCall` provides).

- [ ] **Step 6: Commit**

```bash
git add apps/portal/app/api/calls/incoming-video/route.ts apps/portal/lib/hooks/use-incoming-video-calls.ts apps/portal/components/video-call/video-call-host.tsx apps/portal/tests/app/calls/incoming-video.test.ts
git commit -m "feat(call-tile): plumb property timezone to the video active-call info (D10)"
```

---

### Task 3: `collapsed` prop on both in-call overlays + hosts pass it

**Files:**
- Modify: `apps/portal/components/softphone/audio-call-overlay.tsx`
- Modify: `apps/portal/components/video-call/video-call.tsx`
- Modify: `apps/portal/components/softphone/softphone.tsx`
- Modify: `apps/portal/components/video-call/video-call-host.tsx`
- Test: `apps/portal/tests/components/audio-call-overlay.test.tsx`, `apps/portal/tests/components/video-call.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `audio-call-overlay.test.tsx`, add:

```tsx
  it("collapses the call card (hidden) when the tile is up (collapsed)", () => {
    const { container } = render(<AudioCallOverlay {...baseProps} collapsed />);
    const card = container.querySelector('[data-testid="audio-call-card"]') as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.className).toContain("hidden");
  });

  it("shows the call card when not collapsed (default)", () => {
    const { container } = render(<AudioCallOverlay {...baseProps} />);
    const card = container.querySelector('[data-testid="audio-call-card"]') as HTMLElement;
    expect(card.className).not.toContain("hidden");
  });
```

In `video-call.test.tsx`, add (uses the file's existing `lk`/`fetchMock` setup):

```tsx
  it("collapses the guest-video stage (hidden) when the tile is up (collapsed prop)", async () => {
    const { container } = render(
      <VideoCall callId="call-collapse" onClose={vi.fn()} propertyName="The Sample Hotel" propertyId="prop-1" collapsed />,
    );
    await waitFor(() => expect(lk.joinLiveKitCall).toHaveBeenCalled());
    const stage = container.querySelector('[data-testid="guest-video-stage"]') as HTMLElement;
    expect(stage).toBeTruthy();
    expect(stage.className).toContain("hidden");
  });

  it("shows the guest-video stage when not collapsed (default)", async () => {
    const { container } = render(
      <VideoCall callId="call-expand" onClose={vi.fn()} propertyName="The Sample Hotel" propertyId="prop-1" />,
    );
    await waitFor(() => expect(lk.joinLiveKitCall).toHaveBeenCalled());
    const stage = container.querySelector('[data-testid="guest-video-stage"]') as HTMLElement;
    expect(stage.className).not.toContain("hidden");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/portal && pnpm exec vitest run --config vitest.jsdom.config.ts tests/components/audio-call-overlay.test.tsx tests/components/video-call.test.tsx`
Expected: FAIL — no `data-testid="audio-call-card"` / `guest-video-stage`; `collapsed` prop unknown.

- [ ] **Step 3: Implement `collapsed` on `audio-call-overlay.tsx`**

Add `collapsed` to the prop destructure and its type (default false):

```ts
  showReopenTile = false,
  onReopenTile,
  onConnect,
  collapsed = false,
```
```ts
  readonly onConnect?: () => void;
  /** Spec D2: when the call tile is up it owns the controls; the overlay hides
   *  its call card so the playbook fills the width. */
  readonly collapsed?: boolean;
```

Import `cn` at the top: `import { cn } from "@/lib/utils";`

Change the call-card `<div>` (the `basis-[37%]` navy panel) to carry the testid + conditional `hidden`:

```tsx
        <div
          data-testid="audio-call-card"
          className={cn(
            "relative flex basis-[37%] flex-col bg-[var(--color-call)] px-4 pb-6 pt-4 text-white",
            collapsed && "hidden",
          )}
        >
```

And make the playbook full-width when collapsed:

```tsx
        <PlaybookPanel callId={callId} basis={collapsed ? "basis-full" : "basis-[63%]"} />
```

- [ ] **Step 4: Implement `collapsed` on `video-call.tsx`**

Add `collapsed = false` to the component's destructured props and its type:

```ts
export function VideoCall({
  callId,
  onClose,
  propertyName,
  propertyId,
  collapsed = false,
}: {
  callId: string;
  onClose: () => void;
  propertyName: string;
  propertyId: string | null;
  /** Spec D2: hide the guest-video stage (playbook fills it) while the tile is up. */
  collapsed?: boolean;
}) {
```

Change the guest-video stage `<div>` (the `basis-2/5` panel) to carry the testid + conditional `hidden`:

```tsx
        <div
          data-testid="guest-video-stage"
          className={`relative basis-2/5 bg-[var(--color-call)]${collapsed ? " hidden" : ""}`}
        >
```

Make the playbook full-width when collapsed:

```tsx
        <PlaybookPanel callId={callId} basis={collapsed ? "basis-full" : "basis-3/5"} />
```

- [ ] **Step 5: Hosts compute + pass `collapsed`**

In `softphone.tsx`, read `tileMount` off the surface near the other surface reads (e.g. beside `tileClosedByUser`):

```ts
  const tileMount = surface?.tileMount ?? null;
```

Pass it to the overlay where `<AudioCallOverlay … />` is rendered:

```tsx
          collapsed={tileMount != null}
```

In `video-call-host.tsx`, pass it where `<VideoCall … />` is rendered:

```tsx
      collapsed={surface?.tileMount != null}
```

- [ ] **Step 6: Run the tests + typecheck**

Run: `cd apps/portal && pnpm exec vitest run --config vitest.jsdom.config.ts tests/components/audio-call-overlay.test.tsx tests/components/video-call.test.tsx`
Expected: PASS.
Run: `pnpm -F @lc/portal typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/components/softphone/audio-call-overlay.tsx apps/portal/components/video-call/video-call.tsx apps/portal/components/softphone/softphone.tsx apps/portal/components/video-call/video-call-host.tsx apps/portal/tests/components/audio-call-overlay.test.tsx apps/portal/tests/components/video-call.test.tsx
git commit -m "feat(call-tile): collapse in-call overlays to playbook-only while the tile is up"
```

---

### Task 4: Captions sourced from the surface (producers) + delete `use-captions-enabled`

**Files:**
- Modify: `apps/portal/components/video-call/video-call.tsx`
- Modify: `apps/portal/components/softphone/softphone.tsx`
- Delete: `apps/portal/lib/captions/use-captions-enabled.ts` and its test (`apps/portal/tests/**/use-captions-enabled*.test.ts*` — locate with `git ls-files | grep use-captions-enabled`)
- Update tests: `apps/portal/tests/components/video-call.test.tsx`, `apps/portal/tests/components/softphone.test.tsx`

Context: caption *enabled* now defaults OFF and comes from the surface. This is a refactor (default flip), so the honest order is: implement the surface-sourced captions first, watch the two existing default-ON tests break, then update them to opt captions ON via the provider. (`video-call-livekit.test.tsx`'s caption test already only asserts the hook was *called*, so it needs no change — with the surface absent it sees `null` and the assertion still holds.)

- [ ] **Step 1: Read caption enabled/toggle from the surface in `video-call.tsx`**

Remove the `useCaptionsEnabled` import and its call. Replace:

```ts
  const { enabled: captionsEnabled, toggle: toggleCaptions } = useCaptionsEnabled();
```
with (place after the existing `surface` reads):

```ts
  const captionsEnabled = surface?.captionsEnabled ?? false;
  const toggleCaptions = surface?.toggleCaptions ?? (() => {});
  const publishCaptions = surface?.publishCaptions;
```

Keep `const captions = useCaptions(captionsEnabled ? guestAudioTrack : null);` unchanged. Add an effect that mirrors caption text into the surface store for the tile:

```ts
  // Feed the tile's caption band (spec D8). Local band render is unchanged.
  useEffect(() => {
    publishCaptions?.(captions.finals, captions.partial);
  }, [publishCaptions, captions.finals, captions.partial]);
```

Delete the now-unused `import { useCaptionsEnabled } from "@/lib/captions/use-captions-enabled";`.

- [ ] **Step 2: Same wiring in `softphone.tsx`**

Remove `import { useCaptionsEnabled } from "@/lib/captions/use-captions-enabled";` and its call (`const { enabled: captionsEnabled, toggle: toggleCaptions } = useCaptionsEnabled();`). Replace with surface reads (place after the existing `surface`/`tileMount` reads):

```ts
  const captionsEnabled = surface?.captionsEnabled ?? false;
  const toggleCaptions = surface?.toggleCaptions ?? (() => {});
  const publishCaptions = surface?.publishCaptions;
```

Keep `const captions = useCaptions(captionsEnabled ? guestAudioTrack : null);` unchanged. Add:

```ts
  useEffect(() => {
    publishCaptions?.(captions.finals, captions.partial);
  }, [publishCaptions, captions.finals, captions.partial]);
```

- [ ] **Step 3: Delete `use-captions-enabled.ts` and its test**

```bash
git rm apps/portal/lib/captions/use-captions-enabled.ts
# locate + remove its test file:
git ls-files | grep use-captions-enabled
# git rm <the test path printed above>
```

- [ ] **Step 4: Run the caption tests to OBSERVE the default-flip break**

Run: `cd apps/portal && pnpm exec vitest run --config vitest.jsdom.config.ts tests/components/video-call.test.tsx tests/components/softphone.test.tsx`
Expected: FAIL — captions now default OFF, so the two "captions the guest…" tests (which assumed default-ON) see `useCaptions(null)`: `captionsSpy` is called with `null`, not the guest track, and the band never renders. (`video-call-livekit.test.tsx` still PASSES — it only asserts the hook was called.)

- [ ] **Step 5: Update the two caption tests to opt captions ON via the surface**

In `video-call.test.tsx`, add the provider import at the top:

```tsx
import { CallSurfaceProvider, useCallSurface } from "@/components/dashboard/call-surface-provider";
```

Add a small harness above the `describe` block:

```tsx
function EnableCaptions() {
  const { toggleCaptions } = useCallSurface();
  return <button onClick={toggleCaptions}>enable captions</button>;
}
```

Replace the existing `it("captions the guest audio: …")` body with a provider-wrapped, captions-ON version:

```tsx
  it("captions the guest audio when captions are ON: captures the remote track and renders the band", async () => {
    render(
      <CallSurfaceProvider>
        <EnableCaptions />
        <VideoCall callId="call-cap" onClose={vi.fn()} propertyName="The Sample Hotel" propertyId="prop-1" />
      </CallSurfaceProvider>,
    );
    await waitFor(() => expect(lk.joined.opts).not.toBeNull());
    // Captions default OFF — turn them on, then the guest track flows to useCaptions.
    await act(async () => screen.getByText("enable captions").click());

    const guestTrack = { kind: "audio" } as unknown as MediaStreamTrack;
    await act(async () => {
      (lk.joined.opts!.onRemoteAudioTrack as (t: MediaStreamTrack) => void)(guestTrack);
    });

    await waitFor(() => expect(captionsSpy.fn).toHaveBeenCalledWith(guestTrack));
    expect(screen.getByText(/could I get a late checkout/i)).toBeTruthy();
  });
```

In `softphone.test.tsx`, the softphone is already rendered inside the provider by `renderSoftphone`. Read the file to find the small consumer component it renders alongside `<Softphone>` (the one exposing the "Answer on card" button) and add a caption-toggle button to it, sourcing `toggleCaptions` from that consumer's existing `useCallSurface()` value:

```tsx
        <button onClick={() => toggleCaptions()}>enable captions</button>
```

(destructure `toggleCaptions` from the consumer's `useCallSurface()` alongside its existing reads). Then update `it("captions the guest after answering a phone call", …)` to click it after answering:

```tsx
    await user.click(screen.getByText("Answer on card"));
    await act(async () => screen.getByText("enable captions").click());

    // The remote audio track is captured shortly after accept and captioned.
    await waitFor(() => expect(captionsSpy.fn).toHaveBeenCalledWith(expect.objectContaining({ kind: "audio" })));
    await waitFor(() => expect(screen.getByText(/I need extra towels/i)).toBeTruthy());
```

- [ ] **Step 6: Run the affected tests + typecheck**

Run: `cd apps/portal && pnpm exec vitest run --config vitest.jsdom.config.ts tests/components/video-call.test.tsx tests/components/video-call-livekit.test.tsx tests/components/softphone.test.tsx`
Expected: PASS.
Run: `pnpm -F @lc/portal typecheck`
Expected: PASS. Confirm no stragglers: `git grep -n useCaptionsEnabled` returns nothing.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(call-tile): source caption enabled/toggle from the surface; publish caption text; drop use-captions-enabled"
```

---

### Task 5: Tile — remove notes, add caption band + compact CC toggle + hotel-clock chip on video

**Files:**
- Modify: `apps/portal/components/call/caption-toggle.tsx`
- Modify: `apps/portal/components/call-tile/call-tile.tsx`
- Test: `apps/portal/tests/components/call-tile.test.tsx`

- [ ] **Step 1: Add a `compact` (icon-only) variant to `CaptionToggle`** (a building block; its rendering is exercised by the tile caption test in Step 2, which finds the toggle by its `title`)

In `caption-toggle.tsx`, add a `compact` prop that renders icon-only (keeps `aria-pressed` + `title`, drops the text label):

```ts
export function CaptionToggle({
  enabled,
  onToggle,
  className,
  compact = false,
}: {
  readonly enabled: boolean;
  readonly onToggle: () => void;
  readonly className?: string;
  readonly compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={enabled}
      title={enabled ? "Turn captions off" : "Turn captions on"}
      className={cn(
        "flex items-center gap-1 rounded-button border text-sm",
        compact ? "px-2 py-2" : "px-3 py-2",
        enabled
          ? "border-accent bg-accent/10 text-accent-text"
          : "border-border text-text-muted",
        className,
      )}
    >
      {enabled ? <Captions size={16} /> : <CaptionsOff size={16} />}
      {!compact && (enabled ? "Captions" : "Captions off")}
    </button>
  );
}
```

- [ ] **Step 2: Write the failing tile tests**

In `call-tile.test.tsx`:

1. Delete the existing test `it("Enter in the note field calls saveNote with the typed room + note", …)` (notes leave the tile).
2. Add `publishCaptions` + a video-with-timezone fixture. Extend the `Harness` to also expose caption publishing — add to its destructure `publishCaptions` and add a button:

```tsx
  const { publishActive, registerCallControls, publishGuestVideoTrack, openTileForCall, publishCaptions } =
    useCallSurface();
  // …existing buttons…
      <button onClick={() => publishCaptions(["Extra towels to 204"], "")}>publish captions</button>
```

3. Add a video fixture with a timezone near `videoActive`:

```tsx
const videoActiveTz: ActiveCallInfo = { ...videoActive, timeZone: "America/Chicago" };
```

4. Add tests:

```tsx
  it("renders the hotel-clock chip on the video face when a timezone is present", async () => {
    const track = { kind: "video" } as unknown as MediaStreamTrack;
    const { pipDoc } = renderTile({ active: videoActiveTz, controls: makeControls(), track });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("publish track").click());
    await openTile();
    expect(pipDoc.body.querySelector('[data-testid="hotel-clock-chip"]')).toBeTruthy();
  });

  it("omits the hotel-clock chip on video when there is no timezone", async () => {
    const track = { kind: "video" } as unknown as MediaStreamTrack;
    const { pipDoc } = renderTile({ active: videoActive, controls: makeControls(), track });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("publish track").click());
    await openTile();
    expect(pipDoc.body.querySelector('[data-testid="hotel-clock-chip"]')).toBeNull();
  });

  it("shows the caption band in the tile only after captions are turned on (default OFF)", async () => {
    const track = { kind: "video" } as unknown as MediaStreamTrack;
    const { pipDoc } = renderTile({ active: videoActive, controls: makeControls(), track });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("publish track").click());
    await openTile();
    const tile = within(pipDoc.body);

    // Default OFF: publishing text does not surface a band.
    await act(async () => screen.getByText("publish captions").click());
    expect(tile.queryByText(/Extra towels to 204/)).toBeNull();

    // Turn captions ON via the tile's compact CC toggle (icon-only → query by title).
    const cc = pipDoc.body.querySelector('[title="Turn captions on"]') as HTMLButtonElement;
    expect(cc).toBeTruthy();
    await act(async () => cc.click());
    await act(async () => screen.getByText("publish captions").click());
    await waitFor(() => expect(tile.getByText(/Extra towels to 204/)).toBeTruthy());
  });

  it("has no Room #/Note inputs anymore", async () => {
    const { pipDoc } = renderTile({ active: audioActive, controls: makeControls() });
    await act(async () => screen.getByText("publish active").click());
    await act(async () => screen.getByText("register controls").click());
    await openTile();
    expect(pipDoc.body.querySelector('[aria-label="Room number"]')).toBeNull();
    expect(pipDoc.body.querySelector('[aria-label="Call note"]')).toBeNull();
  });
```

- [ ] **Step 3: Run the tile tests to verify they fail**

Run: `cd apps/portal && pnpm exec vitest run --config vitest.jsdom.config.ts tests/components/call-tile.test.tsx`
Expected: FAIL — `publishCaptions` isn't destructured (compile) / no `hotel-clock-chip` / no CC toggle / notes inputs still present.

- [ ] **Step 4: Implement the tile changes in `call-tile.tsx`**

Add module-level stable fallbacks for the caption store (so `useSyncExternalStore` is called unconditionally and never loops), and imports:

```tsx
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Mic, MicOff, PhoneOff, AlertTriangle, Monitor, Clock } from "lucide-react";
import { CaptionBand } from "@/components/call/caption-band";
import { CaptionToggle } from "@/components/call/caption-toggle";

const EMPTY_CAPTIONS = { finals: [] as string[], partial: "" };
const NOOP_SUBSCRIBE = () => () => {};
const GET_EMPTY_CAPTIONS = () => EMPTY_CAPTIONS;
```

Inside `CallTile`, read caption state from the surface (place near the existing `surface`/`controls` reads):

```tsx
  const captionsEnabled = surface?.captionsEnabled ?? false;
  const toggleCaptions = surface?.toggleCaptions ?? (() => {});
  const caption = useSyncExternalStore(
    surface?.subscribeCaptions ?? NOOP_SUBSCRIBE,
    surface?.getCaptionSnapshot ?? GET_EMPTY_CAPTIONS,
  );
```

Remove the `room`/`note` `useState`s and `handleSaveNote`.

**Hotel-clock chip (video face):** inside the `active.channel === "VIDEO"` branch's outer `<div className="relative flex-1 …">`, add (after the `GuestVideo`/placeholder, before or alongside the bottom overlay):

```tsx
            {localTime && (
              <div
                data-testid="hotel-clock-chip"
                className="absolute left-2 top-2 z-10 flex flex-col gap-0.5 rounded-button bg-black/40 px-2 py-1"
              >
                <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-live">Hotel</span>
                <span className="flex items-center gap-1 font-mono text-xs font-semibold">
                  <Clock size={11} /> {localTime}
                </span>
              </div>
            )}
```

**Control/caption section:** replace the entire notes+controls block (the `{controls && ( … )}` region that held the Room#/Note inputs and the control row) with a caption band in the former-notes slot + the control row that now includes the compact CC toggle:

```tsx
      {/* Caption band (spec D6) — occupies the former notes slot; only when
          captions are on AND there's text, else the face above expands. */}
      {captionsEnabled && (caption.finals.length > 0 || caption.partial) && (
        <div className="px-2 pb-1">
          <CaptionBand finals={caption.finals} partial={caption.partial} className="py-1 text-sm" />
        </div>
      )}

      {controls && (
        <div className="flex items-center gap-1.5 border-t border-primary-foreground/15 p-2">
          <button
            type="button"
            onClick={controls.toggleMute}
            aria-pressed={controls.muted}
            className="flex items-center gap-1 rounded-button border border-primary-foreground/25 px-2 py-1 text-xs text-primary-foreground"
          >
            {controls.muted ? <MicOff size={13} /> : <Mic size={13} />}
            {controls.muted ? "Unmute" : "Mute"}
          </button>
          <button
            type="button"
            onClick={controls.hangUp}
            className="flex items-center gap-1 rounded-button bg-attention px-2 py-1 text-xs font-semibold text-attention-foreground"
          >
            <PhoneOff size={13} /> Hang up
          </button>
          <CaptionToggle enabled={captionsEnabled} onToggle={toggleCaptions} compact />
          <button
            type="button"
            disabled={!active.propertyId}
            onClick={() => {
              if (active.propertyId) void surface?.connectToProperty(active.propertyId);
            }}
            className="ml-auto flex items-center gap-1 rounded-button bg-accent px-2 py-1 text-xs font-semibold text-accent-foreground disabled:opacity-50"
          >
            <Monitor size={13} /> Connect
          </button>
        </div>
      )}
```

(The 911 corner chip, the guest-video/clock faces, `useHotelClock`, `useElapsed`, and the 911 arm/confirm logic are unchanged. Delete the now-unused `CornerDownLeft`/note imports if present.)

- [ ] **Step 5: Run the tile tests + full suite**

Run: `cd apps/portal && pnpm exec vitest run --config vitest.jsdom.config.ts tests/components/call-tile.test.tsx`
Expected: PASS.
Run: `pnpm -F @lc/portal test`
Expected: PASS (both configs).

- [ ] **Step 6: Commit**

```bash
git add apps/portal/components/call/caption-toggle.tsx apps/portal/components/call-tile/call-tile.tsx apps/portal/tests/components/call-tile.test.tsx
git commit -m "feat(call-tile): captions band + compact CC toggle in the tile; hotel-clock chip on video; drop tile notes"
```

---

### Task 6: Remove the now-dead `saveNote` from `RegisteredCallControls`

**Files:**
- Modify: `apps/portal/components/dashboard/call-surface-provider.tsx`
- Modify: `apps/portal/components/video-call/video-call.tsx`
- Modify: `apps/portal/components/softphone/softphone.tsx`
- Test: `apps/portal/tests/components/call-tile.test.tsx`

Context: the tile was the only consumer of `controls.saveNote`; with tile notes gone (Task 5) it's dead. Removing it from the interface forces both registrations to drop it — a mechanical, type-driven change.

- [ ] **Step 1: Remove `saveNote` from the interface**

In `call-surface-provider.tsx`, delete the `saveNote` line from `interface RegisteredCallControls`:

```ts
  triggerEmergency?: () => void;
  // (delete) saveNote: (room: string, note: string) => Promise<boolean>;
```

- [ ] **Step 2: Run typecheck to surface every consumer**

Run: `pnpm -F @lc/portal typecheck`
Expected: FAIL — `video-call.tsx` and `softphone.tsx` still pass `saveNote` to `registerCallControls`; `call-tile.test.tsx`'s `makeControls` still sets it.

- [ ] **Step 3: Drop `saveNote` from both registrations**

In `video-call.tsx`, remove `saveNote` from the `registerCallControls({ … })` object, and delete the now-unused `saveNoteForTile` const + `registeredSaveNoteRef` ref (the real `saveNotes()` used for teardown/Enter-save stays — only the tile-registration wrapper goes).

In `softphone.tsx`, remove `saveNote` from its `registerCallControls({ … })` object and delete the now-unused `registerSaveNote` wrapper/ref if it exists (keep the overlay's own notes save path intact — it does not go through `registerCallControls`).

- [ ] **Step 4: Drop `saveNote` from the test control factory**

In `call-tile.test.tsx`, remove `saveNote: vi.fn().mockResolvedValue(true),` from `makeControls`.

- [ ] **Step 5: Run typecheck + full suite**

Run: `pnpm -F @lc/portal typecheck`
Expected: PASS.
Run: `pnpm -F @lc/portal test`
Expected: PASS.
Confirm no stragglers: `git grep -n "saveNote"` — only `saveNotes`/`saveNotesNow` (the real overlay save fns) should remain; no `RegisteredCallControls.saveNote`.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/components/dashboard/call-surface-provider.tsx apps/portal/components/video-call/video-call.tsx apps/portal/components/softphone/softphone.tsx apps/portal/tests/components/call-tile.test.tsx
git commit -m "refactor(call-tile): drop dead saveNote from RegisteredCallControls (tile notes removed)"
```

---

## Final verification (after all tasks)

- [ ] `pnpm test` (all packages, both configs) — PASS
- [ ] `pnpm typecheck` — PASS
- [ ] `pnpm lint` — PASS
- [ ] `pnpm check:routes` — PASS
- [ ] `git grep -n useCaptionsEnabled` — no matches (deleted)
- [ ] Open the PR; **prod auto-deploys on merge to `main`** (Coolify `lc-coolify` → `lc-portal-prod`). Then smoke on prod (not jsdom-testable):
  - Video call: guest feed fills the tile; **hotel-clock chip top-left**; overlay is **playbook-only** while the tile is up; **"Back to tab"** returns the 50-50.
  - Audio call: overlay call card collapses to full playbook while the tile is up; tile shows the hotel clock.
  - Turn captions **on from the tile** (CC) → band appears in the tile (and overlay); captions start **OFF** on each new call.
  - RustDesk **Connect** still launches; **911** two-tap still fires; **Hang up** ends the call.

## Notes for the implementer

- **jsdom cannot verify CSS layout / the real PiP window** — the tile-fill, playbook expansion, and chip placement are smoke-only (repo lesson). Tests assert structure (`hidden` class, presence/absence of testid'd nodes), not pixels.
- **Never depend on `surface` itself in an effect** — read the stable dispatchers off it (matches every existing publisher). The `publishCaptions` effect depends on `[publishCaptions, captions.finals, captions.partial]`, not `surface`.
- **`getCaptionSnapshot` must return a stable reference** between publishes (it returns `captionStoreRef.current`) or `useSyncExternalStore` will loop. `publishCaptions` allocates a fresh object each call, which is the intended change signal.
- **Blue-green:** merging to `main` deploys the box (prod); the frozen Vercel/Agora standby is unaffected. No env changes in this plan.
