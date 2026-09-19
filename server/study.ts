import { PDFParse } from "pdf-parse";
import { invokeLLM } from "./_core/llm";
import { Mcq } from "../drizzle/schema";

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

export async function extractPdfText(data: Buffer): Promise<string> {
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    return result.text.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").trim();
  } finally {
    await parser.destroy();
  }
}

export async function generateSummary(sourceText: string): Promise<string> {
  const response = await invokeLLM({
    model: "gpt-5-mini",
    messages: [
      {
        role: "system",
        content:
          "You are a careful study assistant. Summarize only the provided source material. Do not add facts, examples, or conclusions that are not supported by the source. Return a clear Markdown summary with a short overview, descriptive headings, and bullet points where helpful.",
      },
      {
        role: "user",
        content: `SOURCE MATERIAL BEGIN\n${sourceText}\nSOURCE MATERIAL END\n\nCreate the study summary now.`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "study_summary",
        strict: true,
        schema: summarySchema,
      },
    },
  });

  const parsed = parseJsonResponse<{ summary: string }>(response.choices[0]?.message?.content);
  if (!parsed.summary?.trim()) throw new Error("The AI returned an empty summary");
  return parsed.summary.trim();
}

export async function generateMcqs(sourceText: string): Promise<Mcq[]> {
  const response = await invokeLLM({
    model: "gpt-5-mini",
    messages: [
      {
        role: "system",
        content:
          "You are a precise study question writer. Create exactly five multiple-choice questions using only the provided source material. Every option, answer, and explanation must be supported by the source. Do not use outside knowledge. Avoid trick questions and make the incorrect options plausible but clearly contradicted or unsupported by the source.",
      },
      {
        role: "user",
        content: `SOURCE MATERIAL BEGIN\n${sourceText}\nSOURCE MATERIAL END\n\nCreate five material-grounded MCQs now.`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "study_mcqs",
        strict: true,
        schema: mcqSchema,
      },
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
