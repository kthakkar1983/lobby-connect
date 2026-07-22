import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { IncidentRow } from "@/components/owner/incident-row";

afterEach(() => cleanup());

describe("IncidentRow", () => {
  const incident = {
    id: "i1", status: "OPEN" as const, dispatched_to: "PSAP",
    created_at: "2026-07-01T04:00:00Z", propertyName: "The Sample Hotel", timeZone: "America/New_York",
  };
  it("the row link carries a focus ring", () => {
    render(<IncidentRow incident={incident} />);
    const link = screen.getByRole("link");
    expect(link.className).toContain("focus-visible:ring-ring");
    expect(link.className).toContain("focus-visible:ring-offset-2");
  });
});
