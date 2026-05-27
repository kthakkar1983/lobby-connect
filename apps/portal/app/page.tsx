import { SHARED_PACKAGE_VERSION } from "@lc/shared";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <h1 className="text-2xl font-semibold">Lobby Connect Portal</h1>
        <p className="mt-2 text-sm text-text-muted">
          Foundation OK · shared v{SHARED_PACKAGE_VERSION}
        </p>
        <Button className="mt-6">shadcn primitive renders</Button>
      </div>
    </main>
  );
}
