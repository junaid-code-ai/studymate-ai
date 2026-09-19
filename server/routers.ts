import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { storagePut } from "./storage";
import {
  createDocument,
  getDocumentForUser,
  listDocumentsForUser,
  updateDocumentMcqs,
  updateDocumentSummary,
} from "./db";
import { extractPdfText, generateMcqs, generateSummary } from "./study";
import { Mcq } from "../drizzle/schema";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

function parseMcqs(mcqsJson: string | null): Mcq[] {
  if (!mcqsJson) return [];
  try {
    const value = JSON.parse(mcqsJson);
    return Array.isArray(value) ? (value as Mcq[]) : [];
  } catch {
    return [];
  }
}

function publicDocument(document: {
  id: number;
  fileName: string;
  fileSize: number;
  summary: string | null;
  mcqsJson: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const { mcqsJson, ...safeDocument } = document;
  return { ...safeDocument, mcqs: parseMcqs(mcqsJson) };
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
          sizeBytes: z.number().int().positive().max(MAX_FILE_SIZE),
          dataBase64: z.string().min(1),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const isPdfName = input.fileName.toLowerCase().endsWith(".pdf");
        if (input.mimeType !== "application/pdf" && !isPdfName) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only PDF files are supported." });
        }

        const data = Buffer.from(input.dataBase64, "base64");
        if (data.length === 0 || data.length > MAX_FILE_SIZE || data.length !== input.sizeBytes) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "The PDF is empty, too large, or incomplete." });
        }
        if (data.subarray(0, 4).toString() !== "%PDF") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "That file does not look like a valid PDF." });
        }

        let extractedText: string;
        try {
          extractedText = await extractPdfText(data);
        } catch (error) {
          console.error("[StudyMate] PDF extraction failed", error);
          throw new TRPCError({ code: "BAD_REQUEST", message: "We could not read text from that PDF." });
        }
        if (extractedText.length < 80) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "We could not find enough readable text in that PDF. Scanned PDFs are not supported in V1.",
          });
        }

        const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 180) || "study-material.pdf";
        const fileKey = `${ctx.user.id}/documents/${crypto.randomUUID()}-${safeName}`;
        const stored = await storagePut(fileKey, data, "application/pdf");

        let summary: string;
        try {
          summary = await generateSummary(extractedText.slice(0, 120000));
        } catch (error) {
          console.error("[StudyMate] Summary generation failed", error);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The PDF uploaded, but its summary could not be generated. Please try again." });
        }

        const document = await createDocument({
          userId: ctx.user.id,
          fileName: input.fileName,
          fileKey: stored.key,
          fileUrl: stored.url,
          fileSize: data.length,
          extractedText: extractedText.slice(0, 250000),
          summary,
          mcqsJson: null,
        });
        return publicDocument(document);
      }),

    generateMcqs: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const document = await getDocumentForUser(input.id, ctx.user.id);
        if (!document) throw new TRPCError({ code: "NOT_FOUND", message: "Study document not found." });
        try {
          const questions = await generateMcqs(document.extractedText.slice(0, 120000));
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
