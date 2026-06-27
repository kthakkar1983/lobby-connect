import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CaptionBand } from "@/components/call/caption-band";

afterEach(() => cleanup());

describe("CaptionBand", () => {
  it("renders nothing when there is no text", () => {
    const { container } = render(<CaptionBand finals={[]} partial="" />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the live partial transcript", () => {
    render(<CaptionBand finals={[]} partial="could I get" />);
    expect(screen.getByText(/could I get/)).toBeTruthy();
  });

  it("shows the two most recent finalized lines (not older ones)", () => {
    render(<CaptionBand finals={["one", "two", "three"]} partial="" />);
    expect(screen.queryByText(/one/)).toBeNull();
    expect(screen.getByText(/two\s+three/)).toBeTruthy();
  });

  it("renders the partial after the finalized text", () => {
    render(<CaptionBand finals={["Hello."]} partial="and welc" />);
    expect(screen.getByText(/Hello\./)).toBeTruthy();
    expect(screen.getByText(/and welc/)).toBeTruthy();
  });
});
