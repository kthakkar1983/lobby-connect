import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { Softphone } from "@/components/softphone/softphone";
import { VideoCallHost } from "@/components/video-call/video-call-host";
import { Wordmark } from "@/components/brand/wordmark";

export default async function AgentLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  await requireRole("AGENT");

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <Link href="/agent">
          <Wordmark />
        </Link>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="text-sm text-text-muted hover:text-foreground"
          >
            Sign out
          </button>
        </form>
      </header>
      <div className="grid gap-6 p-6 lg:grid-cols-[1fr_320px]">
        <main>{children}</main>
        <aside>
          <Softphone role="AGENT" />
          <VideoCallHost />
        </aside>
      </div>
    </div>
  );
}
