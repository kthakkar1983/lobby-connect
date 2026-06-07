export function RecordingNotice({ onOk }: { onOk: () => void }) {
  return (
    <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", padding: 32 }}>
      <div style={{ background: "var(--color-surface)", borderRadius: 16, padding: 40, maxWidth: 560, textAlign: "center" }}>
        <p style={{ fontSize: 24, marginTop: 0 }}>Calls may be recorded for training purposes.</p>
        <button
          type="button"
          onClick={onOk}
          style={{ marginTop: 16, padding: "16px 40px", border: "none", borderRadius: 12, background: "var(--color-primary)", color: "var(--color-primary-foreground)", fontSize: 22, fontWeight: 700, cursor: "pointer" }}
        >
          OK
        </button>
      </div>
    </div>
  );
}
