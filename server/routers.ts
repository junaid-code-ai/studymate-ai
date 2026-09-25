import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { storageDownload, storagePut } from "./storage";
import {
  claimDocumentProcessing,
  createDocument,
  getDocumentForUser,
  getDocumentForProcessing,
  listDocumentsForUser,
  updateDocumentMcqs,
  updateDocumentProcessing,
} from "./db";
import { extractPdfText, generateMcqs, generateSummary, MAX_PROCESSABLE_TEXT_LENGTH } from "./study";
import { Mcq } from "../drizzle/schema";

export const MAX_FILE_SIZE = 50 * 1024 * 1024;
const STORAGE_UPLOAD_TIMEOUT_MS = 120_000;
const STORAGE_PROCESS_TIMEOUT_MS = 45_000;
const EXTRACTION_TIMEOUT_MS = 60_000;
const SUMMARY_TIMEOUT_MS = 60_000;

function estimateBase64Bytes(value: string) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

function parseMcqs(mcqsJson: string | null): Mcq[] {
  if (!mcqsJson) return [];
  try {
    const value = JSON.parse(mcqsJson);
    return Array.isArray(value) ? (value as Mcq[]) : [];
  } catch {
    return [];
  }
}

export function publicDocument(document: {
  id: number;
  fileName: string;
  fileSize: number;
  summary: string | null;
  mcqsJson: string | null;
  processingStatus: string;
  processingError: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: document.id,
    fileName: document.fileName,
    fileSize: document.fileSize,
    summary: document.summary,
    processingStatus: document.processingStatus,
    processingError: document.processingError,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    mcqs: parseMcqs(document.mcqsJson),
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function withAbortableTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new Error(message);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  documents: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const documents = await listDocumentsForUser(ctx.user.id);
      return documents.map(publicDocument);
    }),

    get: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const document = await getDocumentForUser(input.id, ctx.user.id);
      if (!document) throw new TRPCError({ code: "NOT_FOUND", message: "Study document not found." });
      return publicDocument(document);
    }),

    upload: protectedProcedure
      .input(
        z.object({
          fileName: z.string().trim().min(1).max(255),
          mimeType: z.string().trim().min(1).max(128),
          sizeBytes: z.number().int().positive(),
          dataBase64: z.string().min(1),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (input.sizeBytes > MAX_FILE_SIZE || estimateBase64Bytes(input.dataBase64) > MAX_FILE_SIZE) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This PDF exceeds the 50 MB limit. Choose a smaller file." });
        }
        const isPdfName = input.fileName.toLowerCase().endsWith(".pdf");
        if (input.mimeType !== "application/pdf" && !isPdfName) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only PDF files are supported." });
        }

        const data = Buffer.from(input.dataBase64, "base64");
        if (data.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "The PDF is empty." });
        if (data.length > MAX_FILE_SIZE) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This PDF exceeds the 50 MB limit. Choose a smaller file." });
        }
        if (data.length !== input.sizeBytes) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "The PDF upload was incomplete. Please try again." });
        }
        if (data.subarray(0, 4).toString() !== "%PDF") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "That file does not look like a valid PDF." });
        }

        const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 180) || "study-material.pdf";
        const fileKey = `${ctx.user.id}/documents/${crypto.randomUUID()}-${safeName}`;
        let stored: { key: string; url: string };
        try {
          stored = await storagePut(fileKey, data, "application/pdf", STORAGE_UPLOAD_TIMEOUT_MS);
        } catch (error) {
          console.error("[StudyMate] PDF storage failed", error);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The PDF could not be uploaded. Please try again." });
        }

        try {
          const document = await createDocument({
            userId: ctx.user.id,
            fileName: input.fileName,
            fileKey: stored.key,
            fileUrl: stored.url,
            fileSize: data.length,
            extractedText: null,
            summary: null,
            mcqsJson: null,
            processingStatus: "uploaded",
            processingError: null,
          });
          return publicDocument(document);
        } catch (error) {
          console.error("[StudyMate] Document record creation failed", error);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The PDF was stored but could not be registered. Please try again." });
        }
      }),

    process: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const existing = await getDocumentForProcessing(input.id, ctx.user.id);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Study document not found." });
        if (existing.processingStatus === "ready") return publicDocument(existing);

        const claimed = await claimDocumentProcessing(existing.id, ctx.user.id);
        if (!claimed) {
          const current = await getDocumentForUser(existing.id, ctx.user.id);
          if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Study document not found." });
          return publicDocument(current);
        }

        try {
          const data = await storageDownload(existing.fileKey, MAX_FILE_SIZE, STORAGE_PROCESS_TIMEOUT_MS);
          if (data.subarray(0, 4).toString() !== "%PDF") throw new Error("Stored file is not a valid PDF");
          const extractedText = await withTimeout(extractPdfText(data), EXTRACTION_TIMEOUT_MS, "PDF text extraction timed out. Try splitting the PDF into smaller files.");
          if (!extractedText.trim()) throw new Error("We could not find readable text in that PDF. Scanned PDFs are not supported in V1.");
          if (extractedText.length > MAX_PROCESSABLE_TEXT_LENGTH) throw new Error("This PDF contains more readable text than V1 can safely process. Try splitting it into smaller PDFs.");

          const summary = await withAbortableTimeout(
            (signal) => generateSummary(extractedText, signal),
            SUMMARY_TIMEOUT_MS,
            "Summary generation timed out. The PDF is saved; try again or split it into smaller files.",
          );
          await updateDocumentProcessing(existing.id, { processingStatus: "ready", processingError: null, extractedText, summary, processingStartedAt: null });
          const ready = await getDocumentForUser(existing.id, ctx.user.id);
          if (!ready) throw new Error("Processed document could not be reloaded");
          return publicDocument(ready);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Document processing failed.";
          console.error("[StudyMate] Document processing failed", error);
          try {
            await updateDocumentProcessing(existing.id, {
              processingStatus: "failed",
              processingError: message.slice(0, 500),
              extractedText: null,
              summary: null,
              processingStartedAt: null,
            });
          } catch (cleanupError) {
            console.error("[StudyMate] Failed to persist document processing error", cleanupError);
          }
          const failed = await getDocumentForUser(existing.id, ctx.user.id);
          if (!failed) throw new TRPCError({ code: "NOT_FOUND", message: "Study document not found." });
          return publicDocument(failed);
        }
      }),

    generateMcqs: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const document = await getDocumentForProcessing(input.id, ctx.user.id);
        if (!document) throw new TRPCError({ code: "NOT_FOUND", message: "Study document not found." });
        if (document.processingStatus !== "ready" || !document.extractedText) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This document is not ready for MCQs yet." });
        }
        try {
          const questions = await withTimeout(generateMcqs(document.extractedText), 60_000, "MCQ generation timed out. Please try again.");
          await updateDocumentMcqs(document.id, JSON.stringify(questions));
          return { ...publicDocument(document), mcqs: questions };
        } catch (error) {
          console.error("[StudyMate] MCQ generation failed", error);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "MCQs could not be generated right now. Please try again." });
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
