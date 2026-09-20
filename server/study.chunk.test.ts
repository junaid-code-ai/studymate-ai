import { describe, expect, it } from "vitest";
import { chunkText, MAX_PROCESSABLE_TEXT_LENGTH } from "./study";

describe("study text chunking", () => {
  it("keeps long source text in ordered chunks", () => {
    const source = `${"A".repeat(1_200)}\n\n${"B".repeat(1_200)}\n\n${"C".repeat(1_200)}`;
    const chunks = chunkText(source, 1_000);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join(" ")).toContain("A");
    expect(chunks.join(" ")).toContain("B");
    expect(chunks.join(" ")).toContain("C");
    expect(chunks.findIndex((chunk) => chunk.includes("A"))).toBeLessThan(chunks.findIndex((chunk) => chunk.includes("B")));
    expect(chunks.findIndex((chunk) => chunk.includes("B"))).toBeLessThan(chunks.findIndex((chunk) => chunk.includes("C")));
  });

  it("caps safe summary processing at a bounded text budget", () => {
    expect(MAX_PROCESSABLE_TEXT_LENGTH).toBe(600_000);
  });
});
