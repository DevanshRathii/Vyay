import { eq, inArray } from "drizzle-orm";
import type { gmail_v1 } from "@googleapis/gmail";
import { db } from "@/lib/db";
import { gmailConnections, transactions, type GmailConnection } from "@/lib/db/schema";
import { loadCategorizerContext } from "@/lib/categorize";
import { loadContactContext } from "@/lib/contacts/match";
import { ingestEmail } from "@/lib/ingest";
import { looksRelevant, senderQuery } from "@/lib/parsing/providers";
import { chunk, mapLimit, sleep } from "@/lib/utils";
import { gmailFor } from "./client";
import { headerFromMetadata, toEmailMessage } from "./fetch";

export interface SyncSummary {
  fetched: number;
  inserted: number;
  skipped: number;
  mode: "initial" | "incremental" | "fallback";
}

// One sync at a time per user (in-memory; fine for a single-node self-host).
const locks = new Map<string, Promise<SyncSummary>>();

export interface SyncProgress {
  phase: "listing" | "ingesting";
  processed: number;
  total: number;
}

// Live progress for the in-flight sync, if any (in-memory, same lifetime as `locks`).
const progress = new Map<string, SyncProgress>();

/** Read-only snapshot of a user's in-flight sync progress, for the status endpoint. */
export function getSyncProgress(userId: string): SyncProgress | null {
  return progress.get(userId) ?? null;
}

const CONCURRENCY = 4;

/** Retry Gmail API calls on rate-limit / transient server errors. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { code?: number; response?: { status?: number } })?.code ??
        (err as { response?: { status?: number } })?.response?.status;
      if (status === 429 || status === 500 || status === 503 || status === 403) {
        await sleep(500 * 2 ** i + Math.random() * 250);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

/** Fixed anchor for a brand-new connection's first sync: 1-Jan-2026, 00:00 IST. */
const INITIAL_SYNC_START_UNIX_SEC = Math.floor((Date.UTC(2026, 0, 1) - 5.5 * 60 * 60 * 1000) / 1000);

function buildQuery(opts: { afterUnixSec?: number } = {}): string {
  const parts = [senderQuery()];
  if (opts.afterUnixSec) {
    parts.push(`after:${opts.afterUnixSec}`);
  } else if (process.env.SYNC_LOOKBACK_MONTHS) {
    const months = Number(process.env.SYNC_LOOKBACK_MONTHS);
    parts.push(`newer_than:${Math.max(1, months * 30)}d`);
  } else {
    parts.push(`after:${INITIAL_SYNC_START_UNIX_SEC}`);
  }
  const extra = process.env.EXTRA_GMAIL_QUERY?.trim();
  if (extra) parts.push(extra);
  return parts.join(" ");
}

/** Filter out message ids we've already stored (chunked to stay under SQLite's variable limit). */
function unseenIds(userId: string, ids: string[]): string[] {
  const seen = new Set<string>();
  for (const part of chunk(ids, 400)) {
    const rows = db
      .select({ id: transactions.gmailMessageId })
      .from(transactions)
      .where(inArray(transactions.gmailMessageId, part))
      .all();
    rows.forEach((r) => r.id && seen.add(r.id));
  }
  return ids.filter((id) => !seen.has(id));
}

async function fetchAndIngest(
  gmail: gmail_v1.Gmail,
  userId: string,
  ids: string[],
): Promise<{ inserted: number; skipped: number }> {
  const ctx = loadCategorizerContext(userId);
  const contactCtx = loadContactContext(userId);
  let inserted = 0;
  let skipped = 0;
  let processed = 0;
  progress.set(userId, { phase: "ingesting", processed: 0, total: ids.length });
  await mapLimit(ids, CONCURRENCY, async (id) => {
    const res = await withRetry(() => gmail.users.messages.get({ userId: "me", id, format: "full" }));
    const email = toEmailMessage(res.data);
    const outcome = ingestEmail(userId, email, ctx, contactCtx);
    if (outcome.status === "inserted") inserted++;
    else skipped++;
    processed++;
    progress.set(userId, { phase: "ingesting", processed, total: ids.length });
  });
  return { inserted, skipped };
}

async function fullSync(
  gmail: gmail_v1.Gmail,
  conn: GmailConnection,
  opts: { afterUnixSec?: number } = {},
): Promise<SyncSummary> {
  // Capture the history checkpoint BEFORE listing, so nothing arriving during
  // the sync is missed by the next incremental run.
  const profile = await withRetry(() => gmail.users.getProfile({ userId: "me" }));
  const newHistoryId = profile.data.historyId ?? null;

  const q = buildQuery(opts);
  const maxTotal = Number(process.env.SYNC_MAX_INITIAL_MESSAGES ?? 3000);
  const ids: string[] = [];
  let pageToken: string | undefined;
  progress.set(conn.userId, { phase: "listing", processed: 0, total: 0 });
  do {
    const res = await withRetry(() =>
      gmail.users.messages.list({ userId: "me", q, maxResults: 100, pageToken }),
    );
    res.data.messages?.forEach((m) => m.id && ids.push(m.id));
    pageToken = res.data.nextPageToken ?? undefined;
    progress.set(conn.userId, { phase: "listing", processed: ids.length, total: 0 });
  } while (pageToken && ids.length < maxTotal);

  const fresh = unseenIds(conn.userId, ids.slice(0, maxTotal));
  const { inserted, skipped } = await fetchAndIngest(gmail, conn.userId, fresh);

  db.update(gmailConnections)
    .set({
      historyId: newHistoryId,
      lastSyncAt: Date.now(),
      initialSyncDone: 1,
      totalSynced: (conn.totalSynced ?? 0) + inserted,
    })
    .where(eq(gmailConnections.id, conn.id))
    .run();

  return { fetched: fresh.length, inserted, skipped, mode: opts.afterUnixSec ? "fallback" : "initial" };
}

