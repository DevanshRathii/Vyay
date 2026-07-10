import { and, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
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

/** Thrown when another invocation already holds this user's sync lock. Not a failure. */
export class SyncInProgressError extends Error {}

// A "syncing" row older than this is assumed to belong to a crashed/killed
// serverless invocation and can be reclaimed by a fresh sync.
const STALE_SYNC_MS = 10 * 60 * 1000;

// A single sync invocation stops cleanly at this point, leaving headroom
// under Vercel's 300s maxDuration. Without this, a large initial sync (many
// hundreds of messages) gets hard-killed mid-flight by the platform: no
// graceful error, no completion, syncStatus stuck at "syncing" until the
// staleness window passes. Stopping early is safe — ingestion is idempotent
// (unique (userId, gmailMessageId) index), so unprocessed ids are simply
// picked up by the next sync attempt via unseenIds() filtering.
const SYNC_TIME_BUDGET_MS = 250_000;

// Progress writes are throttled (by item count) to avoid one DB round trip
// per ingested message across a 3000-message initial sync.
const PROGRESS_WRITE_EVERY = 20;

type ProgressPhase = "listing" | "ingesting";

/** Persist live progress for the status endpoint's polling. Best-effort. */
async function setProgress(connId: string, phase: ProgressPhase, processed: number, total: number): Promise<void> {
  await db
    .update(gmailConnections)
    .set({ syncProgressPhase: phase, syncProgressDone: processed, syncProgressTotal: total })
    .where(eq(gmailConnections.id, connId));
}

function shouldWriteProgress(processed: number, total: number): boolean {
  return processed === total || processed % PROGRESS_WRITE_EVERY === 0;
}

// Gmail's per-user quota (250 units/s; messages.get costs 5 units) allows far
// more than this sustained — headroom is intentional, not a bottleneck.
const CONCURRENCY = 10;

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

/** Filter out message ids we've already stored (chunked to keep parameter counts sane). */
export async function unseenIds(userId: string, ids: string[]): Promise<string[]> {
  const seen = new Set<string>();
  for (const part of chunk(ids, 400)) {
    const rows = await db
      .select({ id: transactions.gmailMessageId })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), inArray(transactions.gmailMessageId, part)));
    rows.forEach((r) => r.id && seen.add(r.id));
  }
  return ids.filter((id) => !seen.has(id));
}

async function fetchAndIngest(
  gmail: gmail_v1.Gmail,
  conn: GmailConnection,
  ids: string[],
  deadline: number,
): Promise<{ inserted: number; skipped: number; complete: boolean }> {
  const ctx = await loadCategorizerContext(conn.userId);
  const contactCtx = await loadContactContext(conn.userId);
  let inserted = 0;
  let skipped = 0;
  let processed = 0;
  let complete = true;
  await setProgress(conn.id, "ingesting", 0, ids.length);
  await mapLimit(ids, CONCURRENCY, async (id) => {
    if (Date.now() > deadline) {
      // Out of time for this invocation. Leave this message for the next
      // sync attempt — it was never inserted, so unseenIds() will surface
      // it again; nothing needs undoing.
      complete = false;
      return;
    }
    const res = await withRetry(() => gmail.users.messages.get({ userId: "me", id, format: "full" }));
    const email = toEmailMessage(res.data);
    const outcome = await ingestEmail(conn.userId, email, ctx, contactCtx);
    if (outcome.status === "inserted") inserted++;
    else skipped++;
    processed++;
    if (shouldWriteProgress(processed, ids.length)) await setProgress(conn.id, "ingesting", processed, ids.length);
  });
  return { inserted, skipped, complete };
}

async function fullSync(
  gmail: gmail_v1.Gmail,
  conn: GmailConnection,
  deadline: number,
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
  let listTimedOut = false;
  await setProgress(conn.id, "listing", 0, 0);
  do {
    if (Date.now() > deadline) {
      listTimedOut = true;
      break;
    }
    const res = await withRetry(() =>
      gmail.users.messages.list({ userId: "me", q, maxResults: 100, pageToken }),
    );
    res.data.messages?.forEach((m) => m.id && ids.push(m.id));
    pageToken = res.data.nextPageToken ?? undefined;
    await setProgress(conn.id, "listing", ids.length, 0);
  } while (pageToken && ids.length < maxTotal);

  const fresh = await unseenIds(conn.userId, ids.slice(0, maxTotal));
  const { inserted, skipped, complete: ingestComplete } = await fetchAndIngest(gmail, conn, fresh, deadline);
  // Hitting maxTotal is an intentional cap, not a time-out — only a genuine
  // deadline hit (listing or ingesting) should keep initialSyncDone false so
  // the next sync attempt tries fullSync again instead of switching to
  // incremental-only coverage.
  const complete = !listTimedOut && ingestComplete;

  await db
    .update(gmailConnections)
    .set({
      historyId: newHistoryId,
      lastSyncAt: Date.now(),
      initialSyncDone: complete,
      totalSynced: (conn.totalSynced ?? 0) + inserted,
    })
    .where(eq(gmailConnections.id, conn.id));

  return { fetched: fresh.length, inserted, skipped, mode: opts.afterUnixSec ? "fallback" : "initial" };
}

