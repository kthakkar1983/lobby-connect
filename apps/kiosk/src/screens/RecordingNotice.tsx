import { ShieldCheck, X } from "lucide-react";
import { SeamTop } from "../components/brand";
import { copy } from "../lib/copy";

export function RecordingNotice({
  onOk, onClose,
}: {
  onOk: () => void;
  onClose: () => void;
}) {
  return (
    <div className="relative h-full">
      <SeamTop />
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 z-20 grid size-14 place-items-center rounded-pill border border-border bg-card text-muted-foreground shadow-sm transition-transform active:scale-95"
      >
        <X className="size-5" />
      </button>

      <div className="flex h-full items-center justify-center p-9">
        <div className="max-w-[78%] rounded-card border border-border bg-card p-11 text-center shadow-md">
          <ShieldCheck className="mx-auto mb-4 size-10 text-accent" strokeWidth={1.6} />
          <h1 className="font-display text-2xl leading-snug text-foreground">
            {copy.recording.heading}
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
            {copy.recording.body}
          </p>
          <button
            type="button"
            onClick={onOk}
            className="mt-6 rounded-button bg-live px-11 py-4 text-xl font-bold text-ink transition-transform active:scale-[0.98]"
          >
            {copy.recording.action}
          </button>
        </div>
      </div>
    </div>
  );
}
