import { describe, it, expect } from "vitest";
import { parseTranscriptMessage } from "@/lib/captions/messages";

describe("parseTranscriptMessage", () => {
  it("maps AddPartialTranscript to a partial update", () => {
    expect(
      parseTranscriptMessage({ message: "AddPartialTranscript", metadata: { transcript: "hello wor" } }),
    ).toEqual({ kind: "partial", text: "hello wor" });
  });

  it("maps AddTranscript to a final update", () => {
    expect(
      parseTranscriptMessage({ message: "AddTranscript", metadata: { transcript: "Hello, world." } }),
    ).toEqual({ kind: "final", text: "Hello, world." });
  });

  it("ignores non-transcript messages (e.g. EndOfTranscript, RecognitionStarted)", () => {
    expect(parseTranscriptMessage({ message: "EndOfTranscript" })).toEqual({ kind: "ignore" });
    expect(parseTranscriptMessage({ message: "RecognitionStarted" })).toEqual({ kind: "ignore" });
  });

  it("trims whitespace and tolerates a missing transcript", () => {
    expect(
      parseTranscriptMessage({ message: "AddTranscript", metadata: { transcript: "  spaced  " } }),
    ).toEqual({ kind: "final", text: "spaced" });
    expect(parseTranscriptMessage({ message: "AddPartialTranscript" })).toEqual({ kind: "partial", text: "" });
  });

  it("ignores malformed input without throwing", () => {
    expect(parseTranscriptMessage(null)).toEqual({ kind: "ignore" });
    expect(parseTranscriptMessage("nonsense")).toEqual({ kind: "ignore" });
  });
});
