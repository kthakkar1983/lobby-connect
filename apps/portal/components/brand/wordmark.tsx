import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------------------------
   Brand marks — the committed, SVGO-optimised vectors in /public/brand.
   Full-colour artwork for light surfaces; pass `onDark` to swap to the reversed
   variant (navy ink → cool near-white, teal + mint untouched) for the navy sidebar.

   The width/height attributes carry the artwork's intrinsic aspect ratio, so the
   browser reserves correct space (zero layout shift); the *rendered* size is the
   className height (default h-7) with width following the ratio.

   Logo = home: callers wrap these in the home <Link>. Never rendered on the kiosk
   (guest screens stay logo-free). Re-optimise after a re-export: pnpm -F @lc/portal optimize:svg

   The `-on-dark.svg` pair is a mechanical reverse of the locked marks — swap in a
   bespoke dark-background logo by replacing those two files; nothing else changes.
   ------------------------------------------------------------------------------------ */

/**
 * The mark — a doorway with a figure inside (the "lobby"). Portrait (~0.8 aspect).
 * Tight spots: collapsed rail, mobile headers, favicons, avatars.
 * Decorative by default; pass `title` when it stands alone as the only brand cue.
 * `onDark` reverses it for the navy sidebar.
 */
export function LogoMark({
  className,
  title,
  onDark = false,
}: {
  readonly className?: string;
  readonly title?: string;
  readonly onDark?: boolean;
}) {
  return (
    <img
      src={onDark ? "/brand/mark-on-dark.svg" : "/brand/mark.svg"}
      width={351}
      height={439}
      alt={title ?? ""}
      aria-hidden={title ? undefined : true}
      draggable={false}
      className={cn("h-7 w-auto select-none", className)}
    />
  );
}

/**
 * The full "LOBBY connect" lockup with the mint dot–line–dot connector. Wide (~2.5 aspect).
 * Roomy spots: expanded sidebar header, sign-in, owner/agent headers.
 * `title` becomes the alt text; pass "" to make it decorative inside an already-labelled link.
 */
export function Wordmark({
  className,
  title = "Lobby Connect",
  onDark = false,
}: {
  readonly className?: string;
  readonly title?: string;
  readonly onDark?: boolean;
}) {
  return (
    <img
      src={onDark ? "/brand/wordmark-on-dark.svg" : "/brand/wordmark.svg"}
      width={460}
      height={184}
      alt={title}
      draggable={false}
      className={cn("h-7 w-auto select-none", className)}
    />
  );
}

/**
 * The full lockup — the mark beside the "LOBBY connect" wordmark. Wide (~2.6
 * aspect; viewBox cropped to the artwork). Roomy spots: the expanded sidebar
 * header. `onDark` reverses it for the navy rail.
 */
export function LogoLockup({
  className,
  title = "Lobby Connect",
  onDark = false,
}: {
  readonly className?: string;
  readonly title?: string;
  readonly onDark?: boolean;
}) {
  return (
    <img
      src={onDark ? "/brand/mark+wordmark-on-dark.svg" : "/brand/mark+wordmark.svg"}
      width={990}
      height={376}
      alt={title}
      draggable={false}
      className={cn("h-8 w-auto select-none", className)}
    />
  );
}
