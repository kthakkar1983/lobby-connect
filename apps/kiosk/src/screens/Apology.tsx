import { useEffect, useState } from "react";
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
      <div className="flex h-full flex-col items-center justify-center px-9 text-center">
        <h1 className="max-w-[80%] font-display text-3xl leading-tight text-foreground">
          {copy.apology.heading}
        </h1>
        <p className="mt-3.5 max-w-[70%] text-base leading-relaxed text-muted-foreground">
          {message ?? copy.apology.fallback}
        </p>
        <p className="mt-6 font-mono text-xs text-muted-foreground">
          Returning to home in {Math.max(0, left)}s…
        </p>
      </div>
    </div>
  );
}
