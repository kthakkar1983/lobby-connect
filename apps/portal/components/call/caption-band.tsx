import { cn } from "@/lib/utils";

/**
 * Live caption overlay (presentational). Shows the last finalized lines with
 * the in-progress partial appended (de-emphasized). Renders nothing while
 * silent so it never clutters the call screen. Position is the parent's job
 * (pass `className`). Agent-side comprehension aid — the agent hears the call,
 * so this is a visual assist, not an aria-live announcer.
 */
export function CaptionBand({
  finals,
  partial,
  className,
}: {
  readonly finals: string[];
  readonly partial: string;
  readonly className?: string;
}) {
  const recent = finals.slice(-2).join(" ");
  if (!recent && !partial) return null;

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none select-none rounded-card bg-[var(--color-call)]/90 px-4 py-2 text-white shadow-md",
        className,
      )}
    >
      <p className="text-pretty text-lg leading-snug">
        {recent}
        {recent && partial ? " " : ""}
        {partial && <span className="text-white/55">{partial}</span>}
      </p>
    </div>
  );
}
