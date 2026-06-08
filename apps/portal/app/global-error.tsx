"use client";

import * as Sentry from "@sentry/nextjs";
import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { copy } from "@/lib/copy";

/**
 * Last-resort handler for render errors that escape the root layout. Without it,
 * such an error shows a blank screen and never reaches Sentry (the App Router
 * analog of the kiosk's ErrorBoundary). Reports the error, then offers a retry.
 * Renders its own <html>/<body> (the root layout is gone at this level), so it
 * relies on globals.css tokens; brand fonts fall back to the system stack.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-background text-foreground">
        <div className="relative flex min-h-screen items-center justify-center p-8">
          {/* seam hairline along the top — the brand "connected" device */}
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-[3px] bg-[image:var(--gradient-seam)]"
          />
          <ErrorState
            icon={TriangleAlert}
            title={copy.error.global.title}
            description={copy.error.global.description}
            action={
              <Button onClick={() => reset()} variant="outline">
                Try again
              </Button>
            }
          />
        </div>
      </body>
    </html>
  );
}
