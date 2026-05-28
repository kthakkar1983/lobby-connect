export default function OwnerDashboardPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8">
        <h1 className="text-xl font-semibold text-foreground">Owner portal</h1>
        <p className="mt-2 text-sm text-text-muted">
          Placeholder — properties + recordings land in Plan 6.
        </p>
        <form action="/auth/signout" method="post" className="mt-6">
          <button
            type="submit"
            className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground"
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
