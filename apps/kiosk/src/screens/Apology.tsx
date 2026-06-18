import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { SeamTop } from "../components/brand";
import { copy } from "../lib/copy";

export function Apology({ message, onDone }: { message: string | null; onDone: () => void }) {
  const [left, setLeft] = useState(10);
  useEffect(() => {
    const tick = setInterval(() => setLeft((s) => s - 1), 1000);
    const done = setTimeout(onDone, 10_000);
    return () => { clearInterval(tick); clearTimeout(done); };
  }, [onDone]);

  return (
    <div className="relative h-full">
      <SeamTop />
      <div className="flex h-full flex-col items-center justify-center px-10 text-center">
        <span className="mb-5 grid size-14 place-items-center rounded-pill bg-accent/10 text-accent">
          <Clock className="size-7" strokeWidth={1.6} />
        </span>
        <h1 className="max-w-[80%] font-display text-3xl font-semibold leading-tight text-foreground">
          {copy.apology.heading}
        </h1>
        <p className="mt-3.5 max-w-[60ch] text-base leading-relaxed text-muted-foreground">
          {message ?? copy.apology.fallback}
        </p>
        <p className="mt-6 font-mono text-xs text-muted-foreground">
          Returning to the welcome screen in {Math.max(0, left)}s…
        </p>
      </div>
    </div>
  );
}
