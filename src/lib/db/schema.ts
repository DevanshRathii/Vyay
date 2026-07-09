import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { randomUUID } from "crypto";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID());

/** Epoch milliseconds. Deliberately bigint-as-number, not a native timestamp. */
const epochMs = (name: string) => bigint(name, { mode: "number" });

const now = () =>
  epochMs("created_at")
    .notNull()
    .$defaultFn(() => Date.now());

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name"),
  image: text("image"),
  createdAt: now(),
});

export const gmailConnections = pgTable("gmail_connections", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  emailAddress: text("email_address").notNull(),
  /** AES-256-GCM encrypted */
  accessToken: text("access_token").notNull(),
  /** AES-256-GCM encrypted */
  refreshToken: text("refresh_token").notNull(),
  expiryDate: epochMs("expiry_date"),
  /** Gmail historyId checkpoint for incremental sync */
  historyId: text("history_id"),
  lastSyncAt: epochMs("last_sync_at"),
  initialSyncDone: boolean("initial_sync_done").notNull().default(false),
  syncStatus: text("sync_status").notNull().default("idle"), // idle | syncing | error
  syncError: text("sync_error"),
  /** Set when the sync lock is acquired; a stale "syncing" row (crashed
   *  serverless invocation) is reclaimable after STALE_SYNC_MS. */
  syncStartedAt: epochMs("sync_started_at"),
  syncProgressPhase: text("sync_progress_phase"), // listing | ingesting
  syncProgressDone: integer("sync_progress_done"),
  syncProgressTotal: integer("sync_progress_total"),
  /** running counters for the settings page */
  totalSynced: integer("total_synced").notNull().default(0),
  createdAt: now(),
});

export const categories = pgTable(
  "categories",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#8e8e93"),
    createdAt: now(),
  },
  (t) => [uniqueIndex("categories_user_name_idx").on(t.userId, t.name)],
);

export const transactions = pgTable(
  "transactions",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** null for manual/seed transactions */
    gmailMessageId: text("gmail_message_id"),
    source: text("source").notNull().default("gmail"), // gmail | manual | seed
    /** transaction time, ms epoch */
    occurredAt: epochMs("occurred_at").notNull(),
    /** stored in paise to avoid floating point issues; bigint so very large transfers fit */
    amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("INR"),
    direction: text("direction").notNull(), // debit | credit
    merchant: text("merchant"),
    merchantNormalized: text("merchant_normalized"),
    channel: text("channel"), // UPI | Card | IMPS | NEFT | RTGS | Wallet | ATM | NetBanking | Other
    bank: text("bank"),
    referenceNumber: text("reference_number"),
    upiId: text("upi_id"),
    cardLast4: text("card_last4"),
    emailSubject: text("email_subject"),
    confidence: doublePrecision("confidence"),
    categoryId: text("category_id").references(() => categories.id, { onDelete: "set null" }),
    notes: text("notes"),
    /** original parse payload, JSON — kept for future re-parsing */
    raw: text("raw"),
    /** id of the transaction this one appears to duplicate */
    duplicateOfId: text("duplicate_of_id"),
    deletedAt: epochMs("deleted_at"),
    createdAt: now(),
    updatedAt: epochMs("updated_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (t) => [
    uniqueIndex("txn_user_gmail_idx").on(t.userId, t.gmailMessageId),
    index("txn_user_time_idx").on(t.userId, t.occurredAt),
    index("txn_user_amount_idx").on(t.userId, t.amountPaise),
    index("txn_user_category_idx").on(t.userId, t.categoryId),
  ],
);

export const merchantRules = pgTable(
  "merchant_rules",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** lowercase substring matched against merchant/UPI id/subject */
    pattern: text("pattern").notNull(),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    createdAt: now(),
  },
  (t) => [index("rules_user_idx").on(t.userId)],
);

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** display name, as saved in the imported vCard */
    name: text("name").notNull(),
    /** normalizeMerchant(name) — matched against extracted merchant text */
    nameNormalized: text("name_normalized").notNull(),
    /** JSON array of phone numbers normalized to their last 10 digits */
    phones: text("phones").notNull().default("[]"),
    /** JSON array of email addresses, lowercased — matched by local-part against a UPI id */
    emails: text("emails").notNull().default("[]"),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex("contacts_user_name_idx").on(t.userId, t.nameNormalized),
    index("contacts_user_idx").on(t.userId),
  ],
);

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull().default("Apple Shortcut"),
    /** sha256 hex of the token — plaintext is shown once and never stored */
    tokenHash: text("token_hash").notNull().unique(),
    lastUsedAt: epochMs("last_used_at"),
    createdAt: now(),
  },
  (t) => [index("tokens_user_idx").on(t.userId)],
);

export const shortcutEvents = pgTable(
  "shortcut_events",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
    direction: text("direction").notNull().default("debit"),
    categoryId: text("category_id").references(() => categories.id, { onDelete: "set null" }),
    categoryName: text("category_name").notNull(),
    notes: text("notes"),
    status: text("status").notNull().default("pending"), // pending | matched | resolved | dismissed
    matchedTransactionId: text("matched_transaction_id"),
    createdAt: now(),
  },
  (t) => [index("shortcut_user_idx").on(t.userId, t.status)],
);

export type User = typeof users.$inferSelect;
export type GmailConnection = typeof gmailConnections.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type MerchantRule = typeof merchantRules.$inferSelect;
export type ApiToken = typeof apiTokens.$inferSelect;
export type ShortcutEvent = typeof shortcutEvents.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
