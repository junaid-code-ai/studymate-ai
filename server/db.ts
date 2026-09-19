import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { documents, InsertDocument, users, InsertUser } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  type TextField = (typeof textFields)[number];

  const assignNullable = (field: TextField) => {
    const value = user[field];
    if (value === undefined) return;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  };

  textFields.forEach(assignNullable);

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createDocument(input: InsertDocument) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.insert(documents).values(input);
  const result = await db.select().from(documents).where(eq(documents.fileKey, input.fileKey)).limit(1);
  if (!result[0]) throw new Error("Document was not created");
  return result[0];
}

export async function listDocumentsForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: documents.id,
      fileName: documents.fileName,
      fileSize: documents.fileSize,
      summary: documents.summary,
      mcqsJson: documents.mcqsJson,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(eq(documents.userId, userId))
    .orderBy(desc(documents.createdAt));
}

export async function getDocumentForUser(documentId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
    .limit(1);
  return result[0];
}

export async function updateDocumentSummary(documentId: number, summary: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.update(documents).set({ summary }).where(eq(documents.id, documentId));
}

export async function updateDocumentMcqs(documentId: number, mcqsJson: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  await db.update(documents).set({ mcqsJson }).where(eq(documents.id, documentId));
}
