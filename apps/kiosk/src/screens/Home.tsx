import { Video } from "lucide-react";
import type { KioskConfig } from "../types";
import { SeamTop, LogoMark } from "../components/brand";
import { greetingForHour } from "@lc/shared";

const CTA_STYLES = {
  warm:    { panel: "bg-accent-strong", text: "text-white",  sub: "text-white/80", greet: "text-foreground" },
  accent:  { panel: "bg-primary",       text: "text-accent", sub: "text-white/70", greet: "text-foreground" },
  classic: { panel: "bg-primary",       text: "text-white",  sub: "text-white/80", greet: "text-accent-strong" },
} as const;

function InfoItem({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="font-label text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-base font-semibold text-foreground">{value}</span>
    </div>
  );
}

export function Home({ config, onCall }: { config: KioskConfig; onCall: () => void }) {
  const wifi =
    config.wifiNetwork && config.wifiPassword
      ? `${config.wifiNetwork} / ${config.wifiPassword}`
      : config.wifiNetwork;
  const s = CTA_STYLES[config.ctaStyle] ?? CTA_STYLES.warm;

  return (
    <div className="relative flex h-full">
      <SeamTop />
      {/* Left 55% — info */}
      <div className="flex flex-[0_0_55%] flex-col px-12 py-11">
        <div className="flex items-center gap-3">
          {config.logoUrl ? (
            <img src={config.logoUrl} alt="" className="size-9 rounded-input object-cover" />
          ) : (
            <LogoMark />
          )}
          <span className="font-label text-xs font-semibold uppercase tracking-[0.13em] text-foreground">
            {config.welcomeHeading}
          </span>
        </div>

        <h1 className={`mt-7 font-display text-5xl leading-[1.04] ${s.greet}`}>
          {greetingForHour(new Date().getHours())}.
        </h1>
        {config.welcomeMessage ? (
          <p className="mt-4 max-w-[92%] text-lg leading-relaxed text-muted-foreground">
            {config.welcomeMessage}
          </p>
        ) : null}

        <div className="mt-auto grid grid-cols-2 gap-x-8 gap-y-5">
          <InfoItem label="Check-in" value={config.checkinTime} />
          <InfoItem label="Check-out" value={config.checkoutTime} />
          <InfoItem label="Wi-Fi" value={wifi ?? null} />
          <InfoItem label="Breakfast" value={config.breakfastHours} />
        </div>
      </div>

      {/* Right 45% — action */}
      <button
        type="button"
        onClick={onCall}
        className={`relative flex flex-[0_0_45%] flex-col items-center justify-center gap-4 px-8 text-center transition-transform active:scale-[0.99] ${s.panel}`}
      >
        <Video className={`size-14 ${s.text}`} strokeWidth={1.75} />
        <span className={`font-display text-3xl leading-tight ${s.text}`}>
          Talk to the Front Desk
        </span>
        <span className={`text-sm ${s.sub}`}>One tap — a real person answers</span>
      </button>
    </div>
  );
}
