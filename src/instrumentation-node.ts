import { syncAllUsers } from "@/lib/gmail/sync";

/**
 * Background Gmail sync loop. Serverless deployments should disable this
 * (SYNC_INTERVAL_MINUTES=0) and use an external cron hitting /api/gmail/sync.
 */
const minutes = Number(process.env.SYNC_INTERVAL_MINUTES ?? 15);
const g = globalThis as unknown as { __vyaySyncTimer?: ReturnType<typeof setInterval> };

if (minutes > 0 && !g.__vyaySyncTimer) {
  g.__vyaySyncTimer = setInterval(
    () => {
      syncAllUsers().catch((err) => console.error("[vyay] background sync error:", err));
    },
    minutes * 60 * 1000,
  );
  console.log(`[vyay] background Gmail sync every ${minutes} min`);
}
