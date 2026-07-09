import { syncAllUsers } from "@/lib/gmail/sync";

/**
 * Background Gmail sync loop — self-host only. On Vercel there is no
 * persistent process to hold a setInterval, and the platform's own cron
 * (vercel.json → /api/cron/sync) drives syncing instead, so this is
 * unconditionally disabled when process.env.VERCEL is set.
 */
const minutes = Number(process.env.SYNC_INTERVAL_MINUTES ?? 15);
const g = globalThis as unknown as { __vyaySyncTimer?: ReturnType<typeof setInterval> };

if (!process.env.VERCEL && minutes > 0 && !g.__vyaySyncTimer) {
  g.__vyaySyncTimer = setInterval(
    () => {
      syncAllUsers().catch((err) => console.error("[vyay] background sync error:", err));
    },
    minutes * 60 * 1000,
  );
  console.log(`[vyay] background Gmail sync every ${minutes} min`);
}