async function incrementalSync(gmail: gmail_v1.Gmail, conn: GmailConnection, deadline: number): Promise<SyncSummary> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  let latestHistoryId: string | null = conn.historyId;

  await setProgress(conn.id, "listing", 0, 0);
  try {
    do {
      if (Date.now() > deadline) break; // resume from latestHistoryId next time
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
      await setProgress(conn.id, "listing", ids.length, 0);
    } while (pageToken);
  } catch (err) {
    const status = (err as { code?: number; response?: { status?: number } })?.code ??
      (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) {
      // historyId expired — fall back to a query sync from the last checkpoint.
      const afterSec = Math.floor(((conn.lastSyncAt ?? Date.now()) - 24 * 3600 * 1000) / 1000);
      return fullSync(gmail, conn, deadline, { afterUnixSec: afterSec });
    }
    throw err;
  }

  const fresh = await unseenIds(conn.userId, Array.from(new Set(ids)));

  // Cheap metadata pre-filter so a busy inbox doesn't trigger full fetches
  // for every personal email.
  const relevant: string[] = [];
  let filtered = 0;
  await setProgress(conn.id, "listing", 0, fresh.length);
  await mapLimit(fresh, CONCURRENCY, async (id) => {
    if (Date.now() > deadline) return; // still in `fresh` — picked up again next time
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
    if (shouldWriteProgress(filtered, fresh.length)) await setProgress(conn.id, "listing", filtered, fresh.length);
  });

  const { inserted, skipped } = await fetchAndIngest(gmail, conn, relevant, deadline);

  await db
    .update(gmailConnections)
    .set({
      historyId: latestHistoryId,
      lastSyncAt: Date.now(),
      totalSynced: (conn.totalSynced ?? 0) + inserted,
    })
    .where(eq(gmailConnections.id, conn.id));

  return { fetched: relevant.length, inserted, skipped, mode: "incremental" };
}

/**
 * Sync one user's mailbox. The lock is a DB row, not in-memory state, so it
 * holds correctly across separate serverless invocations. A "syncing" row
 * older than STALE_SYNC_MS is treated as abandoned (crashed invocation) and
 * reclaimed rather than wedging the account forever.
 */
export async function syncUser(userId: string, opts: { full?: boolean } = {}): Promise<SyncSummary> {
  const existing = (
    await db.select().from(gmailConnections).where(eq(gmailConnections.userId, userId)).limit(1)
  )[0];
  if (!existing) throw new Error("Gmail is not connected.");

  const acquired = (
    await db
      .update(gmailConnections)
      .set({
        syncStatus: "syncing",
        syncError: null,
        syncStartedAt: Date.now(),
        syncProgressPhase: null,
        syncProgressDone: null,
        syncProgressTotal: null,
      })
      .where(
        and(
          eq(gmailConnections.id, existing.id),
          or(
            ne(gmailConnections.syncStatus, "syncing"),
            isNull(gmailConnections.syncStartedAt),
            lt(gmailConnections.syncStartedAt, Date.now() - STALE_SYNC_MS),
          ),
        ),
      )
      .returning()
  )[0];
  if (!acquired) {
    throw new SyncInProgressError("A sync is already in progress for this account.");
  }

  const deadline = Date.now() + SYNC_TIME_BUDGET_MS;
  try {
    const gmail = gmailFor(acquired);
    const summary =
      !acquired.historyId || !acquired.initialSyncDone || opts.full
        ? await fullSync(gmail, acquired, deadline)
        : await incrementalSync(gmail, acquired, deadline);
    await db
      .update(gmailConnections)
      .set({ syncStatus: "idle", syncStartedAt: null })
      .where(eq(gmailConnections.id, acquired.id));
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed.";
    await db
      .update(gmailConnections)
      .set({ syncStatus: "error", syncError: message.slice(0, 500), syncStartedAt: null })
      .where(eq(gmailConnections.id, acquired.id));
    throw err;
  }
}

/** Background sweep: incremental sync for every connected account. */
export async function syncAllUsers(): Promise<void> {
  const conns = await db.select().from(gmailConnections);
  for (const conn of conns) {
    try {
      await syncUser(conn.userId);
    } catch (err) {
      if (!(err instanceof SyncInProgressError)) {
        console.error(`[vyay] background sync failed for user ${conn.userId}:`, err);
      }
    }
  }
}

/** Cron sweep helper: connections ordered oldest-synced-first (never-synced first). */
export async function connectionsOldestFirst(): Promise<{ userId: string }[]> {
  return db
    .select({ userId: gmailConnections.userId })
    .from(gmailConnections)
    .orderBy(sql`${gmailConnections.lastSyncAt} asc nulls first`);
}
