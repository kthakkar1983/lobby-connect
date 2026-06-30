# Handoff — first-call "agent can't hear guest" debug + Agora cost + realtime check

**Date:** 2026-06-30 · **Branch:** `main` (carries TEMPORARY diagnostics — see §4) · **Status:** leading root cause identified (environmental audio-device switch), **one decisive test pending**

Single "start here" doc. Self-contained. This session was a `systematic-debugging` pass over last session's v1.2 realtime work + the "first kiosk call has no audio" bug, which evolved into an audio-device investigation.

---

## TL;DR

The reported bug — **the agent can't hear the guest on the first cold video call; warm calls work** (reproduced on the agent's real Windows PC) — is **most likely environmental, not a code bug.** An exhaustive 25-agent analysis found **no deterministic code defect** (every theory refuted against the Agora SDK source). At the very end, Kumar gave the decisive clue: **on his MacBook (which hosts the kiosk/guest in testing), the mic "switches to his phone" at call start** (Apple Continuity / Bluetooth handoff) and he has to disconnect it. That matches the kiosk console warning `SEND_AUDIO_BITRATE_TOO_LOW` (uid in the kiosk range = the guest mic sending near-silence) and unifies every symptom: the guest end was transmitting silence, so *any* agent (incl. her Windows PC) heard nothing — and after he disconnects the phone the next call works ("first-call-only").

