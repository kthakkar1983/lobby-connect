import type { KioskConfig } from "../types";

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div style={{ fontSize: 18 }}>
      <strong>{label}: </strong>
      <span>{value}</span>
    </div>
  );
}

export function Home({ config, onCall }: { config: KioskConfig; onCall: () => void }) {
  const wifi =
    config.wifiNetwork && config.wifiPassword
      ? `${config.wifiNetwork} / ${config.wifiPassword}`
      : config.wifiNetwork;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: 32, gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {config.logoUrl && (
          <img src={config.logoUrl} alt="" style={{ width: 64, height: 64, borderRadius: 12, objectFit: "cover" }} />
        )}
        <h1 style={{ fontSize: 34, margin: 0 }}>{config.welcomeHeading}</h1>
      </div>
      {config.welcomeMessage && <p style={{ fontSize: 20, margin: 0, color: "var(--kiosk-muted)" }}>{config.welcomeMessage}</p>}

      <div style={{ background: "var(--kiosk-surface)", borderRadius: 16, padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
        <Row label="Check-in" value={config.checkinTime} />
        <Row label="Check-out" value={config.checkoutTime} />
        <Row label="WiFi" value={wifi ?? null} />
        <Row label="Breakfast" value={config.breakfastHours} />
      </div>

      <button
        type="button"
        onClick={onCall}
        style={{
          flex: 1, minHeight: 96, border: "none", borderRadius: 16,
          background: "var(--kiosk-navy)", color: "var(--kiosk-cream)",
          fontSize: 30, fontWeight: 700, cursor: "pointer",
        }}
      >
        Talk to the Front Desk
      </button>
    </div>
  );
}
