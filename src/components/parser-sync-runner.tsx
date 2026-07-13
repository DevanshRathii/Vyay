"use client";

import { useEffect, useRef } from "react";
import { useE2E } from "@/components/e2e-provider";
import { runClientParserSync } from "@/lib/parser-sync";

/**
 * Invisible, silent background job — no UI, no user-facing "keyed" concept,
 * no confirmation needed. Mounted once inside KeyProvider's children (real
 * (app) pages only, never /demo), so by the time this renders the account
 * is always unlocked. On mount, asks the server whether this account's
 * ledger predates the current parsing/categorization logic
 * (PARSER_VERSION, src/lib/parser-version.ts) and if so reprocesses it:
 * client-side (decrypt → reparse → reseal) since the server can never read
 * a keyed account's sealed raw email itself. This is what makes a fix like
 * "Canara Bank extracted zero merchants" actually reach an already-affected
 * user without them doing anything — same idea as the existing "Re-parse"
 * button, just automatic and running over already-sealed data.
 */
export function ParserSyncRunner() {
  const e2e = useE2E();
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/parser-sync/status");
        if (!res.ok) return;
        const { needsSync, keyed } = (await res.json()) as { needsSync: boolean; keyed: boolean };
        if (!needsSync) return;
        if (keyed) {
          await runClientParserSync({ decrypt: e2e.decrypt, seal: e2e.seal });
          await fetch("/api/parser-sync/complete", { method: "POST" });
        } else {
          // Defensive fallback only — this subtree never actually renders
          // for a non-keyed session (KeyProvider blocks on setup first).
          await fetch("/api/parser-sync/run", { method: "POST" });
        }
      } catch {
        // Best-effort background job — a failure here just means retry on
        // the next page load; never worth surfacing to the user.
      }
    })();
  }, [e2e]);

  return null;
}
