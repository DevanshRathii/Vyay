import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Vyay's ledger doesn't track anything before this date — Gmail's initial
 *  sync anchors here (`buildQuery` in src/lib/gmail/sync.ts) and every
 *  import path (bank statements, historical SMS) enforces the same floor,
 *  rejecting rather than silently importing older rows. Shared so the two
 *  never drift apart. */
export const TRACKING_BASELINE_MS = Date.UTC(2026, 0, 1) - IST_OFFSET_MS;

/** Format paise as ₹1,23,456.78 (Indian digit grouping). */
export function formatINR(paise: number, opts: { compact?: boolean } = {}): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: rupees % 1 === 0 ? 0 : 2,
    notation: opts.compact ? "compact" : "standard",
  }).format(rupees);
}

/** YYYY-MM-DD key in IST — used for server-side analytics bucketing. */
export function istDateKey(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** YYYY-MM key in IST. */
export function istMonthKey(ms: number): string {
  return istDateKey(ms).slice(0, 7);
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Run `fn` over `items` with bounded concurrency. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
      // Yield to the event loop after each item — fn often does synchronous
      // CPU work (regex parsing, sync DB writes) that would otherwise starve
      // the HTTP server for the whole duration of a large batch.
      await sleep(0);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