async function incrementalSync(gmail: gmail_v1.Gmail, conn: GmailConnection): Promise<SyncSummary> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  let latestHistoryId: string | null = conn.historyId;

  progress.set(conn.userId, { phase: "listing", processed: 0, total: 0 });
  try {
    do {
      const res = await withRetry(() =>
        gmail.users.history.list({
          userId: "me",
          startHistoryId: conn.historyId!,
          historyTypes: ["messageAdded"],
          maxResults: 100,
          pageToken,
        }),
      );
      latestHistoryId = res.data.historyId ?? latestHistoryId;
      for (const h of res.data.history ?? []) {
        for (const added of h.messagesAdded ?? []) {
          if (added.message?.id) ids.push(added.message.id);
        }
      }
      pageToken = res.data.nextPageToken ?? undefined;
      progress.set(conn.userId, { phase: "listing", processed: ids.length, total: 0 });
    } while (pageToken);
  } catch (err) {
    const status = (err as { code?: number; response?: { status?: number } })?.code ??
      (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) {
      // historyId expired — fall back to a query sync from the last checkpoint.
      const afterSec = Math.floor(((conn.lastSyncAt ?? Date.now()) - 24 * 3600 * 1000) / 1000);
      return fullSync(gmail, conn, { afterUnixSec: afterSec });
    }
    throw err;
  }

  const fresh = unseenIds(conn.userId, Array.from(new Set(ids)));

  // Cheap metadata pre-filter so a busy inbox doesn't trigger full fetches
  // for every personal email.
  const relevant: string[] = [];
  let filtered = 0;
  progress.set(conn.userId, { phase: "listing", processed: 0, total: fresh.length });
  await mapLimit(fresh, CONCURRENCY, async (id) => {
    const res = await withRetry(() =>
      gmail.users.messages.get({
        userId: "me",
        id,
        format: "metadata",
        metadataHeaders: ["From", "Subject"],
      }),
    );
    const { from, subject } = headerFromMetadata(res.data);
    if (looksRelevant(from, subject)) relevant.push(id);
    filtered++;
    progress.set(conn.userId, { phase: "listing", processed: filtered, total: fresh.length });
  });

  const { inserted, skipped } = await fetchAndIngest(gmail, conn.userId, relevant);

  db.update(gmailConnections)
    .set({
      historyId: latestHistoryId,
      lastSyncAt: Date.now(),
      totalSynced: (conn.totalSynced ?? 0) + inserted,
    })
    .where(eq(gmailConnections.id, conn.id))
    .run();

  return { fetched: relevant.length, inserted, skipped, mode: "incremental" };
}

/**
 * Sync one user's mailbox. Concurrent calls for the same user share a single
 * in-flight sync. Status is reflected on the connection row for the UI.
 */
export async function syncUser(userId: string, opts: { full?: boolean } = {}): Promise<SyncSummary> {
  const existing = locks.get(userId);
  if (existing) return existing;

  const run = (async (): Promise<SyncSummary> => {
    const conn = db.select().from(gmailConnections).where(eq(gmailConnections.userId, userId)).get();
    if (!conn) throw new Error("Gmail is not connected.");

    db.update(gmailConnections)
      .set({ syncStatus: "syncing", syncError: null })
      .where(eq(gmailConnections.id, conn.id))
      .run();
    try {
      const gmail = gmailFor(conn);
      const summary =
        !conn.historyId || !conn.initialSyncDone || opts.full
          ? await fullSync(gmail, conn)
          : await incrementalSync(gmail, conn);
      db.update(gmailConnections)
        .set({ syncStatus: "idle" })
        .where(eq(gmailConnections.id, conn.id))
        .run();
      return summary;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed.";
      db.update(gmailConnections)
        .set({ syncStatus: "error", syncError: message.slice(0, 500) })
        .where(eq(gmailConnections.id, conn.id))
        .run();
      throw err;
    } finally {
      locks.delete(userId);
      progress.delete(userId);
    }
  })();

  locks.set(userId, run);
  return run;
}

/** Background sweep: incremental sync for every connected account. */
export async function syncAllUsers(): Promise<void> {
  const conns = db.select().from(gmailConnections).all();
  for (const conn of conns) {
    try {
      await syncUser(conn.userId);
    } catch (err) {
      console.error(`[vyay] background sync failed for user ${conn.userId}:`, err);
    }
  }
}
