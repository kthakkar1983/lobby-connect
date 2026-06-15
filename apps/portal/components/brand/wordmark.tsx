import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------------------------
   Brand marks — the committed, SVGO-optimised vectors in /public/brand.
   Fixed full-colour artwork; light surfaces only (brand: no dark-mode logo in v1).

   The width/height attributes carry the artwork's intrinsic aspect ratio, so the
   browser reserves correct space (zero layout shift); the *rendered* size is the
   className height (default h-7) with width following the ratio.

   Logo = home: callers wrap these in the home <Link>. Never rendered on the kiosk
   (guest screens stay logo-free). Re-optimise after a re-export: pnpm -F @lc/portal optimize:svg
   ------------------------------------------------------------------------------------ */

/**
 * The mark — a doorway with a figure inside (the "lobby"). Portrait (~0.8 aspect).
 * Tight spots: collapsed rail, mobile headers, favicons, avatars.
 * Decorative by default; pass `title` when it stands alone as the only brand cue.
 */
export function LogoMark({
  className,
  title,
}: {
  readonly className?: string;
  readonly title?: string;
}) {
  return (
    <img
      src="/brand/mark.svg"
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
}: {
  readonly className?: string;
  readonly title?: string;
}) {
  return (
    <img
      src="/brand/wordmark.svg"
      width={460}
      height={184}
      alt={title}
      draggable={false}
      className={cn("h-7 w-auto select-none", className)}
    />
  );
}
