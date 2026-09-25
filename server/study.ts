import { PDFParse } from "pdf-parse";
import { invokeLLM } from "./_core/llm";
import { Mcq } from "../drizzle/schema";

const SUMMARY_CHUNK_SIZE = 60_000;
const MAX_SUMMARY_CHUNKS = 10;
export const MAX_PROCESSABLE_TEXT_LENGTH = SUMMARY_CHUNK_SIZE * MAX_SUMMARY_CHUNKS;
const STUDY_MODEL = "claude-haiku-4-5";

const summarySchema = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "A concise Markdown study summary with headings and bullet points.",
    },
  },
  required: ["summary"],
  additionalProperties: false,
};

const mcqSchema = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          options: {
            type: "array",
            minItems: 4,
            maxItems: 4,
            items: { type: "string" },
          },
          correctAnswer: {
            type: "integer",
            minimum: 0,
            maximum: 3,
            description: "Zero-based index of the correct option.",
          },
          explanation: { type: "string" },
        },
        required: ["question", "options", "correctAnswer", "explanation"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

function readTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        return typeof part.text === "string" ? part.text : "";
      }
      return "";
    })
    .join("");
}

function parseJsonResponse<T>(content: unknown): T {
  const text = readTextContent(content).trim();
  if (!text) throw new Error("The AI returned an empty response");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("The AI returned an invalid structured response");
  }
}

export function chunkText(text: string, chunkSize = SUMMARY_CHUNK_SIZE): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);
    if (end < text.length) {
      const paragraphBreak = text.lastIndexOf("\n\n", end);
      const sentenceBreak = text.lastIndexOf(". ", end);
      const boundary = paragraphBreak > start + chunkSize * 0.6 ? paragraphBreak + 2 : sentenceBreak > start + chunkSize * 0.6 ? sentenceBreak + 2 : end;
      end = boundary;
    }
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    start = end;
  }

  return chunks;
}

export async function extractPdfText(data: Buffer): Promise<string> {
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    return result.text.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").trim();
  } finally {
    await parser.destroy();
  }
}

async function summarizeChunk(chunk: string, index: number, total: number, signal?: AbortSignal): Promise<string> {
  const response = await invokeLLM({
    model: STUDY_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are a careful study assistant. Summarize only the provided source material. Do not add facts, examples, or conclusions that are not supported by the source. Preserve important definitions, relationships, dates, formulas, and examples. Return concise Markdown notes for this ordered section.",
      },
      {
        role: "user",
        content: `SOURCE SECTION ${index} OF ${total} BEGIN\n${chunk}\nSOURCE SECTION END\n\nSummarize this section for a later ordered synthesis.`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "study_summary_section", strict: true, schema: summarySchema },
    },
    signal,
  });

  const parsed = parseJsonResponse<{ summary: string }>(response.choices[0]?.message?.content);
  if (!parsed.summary?.trim()) throw new Error("The AI returned an empty section summary");
  return parsed.summary.trim();
}

async function synthesizeSummary(sectionSummaries: string[], signal?: AbortSignal): Promise<string> {
  const response = await invokeLLM({
    model: STUDY_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are a careful study assistant. Synthesize the ordered section notes into one clear Markdown study summary. Use only the supplied section notes, preserve their order and important context, and do not invent information. Include a short overview, descriptive headings, and bullet points where helpful.",
      },
      {
        role: "user",
        content: sectionSummaries.map((summary, index) => `SECTION ${index + 1}\n${summary}`).join("\n\n"),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "study_summary", strict: true, schema: summarySchema },
    },
    signal,
  });

  const parsed = parseJsonResponse<{ summary: string }>(response.choices[0]?.message?.content);
  if (!parsed.summary?.trim()) throw new Error("The AI returned an empty summary");
  return parsed.summary.trim();
}

export async function generateSummary(sourceText: string, signal?: AbortSignal): Promise<string> {
  const chunks = chunkText(sourceText);
  if (chunks.length === 0) throw new Error("The source material is empty");
  if (chunks.length > MAX_SUMMARY_CHUNKS) {
    throw new Error("The source material is too large to process safely");
  }
  if (chunks.length === 1) return summarizeChunk(chunks[0], 1, 1, signal);

  const sectionSummaries: string[] = [];
  const batchSize = 6;
  for (let index = 0; index < chunks.length; index += batchSize) {
    const batch = await Promise.all(
      chunks.slice(index, index + batchSize).map((chunk, batchIndex) => summarizeChunk(chunk, index + batchIndex + 1, chunks.length, signal)),
    );
    sectionSummaries.push(...batch);
  }
  return synthesizeSummary(sectionSummaries, signal);
}

export async function generateMcqs(sourceText: string): Promise<Mcq[]> {
  const boundedSource = sourceText.slice(0, 120_000);
  const response = await invokeLLM({
    model: STUDY_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are a precise study question writer. Create exactly five multiple-choice questions using only the provided source material. Every option, answer, and explanation must be supported by the source. Do not use outside knowledge. Avoid trick questions and make the incorrect options plausible but clearly contradicted or unsupported by the source.",
      },
      {
        role: "user",
        content: `SOURCE MATERIAL BEGIN\n${boundedSource}\nSOURCE MATERIAL END\n\nCreate five material-grounded MCQs now.`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "study_mcqs", strict: true, schema: mcqSchema },
    },
  });

  const parsed = parseJsonResponse<{ questions: Mcq[] }>(response.choices[0]?.message?.content);
  if (!Array.isArray(parsed.questions) || parsed.questions.length !== 5) {
    throw new Error("The AI did not return five valid MCQs");
  }
  for (const question of parsed.questions) {
    if (
      !question.question?.trim() ||
      !Array.isArray(question.options) ||
      question.options.length !== 4 ||
      question.options.some((option) => !option?.trim()) ||
      !Number.isInteger(question.correctAnswer) ||
      question.correctAnswer < 0 ||
      question.correctAnswer > 3 ||
      !question.explanation?.trim()
    ) {
      throw new Error("The AI returned an invalid MCQ set");
    }
  }
  return parsed.questions;
}
