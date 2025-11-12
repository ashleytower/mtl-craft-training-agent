import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
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
 * Cocktail recipes with full details
 */
export const cocktails = mysqlTable("cocktails", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  nameEnglish: varchar("nameEnglish", { length: 255 }),
  descriptionEnglish: text("descriptionEnglish"),
  descriptionFrench: text("descriptionFrench"),
  funFacts: text("funFacts"),
  method: text("method").notNull(),
  glassType: varchar("glassType", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Cocktail = typeof cocktails.$inferSelect;
export type InsertCocktail = typeof cocktails.$inferInsert;

/**
 * Ingredients for each cocktail recipe
 */
export const ingredients = mysqlTable("ingredients", {
  id: int("id").autoincrement().primaryKey(),
  cocktailId: int("cocktailId").notNull(),
  type: varchar("type", { length: 50 }).notNull(), // alcool, syrup, juice, garnish, soda, others, glass
  withAlcohol: boolean("withAlcohol").default(true).notNull(),
  amount: varchar("amount", { length: 50 }), // e.g., "2", "0.75"
  unit: varchar("unit", { length: 50 }), // oz, splash, garnish, glass, etc.
  ingredient: varchar("ingredient", { length: 255 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Ingredient = typeof ingredients.$inferSelect;
export type InsertIngredient = typeof ingredients.$inferInsert;

/**
 * Packing checklist categories and items for workshops
 */
export const packingItems = mysqlTable("packingItems", {
  id: int("id").autoincrement().primaryKey(),
  category: varchar("category", { length: 100 }).notNull(), // BAR ITEMS, COCKTAIL STUFF, MATERIALS, WOOD CRATE
  itemName: varchar("itemName", { length: 255 }).notNull(),
  quantityFormula: text("quantityFormula"), // e.g., "1 per person + 1", "2", "1 per 5 people"
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PackingItem = typeof packingItems.$inferSelect;
export type InsertPackingItem = typeof packingItems.$inferInsert;

/**
 * Chat conversations for voice interactions
 */
export const conversations = mysqlTable("conversations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  title: varchar("title", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = typeof conversations.$inferInsert;

/**
 * Individual messages in conversations
 */
export const messages = mysqlTable("messages", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull(),
  role: mysqlEnum("role", ["user", "assistant", "system"]).notNull(),
  content: text("content").notNull(),
  audioUrl: text("audioUrl"), // URL to stored audio file if voice message
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;
