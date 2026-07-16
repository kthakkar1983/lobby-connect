import { PhoneIncoming } from "lucide-react";
import { FloatingPaths } from "../components/floating-paths";
import { copy } from "../lib/copy";

/**
 * Shown when the kiosk's home-only discovery poll (App.tsx, ~3s) finds an
 * agent-initiated OUTBOUND call ringing for this property. Reuses Ringing.tsx's
 * dark call-stage container so incoming -> connecting -> connected reads as one
 * continuous call surface. Unlike Ringing, there's no local session yet at this
 * stage (onAnswer hasn't joined LiveKit) — no self-view PiP, no mute/camera —
 * just the one Answer action.
 */
export function IncomingCall({ onAnswer }: { onAnswer: () => void }) {
  return (
    <div className="relative h-full overflow-hidden" style={{ background: "var(--gradient-call-stage)" }}>
      <FloatingPaths position={1} className="text-accent" />
      <FloatingPaths position={-1} className="text-live" />

      {/* Decorative — must NOT capture taps, or it covers the Answer button
          below (see Ringing.tsx's identical guard / the kiosk redesign's
          Cancel bug: an inset-0 overlay with no pointer-events-none silently
          ate every tap meant for the control underneath). */}
      <div className="pointer-events-none absolute inset-0 z-[1] flex flex-col items-center justify-center gap-3 px-10 text-center text-white">
        <div className="relative mb-2 grid size-32 place-items-center">
          <span className="lc-beacon-pulse absolute inset-0 rounded-pill border-2 border-live/55" aria-hidden />
          <span
            className="lc-beacon-pulse absolute inset-0 rounded-pill border-2 border-live/55"
            style={{ animationDelay: "-1.3s" }}
            aria-hidden
          />
          <div className="absolute grid size-24 place-items-center rounded-pill bg-white/10">
            <PhoneIncoming className="size-9" strokeWidth={1.6} />
          </div>
        </div>
        <div className="font-display text-3xl font-semibold">{copy.incoming.title}</div>
        <div className="font-mono text-sm text-white/65">{copy.incoming.subtitle}</div>
      </div>

      <button
        type="button"
        onClick={onAnswer}
        className="absolute bottom-10 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-pill bg-live px-14 py-6 text-ink shadow-lg transition-transform active:scale-95"
      >
        <PhoneIncoming className="size-7" strokeWidth={1.8} />
        <span className="font-display text-xl font-semibold">{copy.incoming.answer}</span>
      </button>
    </div>
  );
}
