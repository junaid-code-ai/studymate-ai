import { int, mediumtext, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing the existing Manus auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Study materials are always owned by exactly one authenticated user.
 * PDF bytes live in managed storage; this table stores metadata, extracted text,
 * and generated study outputs.
 */
export const documents = mysqlTable("documents", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  fileKey: varchar("fileKey", { length: 512 }).notNull().unique(),
  fileUrl: varchar("fileUrl", { length: 1024 }).notNull(),
  fileSize: int("fileSize").notNull(),
  extractedText: mediumtext("extractedText"),
  summary: mediumtext("summary"),
  mcqsJson: mediumtext("mcqsJson"),
  processingStatus: varchar("processingStatus", { length: 32 }).default("uploaded").notNull(),
  processingError: text("processingError"),
  processingStartedAt: timestamp("processingStartedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Document = typeof documents.$inferSelect;
export type InsertDocument = typeof documents.$inferInsert;

export type Mcq = {
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
};
