import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import type { User } from "../drizzle/schema";

const sampleUser: User = {
  id: 42,
  openId: "validation-user",
  email: "student@example.com",
  name: "Study Student",
  loginMethod: "manus",
  role: "user",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

function createContext(user: User | null): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("documents validation", () => {
  it("rejects uploads over the 50 MB limit with a clear message", async () => {
    const caller = appRouter.createCaller(createContext(sampleUser));

    await expect(
      caller.documents.upload({
        fileName: "large-notes.pdf",
        mimeType: "application/pdf",
        sizeBytes: 50 * 1024 * 1024 + 1,
        dataBase64: "dGVzdA==",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "This PDF exceeds the 50 MB limit. Choose a smaller file.",
    });
  });

  it("protects document upload from unauthenticated callers", async () => {
    const caller = appRouter.createCaller(createContext(null));

    await expect(
      caller.documents.upload({
        fileName: "notes.pdf",
        mimeType: "application/pdf",
        sizeBytes: 4,
        dataBase64: "dGVzdA==",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects non-PDF uploads before storage or AI processing", async () => {
    const caller = appRouter.createCaller(createContext(sampleUser));

    await expect(
      caller.documents.upload({
        fileName: "notes.txt",
        mimeType: "text/plain",
        sizeBytes: 4,
        dataBase64: "dGVzdA==",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects files with a PDF name but invalid PDF bytes", async () => {
    const caller = appRouter.createCaller(createContext(sampleUser));

    await expect(
      caller.documents.upload({
        fileName: "notes.pdf",
        mimeType: "application/pdf",
        sizeBytes: 4,
        dataBase64: "dGVzdA==",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
