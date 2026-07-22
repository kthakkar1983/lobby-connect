# UI Copy Guide — Lobby Connect

> The voice for everything a user reads *inside the product*: button labels, status text, empty
> states, errors, toasts, confirmations, and kiosk guest lines. The visual system lives in
> [`brand-guidelines.md`](brand-guidelines.md); the tone source is [`../PRODUCT.md`](../PRODUCT.md).
> This guide is the enforceable anchor for the copy pass (impeccable `clarify`). One rule leads; the
> rest is mechanics.

## Voice

**A real person reached through a screen.** Calm, trustworthy, quietly warm. Never loud, cute, or
alarmist. Confidence through clarity and restraint, not decoration.

- Use contractions ("you're", "we'll", "isn't") — they're warmer and shorter.
- Every word earns its place. If a line still reads clearly with a word removed, remove it.
- Warm, not chirpy. We're a dependable night-shift colleague, not a mascot.
- Emergencies are plain and direct. Everything else is unhurried.

## The one rule: talk to the person, not about the interface

The single most common miss in this app is copy that describes *what the feature does* or *narrates
state* instead of speaking to the person about their situation.

- **Good** — teach a concrete *first action* when there's genuinely one to take:
  "Add your first property." · "Invite your first agent."
- **Bad** — narrate state, explain the mechanism, or over-explain:

| Now (talks about the UI) | Direction (talks to the person) | Why |
|---|---|---|
| "Incoming calls ring here." | "You're on. We'll ring you." | narrates the mechanism |
| "Calls you handle will chart here through the shift." | "Quiet so far tonight." | explains what the widget will do |
| "Your line is offline." | "Off duty." | narrates state; wrong altitude for an off-duty admin |
| "You're dialed in for properties set to Covering." | "Covering on" (or nothing) | explains the mechanism |

**Test:** if a sentence would still be true with the person out of the room (it's describing the
software), rewrite it to address the person, or cut it.

An empty state earns a teaching line only when there's a real first action. If the state is just
"nothing yet," a calm status ("Quiet so far tonight.") beats narrating the widget.

## Signals are copy too (honesty + altitude)

A **label and its color are a sentence.** "PHONE HEALTH" turning orange says *"your phone system is
unwell"* — so it must not fire for something smaller than that. That tile flipped on a single
FAILED call, which in the pilot is usually the line being *busy/at capacity*, not an unhealthy
system, so the signal overclaimed (resolved by removing it, below).

**Rule:** a status word, label, or alert color may only claim what actually happened, at the altitude
it implies. Don't let a one-off event wear a system-level alarm.

- These are decisions, not pure copy swaps (they may touch a label *and* a threshold). Flag them for
  review rather than silently rewording.
- *Decided (2026-07-21):* the **"Phone health"** tile is **removed**, not renamed. It fires only on
  FAILED calls (never missed), and those are already visible under **Calls › Failed**, so the tile
  overclaimed *and* was redundant. It was the sole entry to `/admin/phone-health`, so the tile + that
  page are removed together; the three remaining pulse tiles expand to fill the row.

## Terminology (canonical)

| Use | Not | Notes |
|---|---|---|
| End call | End · Hang up | the hang-up action, every surface |
| On call | ON_CALL · on a call | never expose the DB enum |
| Go on duty · End shift · On/Off duty · Break | clock in/out, sign on | |
| Covering | overflow, backup mode | the admin toggle |
| Missed | Unanswered · No answer | one word for the outcome |
| Guest | caller · customer | guest-facing and agent-facing |
| Front desk | agent · operator | what the *guest* is reached by; never "agent" to a guest |
| Property | hotel · your hotel · site | one noun, every surface |

One noun everywhere: **Property** (not "hotel"), on every surface. The guest still sees the
property's actual name, and never "kiosk," "agent," "operator," or "Lobby Connect."

## Mechanics

- **Sentence case** for buttons, titles, and messages ("Recent calls," not "Recent Calls"). The
  ALL-CAPS micro-labels are a *visual* treatment (the `font-label` class uppercases) — write the
  source string in sentence case and keep the words short and honest.
- **No em dashes** (`—`) or `--`. Use a period, comma, colon, semicolon, or parentheses. *Exception:*
  a standalone `"—"` as a placeholder for an empty data cell is a valid glyph, not prose.
- **No jargon or system leakage** in user-facing text: no DB enums (`ON_CALL`), no infra names
  ("Supabase," "Twilio"), no error codes, no implementation detail ("This wipes the user from...").
- **Numbers must be true.** State only numbers the code guarantees — the shift cap is **10h**, not
  12h. Durations, counts, and timers render in JetBrains Mono.

## Patterns

- **Buttons** — verb first, name the outcome: "End call," "Add property," "Resolve incident," "Save
  changes." No lone "Submit"/"OK" where a specific verb fits.
- **Empty states** — one calm line; add a first *action* only if one genuinely exists. Never narrate
  the widget.
- **Errors** — never blame the user. Say what happened, what's still safe, and the next step. Model
  (already in the app): *"Couldn't save notes. They're still here."* + Retry.
- **Confirmations** — name the consequence plainly; destructive actions read matter-of-fact, not
  scary. Model: *"That isn't available until your shift starts. Would you like to start it now?"*
- **Status** — terse and honest, always paired with a non-color cue (icon/text), never color alone.
- **Emergency** — plain, direct, calm imperative: *"Calling 911. Stay on the line."* This is the one
  place brevity outranks warmth.

## Kiosk (guest-facing) — one notch warmer

A hotel guest, often late, sometimes stressed. The **hotel's name leads**; no Lobby Connect branding.
Big, obvious, one action. Reassure without over-explaining ("Someone's almost there." beats a
description of the connection). Zero jargon. Never "kiosk," "agent," or a mechanism.

## Before you ship a string

1. Does it talk *to the person*, or *about the interface*? (Rewrite the second.)
2. Could a word come out and it still read clearly? (Remove it.)
3. Any em dash, enum, code, or infra name? (Purge.)
4. Is every number/claim true per the code?
5. If it's a label + color, does it overclaim? (Flag for review.)
6. Right term per the glossary and audience?
