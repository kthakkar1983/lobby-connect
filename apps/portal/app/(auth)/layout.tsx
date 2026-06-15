import Link from "next/link";

import { FloatingPaths } from "@/components/brand/floating-paths";
import { Wordmark } from "@/components/brand/wordmark";

export default function AuthLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[5fr_6fr]">
      {/* Brand panel — the human/hospitality side. Navy canvas, drifting
          connection-lines, the seam down the join. Desktop only. */}
      <aside className="relative hidden overflow-hidden bg-primary p-12 text-primary-foreground lg:flex lg:flex-col lg:justify-end">
        <FloatingPaths position={1} className="text-accent" />
        <FloatingPaths position={-1} className="text-live" />
        <div
          className="absolute inset-y-0 right-0 w-[3px]"
          style={{ background: "var(--gradient-seam-vertical)" }}
          aria-hidden="true"
        />

        <div className="relative z-10 max-w-sm">
          <p className="font-display text-4xl font-semibold leading-[1.15] text-primary-foreground">
            The front desk,
            <br />
            after hours.
          </p>
          <p className="mt-4 text-base text-primary-foreground/70">
            A real person, on the other side of the screen.
          </p>
        </div>
      </aside>

      {/* Form panel — the dependable-technology side. An elevated card lifts off
          the cool page surface; the seam runs across its top edge. */}
      <div className="relative flex min-h-screen flex-col justify-center bg-background px-4 py-12 sm:px-8">
        <div className="mx-auto w-full max-w-md">
          <div className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
            <div
              className="h-1.5 w-full"
              style={{ background: "var(--gradient-seam)" }}
              aria-hidden="true"
            />
            <div className="px-8 py-10 sm:px-10">
              <Link
                href="/"
                aria-label="Lobby Connect home"
                className="mx-auto block w-fit rounded-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <Wordmark className="h-12" />
              </Link>
              <div className="mt-6 border-t border-border" />
              <div className="mt-6">{children}</div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