**THE PENDING TEST (do this first next session):** turn OFF Bluetooth/Handoff on the MacBook, force built-in mic/speakers, place a cold call, speak, ask if she can hear. **Yes → confirmed environmental** (the real kiosk is a dedicated tablet with no phone paired, so this likely won't occur in production). No → fall back to the now-working server-side energy probe (§4).

**Also pending:** strip the temporary diagnostics off `main` (§4); decide whether to merge the max-call-duration cap (§5); a 2-minute Agora Console check (§6).

---

## 1. Track A — "did video truly switch to realtime?" → YES, working as designed

Kumar saw "no speed difference" and worried realtime wasn't working. That's **expected**:
- v1.2 changed only the agent incoming-**video** banner: 3s poll → ~1s push + 60s safety poll. It does **not** touch audio (Twilio), the Agora media-connect, or the serverless cold-start that dominates a cold call. It was a **cost** change (~20× less idle polling), not a speed one.
- Verified healthy: migration `0018` applied, topic/RLS correct, **zero broadcast errors in Sentry** (send side healthy), RLS has valid data (1 operator, 0 profiles missing operator_id).
- Receive-side: not formally confirmed via DevTools WS, but Kumar observed "the dashboard updated right away" on a call, consistent with push working.
- **Not related to any audio issue.** Closed.

## 2. Track C — "did last session leave a mess?" → No, remediated

- `git add -A` key leak: repo clean, `.gitignore` block present, no tracked binaries (only the intentional `sample-playbook.pdf`). **Open human item: close the GitHub secret-scanning alert.**
- `void`→`after()` fix: all 4 publisher routes correct; `end-video` gated inside the IN_PROGRESS block.
- CI green on `main`; **no new runtime errors** in Sentry from the session.

## 3. Track B — "agent can't hear guest, first cold call" → leading cause = audio-device switch

**Symptom:** agent (her Windows PC) can't hear the guest (MacBook kiosk) on the first cold call; warm calls work. Reproduced on her PC.

**Exhaustive analysis (25-agent workflow, verified vs `node_modules` Agora source):** NO deterministic code bug. Refuted: captions interference, token/uid/channel, subscribe race, "wrong AudioContext" autoplay. Key fact: **Agora NG 4.24.4 plays remote audio via an HTMLAudioElement by default** (`_useAudioElement=!0`, confirmed in `AgoraRTC_N-production.js`), so the agent's **Accept click grants sticky activation** → `play()` should not be autoplay-blocked → the cause is **environmental**, not the agent's playback.

**The clue that fits everything (end of session):** the MacBook kiosk's **mic switches to Kumar's phone at call start** → the guest publishes a **silent** track (`SEND_AUDIO_BITRATE_TOO_LOW`, uid 485001 = kiosk range) → the agent hears nothing → he disconnects the phone → the next call works. Because the kiosk = his MacBook in *all* tests, this also explains why *her* PC couldn't hear (the guest end was silent, independent of her machine).

**Leading hypothesis (HIGH confidence, one test from confirmed):** the guest (kiosk) microphone on the phone-paired MacBook transmits silence on the cold first call due to OS audio-device handoff to the phone. **Environmental / test-rig artifact.**

**Decisive test (PENDING):** Bluetooth + Handoff OFF on the MacBook, built-in mic forced, cold call, speak → can she hear?
- **Yes → confirmed.** Production fix = dedicated kiosk tablet, no phone/Bluetooth paired (an ops setup step, not code). May be a **non-issue for v1**.
- **No → not (only) this.** Use the server-side energy probe (§4): `energy=ZERO` = guest audio not arriving (still a send/device problem); `energy=POSITIVE` = arrives but not played = agent output/device.

**Superseded:** the autoplay theory is moot if the guest sends silence (nothing to play). The "Tap to hear guest" button (shipped) only matters if `onAutoplayFailed` actually fires.

## 4. ⚠ TEMPORARY diagnostics now live on `main` — REMOVE once the cause is pinned

This session shipped a stack of diagnostics to read the guest-audio energy, fighting three obstacles in turn: **cached browser bundles**, an **apparently-unwired client Sentry DSN**, and **no DevTools access on the agent**. **None ever captured data** — strong evidence the agent's browser kept loading **stale bundles** (no service worker found; **incognito is the reliable cache-bust** and was the last instruction). The final server-side transport should work once she's genuinely on the fresh build.

Merged to `main` (newest→oldest):
| Merge | What it added (ALL temporary unless noted) |
|---|---|
| `183db70` | **`POST /api/diag/audio`** (`apps/portal/app/api/diag/audio/route.ts`) — logs the probe reading to **server** Sentry + Vercel logs. The probe (`lib/video/diag-audio.ts`) POSTs `started`+`result` per answered video call. The POST arriving proves the fresh build. **Read it:** `pnpm sentry:issues` for `DIAG guest-audio`. |
| `2619d7c` | On-screen `?diag=1` meter on the agent video overlay (`video-call.tsx`) — live guest `getVolumeLevel` (✓ARRIVING / ✗SILENT). |
| `60f472b` | `console.log("[LC DIAG] …")` fallback in `diag-audio.ts` + `agora.ts`. |
| `1ffb2a6` | Agent `getVolumeLevel` probe + `onAutoplayFailed` → **"Tap to hear guest"** button + **kiosk mic-before-camera decouple** + kiosk publish-timing probe. |

**To remove (search markers `LC DIAG`, `DIAG`, `reportGuestAudioDiagnostics`, `diagOn`, `?diag`):**
- DELETE `apps/portal/app/api/diag/audio/route.ts` and `apps/portal/lib/video/diag-audio.ts`.
- `apps/portal/components/video-call/video-call.tsx`: remove the `reportGuestAudioDiagnostics` call, the `diagOn`/`diagEnergy` state + interval + on-screen strip, and the diag import.
- `apps/kiosk/src/lib/agora.ts`: remove the `DIAG kiosk-publish` console.log + Sentry block (keep the mic-before-camera decouple — see below).

**KEEP (genuine hardening, not diagnostics) — decide explicitly:**
- **Kiosk mic-before-camera decouple** (`agora.ts`): publishes the guest mic in ~471ms instead of behind a ~1.6s cold camera warm-up. Real improvement; keep. (Confirmed working: `kiosk-publish: micToPublishMs=471 camToPublishMs=1569`.)
- **"Tap to hear guest" button + retry** (`video-call.tsx` `onAutoplayFailed`): harmless safety net for genuine autoplay blocks. Keep unless you want a clean overlay. The video-call test asserts it — update/remove the test together.
- Test isolation fix in `tests/components/video-call.test.tsx` (`agora.client.resetListeners()` + mocked `AgoraRTC.onAutoplayFailed`): keep regardless.

## 5. Max-call-duration cap — built, NOT merged (branch `fix/max-call-duration-cap` @ `abcdcd9`)

A 30-min hard cap (`MAX_CALL_DURATION_MS` in `@lc/shared/protocol.ts`, = `REAP_IN_PROGRESS_AFTER_MS`, guarded under the 3600s token TTL) enforced on **both** kiosk + agent: ends an abandoned call (guest walks away / agent leaves a tab open) so it can't hold an Agora channel + billing open. TDD'd (`shouldEndForMaxDuration`, protocol guard, agent cap test). **612 tests + typecheck/lint/build green. Decision pending: merge it.** (Branch was cut before the diag merges, so it's behind `main` — rebase/re-verify on merge.)

## 6. Agora cost (~5,500 min MTD) — investigated, NOT a runaway leak

- Only **2** calls all month sat IN_PROGRESS until the **daily reaper** closed them ~14-16h later (`FAILED`) — but those are **DB reaper-lag, not 16h of billing**: **no Agora token renewal exists**, so a stuck client drops at the **1h token expiry**. `0` IN_PROGRESS leaking now.
- ~5,500 is mostly heavy testing (113 video calls) + Agora counting audio+video streams separately (gap-filled — confirm via Console). Not a hemorrhage.
- **Pending (Kumar, Agora Console — no REST creds in prod):** (1) any channel joined RIGHT NOW with no active call (= live leak); (2) audio-vs-video minute split; (3) peak concurrent users/channel.
- The max-call-duration cap (§5) is the code-side mitigation.

## 7. Open items / next steps (in order)

1. **Confirm the device-switch hypothesis** — Bluetooth/Handoff-off test on the MacBook (§3). This is the linchpin.
2. If confirmed → **remove the temporary diagnostics** (§4), keep the hardening, and treat the bug as a test-rig artifact (note the ops requirement: real kiosk tablet has no phone/Bluetooth paired).
3. If NOT confirmed → she does ONE incognito answered call; read `DIAG guest-audio` from `pnpm sentry:issues`; branch on `energy=POSITIVE/ZERO`.
4. **Decide on the max-call-duration cap** (§5) — merge or hold.
5. **Agora Console checks** (§6).
6. Close the **GitHub secret-scanning alert** (§2).
7. **v2 robustness idea:** handle mid-call audio-device changes gracefully (Agora device-change events → re-acquire) — for agents with Bluetooth headsets. Separate enhancement.

## 8. Key learnings (verified this session)

- **Agora NG 4.24.4 plays remote audio via an `<audio>` element by default** → the Accept click's sticky activation means autoplay rarely blocks the agent's playback. (Source: SDK `_useAudioElement=!0`.)
- **No Agora token renewal** → stuck clients drop at the 1h token; a dangling IN_PROGRESS DB row ≠ Agora billing.
- **The cache trap:** an open tab keeps its old JS until reloaded; hard-refresh *should* work (no service worker), but **incognito is the only guaranteed cache-bust** — this silently blocked the whole diagnosis for multiple rounds. The server-side `/api/diag/audio` POST is the build-confirmation of record going forward (POST arrives = fresh build).
- **Client Sentry capture appears unreliable in prod** (kiosk probe ran but never reached Sentry; agent probe never appeared). **Server** Sentry is wired. Couldn't read env via the old Vercel CLI (`vercel env ls <proj> <env>` → "Custom Environment not found"; background `vercel ls` returns empty — use `vercel inspect <url>` or foreground).

## 9. Reading order next session
1. `CLAUDE.md` + `MEMORY.md` (esp. `realtime-and-cost.md`, `voice-vs-video-incoming.md`, `build-quirks.md`).
2. This handoff.
3. Run the §3 Bluetooth-off test → then §4 cleanup or §3 fallback.
