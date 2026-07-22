import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StatusCard } from "@/app/(admin)/admin/status/status-card";

afterEach(() => cleanup());

describe("StatusCard", () => {
  it.each([
    ["ok", "OK"],
    ["warn", "Degraded"],
    ["down", "Down"],
    ["unknown", "Unknown"],
  ] as const)("status=%s renders the word %s (not color alone)", (status, word) => {
    render(<StatusCard label="Twilio" status={status} value="last beat 2m ago" />);
    // toBeTruthy (not jest-dom's toBeInTheDocument, which isn't installed in
    // this repo — see fleet-board.test.tsx / status-pill.test.tsx for the
    // same house idiom): getByText already throws if the word isn't rendered.
    expect(screen.getByText(word)).toBeTruthy();
  });
});
