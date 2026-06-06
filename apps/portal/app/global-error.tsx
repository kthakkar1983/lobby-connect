"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Last-resort handler for render errors that escape the root layout. Without it,
 * such an error shows a blank screen and never reaches Sentry (the App Router
 * analog of the kiosk's ErrorBoundary). Reports the error, then offers a retry.
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
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <h1 className="text-xl font-medium">Something went wrong</h1>
          <p className="max-w-md text-sm text-text-muted">
            An unexpected error occurred. It has been logged. Try again, or reload the page.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
