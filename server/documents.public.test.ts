import { describe, expect, it } from "vitest";
import { publicDocument } from "./routers";

describe("public document projection", () => {
  it("does not return extracted text or storage internals", () => {
    const result = publicDocument({
      id: 7,
      fileName: "large-textbook.pdf",
      fileKey: "42/documents/secret-key.pdf",
      fileUrl: "/manus-storage/secret-key.pdf",
      fileSize: 40 * 1024 * 1024,
      extractedText: "x".repeat(1_000_000),
      summary: "A short summary",
      mcqsJson: null,
      processingStatus: "ready",
      processingError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(result).toMatchObject({ id: 7, fileName: "large-textbook.pdf", processingStatus: "ready" });
    expect(result).not.toHaveProperty("extractedText");
    expect(result).not.toHaveProperty("fileKey");
    expect(result).not.toHaveProperty("fileUrl");
  });
});
