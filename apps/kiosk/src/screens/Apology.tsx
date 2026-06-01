import { useEffect } from "react";

export function Apology({ message, phone, onDone }: { message: string | null; phone: string | null; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 10_000);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", padding: 32 }}>
      <div style={{ textAlign: "center", maxWidth: 620 }}>
        <p style={{ fontSize: 26 }}>{message ?? "We're sorry, no one is available right now."}</p>
        {phone && <p style={{ fontSize: 22, color: "var(--kiosk-muted)" }}>Call us directly: {phone}</p>}
      </div>
    </div>
  );
}
