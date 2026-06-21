import { describe, it, expect } from "vitest";
import { id } from "@/lib/id";

describe("id()", () => {
  it("returns a 12-character string", () => {
    expect(id()).toHaveLength(12);
  });

  it("returns alphanumeric characters only", () => {
    for (let i = 0; i < 100; i++) {
      expect(id()).toMatch(/^[0-9a-zA-Z]+$/);
    }
  });

  it("produces unique values", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const val = id();
      expect(seen.has(val)).toBe(false);
      seen.add(val);
    }
  });
});
