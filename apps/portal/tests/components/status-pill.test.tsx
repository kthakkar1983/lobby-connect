import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { StatusPill } from "@/components/owner/status-pill";

afterEach(cleanup);

// Task 17 (outbound-video-calls plan): StatusPill forwards its new optional
// `direction` prop (kind="call" only) to lib/owner/status-pill's callPill.
// This is the component-level wiring test — callPill's own direction-aware
// branching is covered in tests/lib/owner/direction-labels.test.ts.
describe("StatusPill", () => {
  describe('kind="call"', () => {
    it("defaults to INBOUND when direction is omitted (byte-identical blaze 'Missed' pill)", () => {
      render(<StatusPill kind="call" status="NO_ANSWER" />);
      const pill = screen.getByText("Missed");
      expect(pill.className).toContain("attention");
    });

    it("renders the blaze 'Missed' pill for an explicit INBOUND NO_ANSWER", () => {
      render(<StatusPill kind="call" status="NO_ANSWER" direction="INBOUND" />);
      const pill = screen.getByText("Missed");
      expect(pill.className).toContain("attention");
    });

    it("renders a neutral 'No answer' pill — not blaze — for an OUTBOUND NO_ANSWER", () => {
      render(<StatusPill kind="call" status="NO_ANSWER" direction="OUTBOUND" />);
      const pill = screen.getByText("No answer");
      expect(pill.className).not.toContain("attention");
      expect(screen.queryByText("Missed")).toBeNull();
    });

    it("is unaffected by direction for a non-NO_ANSWER state", () => {
      render(<StatusPill kind="call" status="COMPLETED" direction="OUTBOUND" />);
      expect(screen.getByText("Completed")).toBeTruthy();
    });
  });

  describe('kind="incident"', () => {
    it("renders untouched — no direction concept on this variant", () => {
      render(<StatusPill kind="incident" status="OPEN" />);
      const pill = screen.getByText("Open");
      expect(pill.className).toContain("attention");
    });
  });
});
