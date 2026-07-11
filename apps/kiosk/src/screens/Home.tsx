import { Video } from "lucide-react";
import type { KioskConfig } from "../types";
import { FloatingPaths } from "../components/floating-paths";
import { greetingForHour } from "@lc/shared";

function InfoItem({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="font-label text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-sm font-semibold text-foreground">{value}</span>
    </div>
  );
}

export function Home({ config, onCall }: { config: KioskConfig; onCall: () => void }) {
  const hasInfo =
    config.checkinTime || config.checkoutTime || config.wifiNetwork ||
    config.wifiPassword || config.breakfastHours;

  return (
    // Tap-anywhere target. A <div role="button"> (not a real <button>): iOS
    // Safari does NOT reliably stretch a <button> used as a full-height flex
    // container to height:100% — it collapsed to ~half the iPad screen. A <div>
    // flex container fills the viewport like the other kiosk screens do.
    <div
      role="button"
      tabIndex={0}
      onClick={onCall}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onCall();
        }
      }}
      aria-label="Tap to connect with the front desk"
      className="relative flex h-full w-full cursor-pointer text-left transition-transform active:scale-[0.997]"
    >
      {/* LEFT — navy, animated invitation (50%) */}
      <div
        className="relative flex flex-[0_0_50%] flex-col overflow-hidden px-12 py-11 text-white"
        style={{ background: "var(--gradient-brand-panel)" }}
      >
        <FloatingPaths position={1} className="text-accent" />
        <FloatingPaths position={-1} className="text-live" />

        {/* Hotel name — text only, no logo (brand §2: never on the kiosk) */}
        <span className="relative z-10 font-display text-xs font-semibold uppercase tracking-[0.14em] text-white/85">
          {config.welcomeHeading}
        </span>

        <div className="relative z-10 mt-auto flex flex-col items-start">
          <div className="relative mb-7 grid size-[88px] place-items-center">
            <span className="lc-beacon-pulse absolute inset-0 rounded-pill border-2 border-live/55" aria-hidden />
            <span
              className="lc-beacon-pulse absolute inset-0 rounded-pill border-2 border-live/55"
              style={{ animationDelay: "-1.3s" }}
              aria-hidden
            />
            <span className="grid size-16 place-items-center rounded-pill bg-live/15 text-live">
              <Video className="size-8" strokeWidth={1.8} />
            </span>
          </div>
          <h1 className="max-w-[15ch] font-display text-[2.4rem] font-semibold leading-[1.08] tracking-tight">
            Tap anywhere to connect with the <span className="text-live">front desk</span>
          </h1>
        </div>

        {/* seam down the join */}
        <div
          className="absolute inset-y-0 right-0 z-10 w-[3px]"
          style={{ background: "var(--gradient-seam)" }}
          aria-hidden
        />
      </div>

      {/* RIGHT — light, greeting + small box (50%) */}
      <div className="flex flex-1 flex-col justify-center gap-6 px-11 py-10">
        <div>
          <h2 className="font-display text-[2rem] font-semibold leading-tight tracking-tight text-foreground">
            {greetingForHour(new Date().getHours())}.
          </h2>
          {config.welcomeMessage ? (
            <p className="mt-2 max-w-[34ch] text-[15px] leading-relaxed text-muted-foreground">
              {config.welcomeMessage}
            </p>
          ) : null}
        </div>

        {hasInfo ? (
          <div className="relative overflow-hidden rounded-card border border-border bg-card p-6 shadow-md">
            <span
              className="absolute inset-x-0 top-0 h-[3px]"
              style={{ background: "var(--gradient-seam)" }}
              aria-hidden
            />
            <span className="font-label text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Good to know
            </span>
            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
              <InfoItem label="Check-in" value={config.checkinTime} />
              <InfoItem label="Check-out" value={config.checkoutTime} />
              <InfoItem label="Wi-Fi" value={config.wifiNetwork} />
              <InfoItem label="Password" value={config.wifiPassword} />
              <InfoItem label="Breakfast" value={config.breakfastHours} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
