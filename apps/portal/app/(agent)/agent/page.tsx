export default function AgentDashboardPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-foreground">Front desk</h1>
      {/*
        Two-region in-call area. Left = call context/notes (driven by the
        softphone in the sidebar today). Right = reserved for Plan 6's video
        feed + playbook panel — intentionally empty in v1 so adding video is a
        fill-in, not a repaint.
      */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-card p-6">
          <p className="text-sm text-text-muted">
            Calls ring the softphone in the sidebar. Accept to connect.
          </p>
        </section>
        <section
          className="rounded-lg border border-dashed border-border p-6"
          aria-label="Video + playbook (Plan 6)"
        >
          <p className="text-sm text-text-muted">
            Video &amp; playbook appear here during lobby calls.
          </p>
        </section>
      </div>
    </div>
  );
}
