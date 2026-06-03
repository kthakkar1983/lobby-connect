import { describe, it, expect } from "vitest";
import {
  validatePlaybookFile,
  playbookStorageKey,
  MAX_PLAYBOOK_BYTES,
} from "@/lib/owner/playbook";

describe("validatePlaybookFile", () => {
  it("accepts a small PDF", () => {
    expect(validatePlaybookFile({ type: "application/pdf", size: 1024 })).toBeNull();
  });

  it("rejects a non-PDF", () => {
    expect(validatePlaybookFile({ type: "image/png", size: 1024 })).toMatch(/PDF/);
  });

  it("rejects an empty file", () => {
    expect(validatePlaybookFile({ type: "application/pdf", size: 0 })).toMatch(/empty/i);
  });

  it("rejects a file over the size cap", () => {
    expect(
      validatePlaybookFile({ type: "application/pdf", size: MAX_PLAYBOOK_BYTES + 1 }),
    ).toMatch(/10 MB/);
  });
});

describe("playbookStorageKey", () => {
  it("builds the canonical <operator>/<property>/playbook.pdf key", () => {
    expect(playbookStorageKey("op-1", "prop-1")).toBe("op-1/prop-1/playbook.pdf");
  });
});
