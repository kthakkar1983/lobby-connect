// Stagger per dot (ms) so the ripple reads left-to-right, iMessage-style —
// mirrors the portal's TypingIndicator (apps/portal/components/call/typing-indicator.tsx).
const DOT_DELAYS_MS = [0, 150, 300] as const;

/**
 * "The other party is typing" bubble — three dots that ripple via a
 * staggered `animation-delay` per dot (pure CSS, keyframe `lc-typing-dot` in
 * index.css). Styled like a received message bubble so it reads correctly
 * inside the in-call chat column (screens/Connected.tsx). Reduced-motion:
 * `motion-reduce:animate-none` holds the dots visible but static (same
 * pairing already used for `lc-anim-spin`/`lc-anim-pulse` elsewhere in this
 * app); the root is `aria-hidden` — an ambient visual cue, not an
 * announcement.
 */
export function TypingIndicator({ className }: { readonly className?: string }) {
  return (
    <div
      data-testid="typing-indicator"
      aria-hidden="true"
      className={`flex w-fit items-center gap-1.5 rounded-card bg-muted px-3 py-2.5${className ? ` ${className}` : ""}`}
    >
      {DOT_DELAYS_MS.map((delay) => (
        <span
          key={delay}
          style={{ animationDelay: `${delay}ms` }}
          className="size-2 animate-[lc-typing-dot_1.2s_ease-in-out_infinite] rounded-full bg-muted-foreground motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}
