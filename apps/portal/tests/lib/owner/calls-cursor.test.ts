import { describe, it, expect } from "vitest";
import { encodeCursor, decodeCursor, keysetOrFilter } from "@/lib/owner/calls-cursor";

describe("calls-cursor", () => {
  it("round-trips encode -> decode", () => {
    const row = { created_at: "2026-06-12T05:00:00.000Z", id: "11111111-2222-3333-4444-555555555555" };
    const enc = encodeCursor(row);
    expect(decodeCursor(enc)).toEqual({ at: row.created_at, id: row.id });
  });
  it("decodes null/empty/malformed to null", () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("nodelimiter")).toBeNull();
    expect(decodeCursor("~abc")).toBeNull();
    expect(decodeCursor("abc~")).toBeNull();
  });
  it("rejects crafted cursors that could shape the .or() filter", () => {
    const uuid = "11111111-2222-3333-4444-555555555555";
    expect(decodeCursor("2026-06-12T05:00:00.000Z~not-a-uuid")).toBeNull(); // id not a uuid
    expect(decodeCursor("2026-06-12T05:00:00.000Z~abc),or(1.eq.1")).toBeNull(); // .or() injection in id
    expect(decodeCursor(`2026,or(x~${uuid}`)).toBeNull(); // structural chars in at
    expect(decodeCursor(`2026-06-12T05:00:00.000Z~${uuid}~x`)).toBeNull(); // stray second '~'
  });
  it("builds the keyset .or() filter (strictly older under created_at desc, id desc)", () => {
    expect(keysetOrFilter({ at: "2026-06-12T05:00:00.000Z", id: "id9" })).toBe(
      "created_at.lt.2026-06-12T05:00:00.000Z,and(created_at.eq.2026-06-12T05:00:00.000Z,id.lt.id9)",
    );
  });
});
