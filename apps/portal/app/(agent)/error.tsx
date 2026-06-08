"use client";

import * as Sentry from "@sentry/nextjs";
import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { copy } from "@/lib/copy";

export default function AgentError({
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
    <ErrorState
      icon={TriangleAlert}
      title={copy.error.segment.title}
      description={copy.error.segment.description}
      action={
        <Button onClick={() => reset()} variant="outline">
          Try again
        </Button>
      }
    />
  );
}
