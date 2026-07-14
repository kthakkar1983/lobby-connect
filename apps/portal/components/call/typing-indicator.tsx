import { cn } from "@/lib/utils";

// Stagger per dot (ms) so the ripple reads left-to-right, iMessage-style.
const DOT_DELAYS_MS = [0, 150, 300] as const;

/**
 * "The other party is typing" bubble — three dots that ripple via a
 * staggered `animation-delay` per dot (pure CSS, keyframe `lc-typing-dot` in
 * globals.css). Styled like a received message bubble so it reads correctly
 * wherever ChatDock renders it (tile, overlay, kiosk mirror). Reduced-motion:
 * `motion-reduce:animate-none` holds the dots visible but static, the same
 * pairing already used for `animate-spin`/`animate-pulse` elsewhere in this
 * app; the root is `aria-hidden` — an ambient visual cue, not an
 * announcement (mirrors CaptionBand).
 */
export function TypingIndicator({ className }: { readonly className?: string }) {
  return (
    <div
      data-testid="typing-indicator"
      aria-hidden="true"
      className={cn(
        "flex w-fit items-center gap-1.5 rounded-card bg-muted px-3 py-2.5",
        className,
      )}
    >
      {DOT_DELAYS_MS.map((delay) => (
        <span
          key={delay}
          style={{ animationDelay: `${delay}ms` }}
          className="size-2 animate-[lc-typing-dot_1.2s_ease-in-out_infinite] rounded-full bg-text-muted motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}
