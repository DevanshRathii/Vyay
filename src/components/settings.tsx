"use client";

import {
  Check,
  Copy,
  Download,
  History,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  Plus,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  Unplug,
  Wand2,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import { Suspense, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { ThemeToggle } from "@/components/nav";
import { StatementImportCard } from "@/components/statement-import";
import { ActionMenu, ActionMenuItem, Button, Card, CardHeader, ConfirmButton, Input, Label, Spinner } from "@/components/ui";
import { generateKeypair, makeKeyCheck } from "@/lib/e2e-crypto";
import { useE2EOptional } from "@/components/e2e-provider";
import { offerToSaveCredential } from "@/lib/key-store";
import { buildLedgerWorkbook, exportFilename, type ExportRow } from "@/lib/export-core";
import { useTransactions } from "@/lib/use-transactions";
import { PROVIDERS } from "@/lib/parsing/providers";

// Banks first, then wallets/UPI apps (providers with no `bank` field) — all
// selected by default, so doing nothing on this picker means "all providers".
const BANK_PROVIDERS = PROVIDERS.filter((p) => p.bank);
const WALLET_PROVIDERS = PROVIDERS.filter((p) => !p.bank);
const ALL_PROVIDER_IDS = PROVIDERS.map((p) => p.id);

// A large initial sync can need several passes under Vercel's 300s function
// ceiling. Auto-continue this many times before asking the user to resume
// manually, so "5 clicks" usually becomes "1 click, watch the bar".
const AUTO_CONTINUE_LIMIT = 6;

interface GmailStatus {
  oauthConfigured: boolean;
  gmailAccessGranted: boolean;
  connected: boolean;
  emailAddress: string | null;
  syncStatus: "idle" | "syncing" | "error" | null;
  syncError: string | null;
  lastSyncAt: number | null;
  initialSyncDone: boolean;
  totalSynced: number;
  syncProgress: { phase: "listing" | "ingesting"; processed: number; total: number } | null;
  /** null = every provider in the registry is being watched */
  selectedProviders: string[] | null;
}

interface TokenRow {
  id: string;
  label: string;
  lastUsedAt: number | null;
  createdAt: number;
}

function syncLabel(p: GmailStatus["syncProgress"]): string {
  if (!p) return "Fetching messages…";
  if (p.phase === "listing") {
    if (p.total > 0) return `Checking ${p.processed}/${p.total}…`;
    if (p.processed > 0) return `Found ${p.processed} messages…`;
    return "Fetching messages…";
  }
  return p.total > 0 ? `Syncing… ${p.processed}/${p.total}` : "Fetching messages…";
}

function fmt(ms: number | null) {
  if (!ms) return "never";
  return new Date(ms).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

// ── Provider picker ─────────────────────────────────────────────────────────
// Shown pre-connect: narrows which banks/apps the sync query looks for. All
// are pre-checked; skipping this (leaving everything checked) means "all
// providers", same as never having picked anything.

function ProviderPicker({ selected, onToggle }: { selected: Set<string>; onToggle: (id: string) => void }) {
  return (
    <div className="rounded-xl border border-line p-3.5">
      <p className="mb-2 text-[12px] font-medium text-muted">
        Which banks and apps should Vyay look for? All are selected by default — narrowing this can speed up
        your first sync. You can change this later by disconnecting and reconnecting.
      </p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3">
        {[...BANK_PROVIDERS, ...WALLET_PROVIDERS].map((p) => (
          <label key={p.id} className="flex items-center gap-1.5 text-[13px]">
            <input
              type="checkbox"
              checked={selected.has(p.id)}
              onChange={() => onToggle(p.id)}
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            {p.name}
          </label>
        ))}
      </div>
    </div>
  );
}

// ── Gmail card ──────────────────────────────────────────────────────────────

function GmailCard() {
  const params = useSearchParams();
  const oauthError = params.get("gmail_error");
  const keyed = useE2EOptional()?.status === "ready";
  const { data, mutate } = useSWR<GmailStatus>("/api/gmail/status", {
    refreshInterval: (latest) =>
      latest?.syncStatus === "syncing" || Date.now() < fastPollUntil.current ? 1500 : 30000,
  });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [reparsing, setReparsing] = useState(false);
  const [reparseResult, setReparseResult] = useState<{ scanned: number; updated: number } | null>(null);
  const [showTrustInfo, setShowTrustInfo] = useState(false);
  const [autoContinues, setAutoContinues] = useState(0);
  const [autoContinueExhausted, setAutoContinueExhausted] = useState(false);
  const prevSyncStatus = useRef<GmailStatus["syncStatus"]>(undefined);
  // Bridges the gap between "sync request sent" and the backend actually
  // writing syncStatus:"syncing" to the DB (a real async round trip). Without
  // this, the status poll can land on stale "idle" data right after a click,
  // fall back to its slow 30s interval, and let a rapid second click slip
  // through to a silently-swallowed SyncInProgressError — surfacing as
  // "nothing happened" until the slow poll eventually catches up.
  const fastPollUntil = useRef(0);
  const [selectedProviders, setSelectedProviders] = useState<Set<string>>(() => new Set(ALL_PROVIDER_IDS));

  function toggleProvider(id: string) {
    setSelectedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const connectHref =
    selectedProviders.size === ALL_PROVIDER_IDS.length
      ? "/api/gmail/connect"
      : `/api/gmail/connect?providers=${encodeURIComponent([...selectedProviders].join(","))}`;

  async function syncNow(full = false) {
    setStarting(true);
    setStartError(null);
    fastPollUntil.current = Date.now() + 10_000;
    try {
      const res = await fetch(`/api/gmail/sync${full ? "?full=1" : ""}`, { method: "POST" });
      if (!res.ok) setStartError("Couldn't start sync — try again in a moment.");
    } catch {
      setStartError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setStarting(false);
      mutate();
    }
  }

  function resumeSync() {
    setAutoContinues(0);
    setAutoContinueExhausted(false);
    syncNow(false);
  }

  // When a sync pass finishes (syncing -> idle) but the initial sync still
  // isn't done, kick off the next pass automatically instead of making the
  // user click "Sync now" again.
  useEffect(() => {
    if (!data) return;
    if (data.syncStatus === "syncing") setStartError(null);
    const wasSyncing = prevSyncStatus.current === "syncing";
    prevSyncStatus.current = data.syncStatus;
    if (data.initialSyncDone) {
      setAutoContinues(0);
      setAutoContinueExhausted(false);
      return;
    }
    if (wasSyncing && data.syncStatus === "idle") {
      if (autoContinues < AUTO_CONTINUE_LIMIT) {
        setAutoContinues((c) => c + 1);
        syncNow(false);
      } else {
        setAutoContinueExhausted(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  async function disconnect() {
    const res = await fetch("/api/gmail/disconnect", { method: "POST" });
    mutate();
    if (!res.ok) throw new Error("Couldn't disconnect Gmail — try again.");
  }

  async function reparse() {
    setReparsing(true);
    setReparseResult(null);
    const res = await fetch("/api/transactions/reparse", { method: "POST" });
    if (res.ok) setReparseResult(await res.json());
    setReparsing(false);
  }

  const syncing = data?.syncStatus === "syncing" || starting;

  return (
    <Card data-tour="settings-gmail">
      <CardHeader
        title="Gmail"
        subtitle="Read-only access to transaction emails. Tokens are encrypted at rest."
      />
      <div className="px-5 pb-5 pt-2">
        {!data ? (
          <Spinner />
        ) : !data.oauthConfigured ? (
          <p className="rounded-xl bg-card-2 px-3.5 py-3 text-[13px] text-muted">
            Google OAuth isn&apos;t configured on this server. Set{" "}
            <code className="font-mono text-[12px]">GOOGLE_CLIENT_ID</code> and{" "}
            <code className="font-mono text-[12px]">GOOGLE_CLIENT_SECRET</code> in{" "}
            <code className="font-mono text-[12px]">.env</code> — see the README for the Google Cloud setup steps.
          </p>
        ) : !data.connected && !data.gmailAccessGranted ? (
          <p className="rounded-xl bg-card-2 px-3.5 py-3 text-[13px] text-muted">
            Vyay is invite-only while it&apos;s being tested — the app owner needs to grant Gmail access to your
            account before you can connect. You&apos;ll be able to as soon as that&apos;s done, no action needed
            from you.
          </p>
        ) : !data.connected ? (
          <div className="flex flex-col gap-3">
            {oauthError && (
              <p className="rounded-xl bg-negative/10 px-3.5 py-2.5 text-[13px] text-negative">{oauthError}</p>
            )}
            <p className="text-[13px] text-muted">
              Connect the Gmail account that receives your bank and UPI transaction alerts. Vyay only requests
              read-only access and never modifies or sends email.
            </p>
            <ProviderPicker selected={selectedProviders} onToggle={toggleProvider} />
            <div className="flex flex-wrap items-center gap-2">
              <a href={connectHref}>
                <Button>
                  <Mail className="h-4 w-4" /> Connect Gmail
                </Button>
              </a>
              <button
                type="button"
                onClick={() => setShowTrustInfo((v) => !v)}
                aria-expanded={showTrustInfo}
                className="inline-flex items-center gap-1 text-[12px] text-muted underline decoration-dotted underline-offset-4 hover:text-fg"
              >
                <ShieldCheck className="h-3.5 w-3.5" /> How is my data protected?
              </button>
            </div>
            {showTrustInfo && (
              <p className="rounded-xl bg-card-2 px-3.5 py-3 text-[12px] leading-relaxed text-muted">
                Your Gmail access token is encrypted at rest with AES-256-GCM before it&apos;s stored — it&apos;s
                decrypted only in memory, for the moment Vyay calls the Gmail API. Vyay requests the read-only Gmail
                scope, so it can never send, delete, or modify your email, and it only ever reads messages that look
                like bank or UPI transaction alerts. You can disconnect at any time from this page, which removes
                the stored token immediately (your already-imported transactions are kept).
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[14px] font-medium">{data.emailAddress}</p>
                <p className="mt-0.5 text-[12px] text-muted">
                  {syncing ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Spinner className="h-3 w-3" />
                      {syncLabel(data.syncProgress)}
                    </span>
                  ) : data.syncStatus === "error" ? (
                    <>
                      <span className="text-negative">Last sync failed</span> · {data.totalSynced} imported
                    </>
                  ) : (
                    <>
                      Last sync {fmt(data.lastSyncAt)} · {data.totalSynced} imported
                    </>
                  )}
                </p>
                {syncing && data.syncProgress && data.syncProgress.total > 0 && (
                  <span className="mt-1.5 block h-1 w-40 max-w-full overflow-hidden rounded-full bg-card-2">
                    <span
                      className="block h-full rounded-full bg-accent transition-[width] duration-[400ms] ease-out"
                      style={{ width: `${Math.min(100, (data.syncProgress.processed / data.syncProgress.total) * 100)}%` }}
                    />
                  </span>
                )}
                {syncing && (!data.syncProgress || data.syncProgress.total === 0) && (
                  <span
                    className="animate-shimmer mt-1.5 block h-1 w-40 max-w-full rounded-full"
                    style={{ backgroundImage: "linear-gradient(90deg, var(--card-2) 25%, var(--accent) 50%, var(--card-2) 75%)" }}
                  />
                )}
                <p className="mt-1 text-[11px] text-muted">
                  {data.selectedProviders === null ? (
                    <>Watching all {PROVIDERS.length} banks &amp; payment apps in the registry.</>
                  ) : (
                    <>
                      Watching {data.selectedProviders.length} of {PROVIDERS.length} banks &amp; apps:{" "}
                      {data.selectedProviders.map((id) => PROVIDERS.find((p) => p.id === id)?.name ?? id).join(", ")}.
                      Any other bank, credit card, or payment app won&apos;t be picked up — that&apos;s why sync may
                      have felt faster. Disconnect and reconnect to change this selection.
                    </>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button size="sm" variant="secondary" disabled={syncing} onClick={() => syncNow(false)}>
                  <RefreshCw className={syncing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> Sync now
                </Button>
                <ConfirmButton
                  size="sm"
                  confirmTitle="Disconnect Gmail?"
                  confirmMessage="Your imported transactions are kept — you can reconnect and re-sync at any time."
                  confirmLabel="Disconnect"
                  onConfirm={disconnect}
                >
                  <Unplug className="h-3.5 w-3.5" /> Disconnect
                </ConfirmButton>
                <ActionMenu>
                  <ActionMenuItem disabled={syncing} onClick={() => syncNow(true)}>
                    <RefreshCw className="h-3.5 w-3.5" /> Full resync
                  </ActionMenuItem>
                  {/* Re-parse re-derives fields from the stored raw email, which
                      keyed accounts don't keep in plaintext — Full resync
                      (re-fetch + re-parse + re-seal) covers the same need. */}
                  {!keyed && (
                    <ActionMenuItem disabled={reparsing} onClick={reparse}>
                      <Wand2 className={reparsing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> Re-parse
                    </ActionMenuItem>
                  )}
                </ActionMenu>
              </div>
            </div>
            {startError && (
              <p className="rounded-xl bg-negative/10 px-3.5 py-2.5 text-[12px] text-negative">{startError}</p>
            )}
            {!startError && data.syncStatus === "error" && data.syncError && (
              <p className="rounded-xl bg-negative/10 px-3.5 py-2.5 text-[12px] text-negative">{data.syncError}</p>
            )}
            {!data.initialSyncDone && !syncing && autoContinueExhausted && (
              <p className="rounded-xl bg-card-2 px-3.5 py-2.5 text-[12px] text-muted">
                This sync needs another pass to finish importing everything.{" "}
                <button
                  type="button"
                  className="font-medium text-accent underline underline-offset-2"
                  onClick={resumeSync}
                >
                  Resume sync
                </button>
              </p>
            )}
            {!data.initialSyncDone && !syncing && !autoContinueExhausted && (
              <p className="rounded-xl bg-card-2 px-3.5 py-2.5 text-[12px] text-muted">
                The first sync hasn&apos;t completed yet — hit “Sync now” to start importing.
              </p>
            )}
            {reparsing && (
              <p className="flex items-center gap-1.5 rounded-xl bg-card-2 px-3.5 py-2.5 text-[12px] text-muted">
                <Spinner className="h-3 w-3" /> Re-parsing your transactions…
              </p>
            )}
            {!reparsing && reparseResult && (
              <p className="rounded-xl bg-card-2 px-3.5 py-2.5 text-[12px] text-muted">
                Re-parsed {reparseResult.scanned} transaction{reparseResult.scanned === 1 ? "" : "s"} — updated{" "}
                {reparseResult.updated}. Category and notes you&apos;ve already set are never overwritten.
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// ── API tokens ──────────────────────────────────────────────────────────────

function TokensCard() {
  const { data, mutate } = useSWR<{ rows: TokenRow[] }>("/api/tokens");
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<{ token: string; label: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function create() {
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(label.trim() ? { label: label.trim() } : {}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCreateError(body.error ?? "Couldn't create that token — try again.");
        return;
      }
      setFresh({ token: body.token, label: body.label });
      setLabel("");
      mutate();
    } catch {
      setCreateError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setCreating(false);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/tokens?id=${id}`, { method: "DELETE" });
    mutate();
    if (!res.ok) throw new Error("Couldn't revoke that token — try again.");
  }

  async function copy() {
    if (!fresh) return;
    await navigator.clipboard.writeText(fresh.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card>
      <CardHeader title="API tokens" subtitle="Authenticate the Apple Shortcut endpoint" />
      <div className="flex flex-col gap-3 px-5 pb-5 pt-2">
        {fresh && (
          <div className="rounded-xl border border-accent/40 bg-accent/5 p-3.5">
            <p className="text-[12px] font-medium text-muted">
              Token for “{fresh.label}” — copy it now, it won&apos;t be shown again.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-card px-2.5 py-1.5 font-mono text-[12px]">
                {fresh.token}
              </code>
              <Button size="sm" variant="secondary" onClick={copy}>
                {copied ? <Check className="h-3.5 w-3.5 text-positive" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <Input placeholder="Label (e.g. iPhone Shortcut)" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
          <Button onClick={create} disabled={creating} className="shrink-0">
            {creating ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            Create
          </Button>
        </div>
        {createError && <p className="rounded-xl bg-negative/10 px-3.5 py-2.5 text-[12px] text-negative">{createError}</p>}
        {(data?.rows ?? []).map((t) => (
          <div key={t.id} className="flex items-center gap-2 border-b border-line py-2 text-[13px] last:border-0">
            <KeyRound className="h-3.5 w-3.5 shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate font-medium">{t.label}</span>
            <span className="shrink-0 text-[12px] text-muted">last used {fmt(t.lastUsedAt)}</span>
            <ConfirmButton
              size="icon"
              className="h-8 w-8 shrink-0"
              aria-label="Revoke token"
              confirmTitle="Revoke this token?"
              confirmMessage={`Any Apple Shortcut using "${t.label}" will stop working immediately.`}
              confirmLabel="Revoke"
              onConfirm={() => remove(t.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </ConfirmButton>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Export ──────────────────────────────────────────────────────────────────

function ExportCard() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [building, setBuilding] = useState(false);
  const keyed = useE2EOptional()?.status === "ready";
  const { rows } = useTransactions();

  function download() {
    const p = new URLSearchParams();
    if (from) p.set("from", String(new Date(`${from}T00:00:00+05:30`).getTime()));
    if (to) p.set("to", String(new Date(`${to}T23:59:59+05:30`).getTime()));
    window.location.href = `/api/export?${p.toString()}`;
  }

  async function downloadKeyed() {
    setBuilding(true);
    try {
      const fromMs = from ? new Date(`${from}T00:00:00+05:30`).getTime() : null;
      const toMs = to ? new Date(`${to}T23:59:59+05:30`).getTime() : null;
      const exportRows: ExportRow[] = rows
        .filter((t) => t.deletedAt == null && t.duplicateOfId == null)
        .filter((t) => (fromMs == null || t.occurredAt >= fromMs) && (toMs == null || t.occurredAt <= toMs))
        .sort((a, b) => b.occurredAt - a.occurredAt)
        .map((t) => ({
          occurredAt: t.occurredAt,
          channel: t.channel,
          merchant: t.merchant,
          upiId: t.upiId,
          amountPaise: t.amountPaise,
          direction: t.direction,
          categoryName: t.categoryName,
          notes: t.notes,
        }));
      // Dynamic import keeps exceljs (a sizable dependency) out of the main
      // bundle — most sessions never export.
      const ExcelJS = (await import("exceljs")).default;
      const wb = buildLedgerWorkbook(ExcelJS, exportRows);
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportFilename();
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBuilding(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Export to Excel" subtitle="Ledger as .xlsx — Date, Time, Channel, Party, Amount, Debit/Credit, Category, Notes" />
      <div className="flex flex-wrap items-end gap-3 px-5 pb-5 pt-2">
        <div>
          <Label htmlFor="from">From</Label>
          <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="to">To</Label>
          <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button onClick={keyed ? downloadKeyed : download} disabled={building}>
          {building ? <Spinner className="border-white/40 border-t-white" /> : <Download className="h-4 w-4" />}
          Download
        </Button>
        <p className="w-full text-[12px] text-muted">
          {keyed ? "Built in your browser — Vyay never sees the file." : "Leave the dates empty to export everything."}
        </p>
      </div>
    </Card>
  );
}

// ── Encryption key ──────────────────────────────────────────────────────────

function EncryptionKeyCard() {
  const e2e = useE2EOptional();
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!e2e || e2e.status !== "ready") return null;

  async function reset() {
    setBusy(true);
    setError(null);
    try {
      const keypair = generateKeypair();
      const keyCheck = makeKeyCheck(keypair.publicKey);
      const res = await fetch("/api/e2e/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey: keypair.publicKey, keyCheck }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Reset failed.");
      }
      await e2e!.applyNewKey(keypair.privateKey);
      await offerToSaveCredential(e2e!.userId, keypair.privateKey);
      setNewKey(keypair.privateKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed.");
    } finally {
      setBusy(false);
    }
  }

  async function copyKey() {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card>
      <CardHeader title="Your encryption key" subtitle="Zero-access encryption — you hold the only key" />
      <div className="flex flex-col gap-3 px-5 pb-5 pt-2 text-[13px]">
        <p className="flex items-center gap-1.5 text-muted">
          <Lock className="h-3.5 w-3.5 text-positive" /> Your transactions are sealed with a key only you hold — not
          even Vyay&apos;s operator can read them.
        </p>
        {newKey ? (
          <div className="rounded-xl border border-accent/40 bg-accent/5 p-3.5">
            <p className="font-medium">Your new personal key — save it now</p>
            <p className="mt-1 text-muted">This won&apos;t be shown again. Vyay is re-importing from Gmail.</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-card px-2.5 py-1.5 font-mono text-[12px]">
                {newKey}
              </code>
              <Button type="button" size="sm" variant="secondary" onClick={copyKey}>
                {copied ? <Check className="h-3.5 w-3.5 text-positive" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            {/* Same real-form-submission trick as the first-time setup
                screen — a plain button outside a <form> never gives
                password managers a submit event to key their save prompt
                off of. */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setNewKey(null);
                setConfirming(false);
                setConfirmText("");
              }}
            >
              <div className="sr-only">
                <Label htmlFor="vyay-reset-username">Account (for your password manager)</Label>
                <input
                  id="vyay-reset-username"
                  type="text"
                  name="username"
                  autoComplete="username"
                  value={e2e.userId}
                  readOnly
                />
              </div>
              <input
                type="password"
                name="new-password"
                autoComplete="new-password"
                value={newKey}
                readOnly
                className="sr-only"
              />
              <Button type="submit" size="sm" className="mt-3">
                Done
              </Button>
            </form>
          </div>
        ) : !confirming ? (
          <Button variant="danger" size="sm" className="w-fit" onClick={() => setConfirming(true)}>
            Reset key
          </Button>
        ) : (
          <div className="rounded-xl border border-negative/30 bg-negative/5 p-3.5">
            <p className="font-medium text-negative">This cannot be undone</p>
            <p className="mt-1 text-muted">
              Resetting wipes your encrypted transactions and Shortcut history, then rebuilds your ledger from Gmail.
              Notes and category edits you&apos;ve made don&apos;t survive — only what re-imports from your inbox
              does.
            </p>
            <Label className="mt-3">Type RESET to confirm</Label>
            <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="RESET" />
            {error && <p className="mt-2 text-negative">{error}</p>}
            <div className="mt-3 flex gap-2">
              <Button variant="danger" size="sm" disabled={confirmText !== "RESET" || busy} onClick={reset}>
                {busy ? <Spinner className="border-white/40 border-t-white" /> : null}
                Wipe and re-import
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setConfirming(false);
                  setConfirmText("");
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Apple Shortcut instructions ─────────────────────────────────────────────

function ShortcutCard() {
  const [origin, setOrigin] = useState("https://your-vyay-host");
  useEffect(() => setOrigin(window.location.origin), []);

  return (
    <Card>
      <CardHeader
        title="Apple Shortcut"
        subtitle="Log an expense from your phone in two taps — Vyay pairs it with the bank email automatically"
      />
      <div className="px-5 pb-5 pt-2 text-[13px] leading-relaxed text-muted">
        <ol className="list-decimal space-y-2 pl-5 marker:font-medium marker:text-fg">
          <li>Create an API token above and copy it.</li>
          <li>
            In the Shortcuts app, create a new shortcut with <span className="font-medium text-fg">Ask for Input</span>{" "}
            (Number) for the amount, and optionally a <span className="font-medium text-fg">Choose from Menu</span> for
            the category.
          </li>
          <li>
            Add <span className="font-medium text-fg">Get Contents of URL</span> with:
            <div className="mt-2 space-y-1 rounded-xl bg-card-2 p-3.5 font-mono text-[12px] text-fg">
              <p>URL: {origin}/api/shortcut/log</p>
              <p>Method: POST</p>
              <p>Headers: Authorization: Bearer vyay_…your token…</p>
              <p>
                {'Body (JSON): { "amount": 249.5, "category": "Food", "notes": "lunch", "timestamp": '}
                <span className="text-accent">Current Date</span>
                {" }"}
              </p>
            </div>
            <p className="mt-1.5 text-[12px]">
              Passing <span className="font-medium text-fg">timestamp</span> (the Shortcuts magic variable{" "}
              <span className="font-medium text-fg">Current Date</span>, formatted as ISO 8601) matters if you might
              log the same amount more than once in a day — Vyay uses it to pick the right transaction instead of
              guessing.
            </p>
          </li>
          <li>
            Optionally add <span className="font-medium text-fg">Show Result</span> to see the match status — Vyay
            replies whether it categorized a transaction, queued the log, or needs you to pick between candidates on
            the <span className="font-medium text-fg">Matches</span> page.
          </li>
        </ol>
        <p className="mt-3 flex items-center gap-1.5 text-[12px]">
          <Smartphone className="h-3.5 w-3.5" /> Tip: add the shortcut to your Home Screen or an Action Button for
          one-tap logging.
        </p>
      </div>
    </Card>
  );
}

// ── SMS + Apple Wallet automations ──────────────────────────────────────────
// Real-time capture beyond Gmail, posted to /api/ingest with the same
// Bearer-token trust model as the Shortcut endpoint above. This is a
// going-forward-only source: iOS gives no way to read message history, so
// nothing here can backfill past texts — that's what "Import bank
// statement" below is for. Setup is on-device (Shortcuts personal
// automations, which Apple doesn't allow to be shared/imported at all) —
// this only documents the recipe and, once configured, links to the one
// piece that CAN be shared: the action shortcut itself.

const SHORTCUT_INSTALL_URL = process.env.NEXT_PUBLIC_VYAY_SHORTCUT_URL;

function SmsWalletCard() {
  const [origin, setOrigin] = useState("https://your-vyay-host");
  useEffect(() => setOrigin(window.location.origin), []);

  return (
    <Card>
      <CardHeader
        title="SMS & Apple Wallet"
        subtitle="Catch bank alerts and Apple Pay taps the moment they happen, on top of Gmail"
      />
      <div className="flex flex-col gap-5 px-5 pb-5 pt-2 text-[13px] leading-relaxed text-muted">
        <p className="flex items-start gap-2 rounded-xl bg-card-2 px-3.5 py-3 text-[12px]">
          <History className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <span className="font-medium text-fg">Going forward only.</span> iOS has no way for any app — Vyay
            included — to read your past text messages, so this can only catch SMS/Wallet activity from the moment
            you finish setup onward. For everything before that, use{" "}
            <span className="font-medium text-fg">Import bank statement</span> below.
          </span>
        </p>

        <div>
          <p className="mb-2 font-medium text-fg">Step 1 — install the action shortcut, once</p>
          {SHORTCUT_INSTALL_URL ? (
            <a href={SHORTCUT_INSTALL_URL} target="_blank" rel="noreferrer">
              <Button size="sm">
                <Download className="h-3.5 w-3.5" /> Add &ldquo;Vyay: Log Transaction&rdquo; to Shortcuts
              </Button>
            </a>
          ) : (
            <p className="rounded-xl bg-card-2 px-3.5 py-2.5 text-[12px]">
              Shortcut link isn&apos;t configured on this deployment yet.
            </p>
          )}
          <p className="mt-2 text-[12px]">
            Opens the Shortcuts app and asks to paste your API token once (create one above first) — it&apos;s baked
            into your personal copy, never asked again. Everything below just calls this one shortcut.
          </p>
        </div>

        <div>
          <p className="mb-2 font-medium text-fg">Step 2 — SMS: two automations (iOS needs one per condition)</p>
          <ol className="list-decimal space-y-2 pl-5 marker:font-medium marker:text-fg">
            <li>
              In Shortcuts → Automation, create <span className="font-medium text-fg">When I get a message</span>{" "}
              containing <code className="rounded bg-card-2 px-1 font-mono text-[12px]">debited</code>. Repeat with a
              second automation for <code className="rounded bg-card-2 px-1 font-mono text-[12px]">credited</code> —
              &ldquo;Message Contains&rdquo; can only OR across two automations, not within one.
            </li>
            <li>
              Set both to <span className="font-medium text-fg">Run Immediately</span>, notifications off, then add a{" "}
              <span className="font-medium text-fg">Dictionary</span> action:{" "}
              <code className="rounded bg-card-2 px-1 font-mono text-[12px]">type: sms</code>,{" "}
              <code className="rounded bg-card-2 px-1 font-mono text-[12px]">body: Shortcut Input</code>,{" "}
              <code className="rounded bg-card-2 px-1 font-mono text-[12px]">timestamp: Current Date</code> — then{" "}
              <span className="font-medium text-fg">Run Shortcut</span> → <span className="font-medium text-fg">Vyay:
              Log Transaction</span>, passing that dictionary as input.
            </li>
          </ol>
          <p className="mt-2 text-[12px]">
            OTPs, promos, and reminders still reach the shortcut since it filters on message content, not what you set
            up — Vyay always replies success so it never nags you about a rejected one.
          </p>
        </div>

        <div>
          <p className="mb-2 font-medium text-fg">Step 3 — Apple Wallet: one automation, fully automatic</p>
          <ol className="list-decimal space-y-2 pl-5 marker:font-medium marker:text-fg">
            <li>
              In Shortcuts → Automation, create a <span className="font-medium text-fg">Transaction</span> automation
              (Wallet section) — leave card/merchant filters empty to catch every Apple Pay payment.
            </li>
            <li>
              Set <span className="font-medium text-fg">Run Immediately</span>, notifications off, then add a{" "}
              <span className="font-medium text-fg">Dictionary</span> action:{" "}
              <code className="rounded bg-card-2 px-1 font-mono text-[12px]">type: wallet</code>,{" "}
              <code className="rounded bg-card-2 px-1 font-mono text-[12px]">merchant: Merchant</code>,{" "}
              <code className="rounded bg-card-2 px-1 font-mono text-[12px]">amount: Amount</code>,{" "}
              <code className="rounded bg-card-2 px-1 font-mono text-[12px]">card: Card</code>,{" "}
              <code className="rounded bg-card-2 px-1 font-mono text-[12px]">timestamp: Current Date</code> (all
              magic variables from the Transaction trigger) — then <span className="font-medium text-fg">Run
              Shortcut</span> → <span className="font-medium text-fg">Vyay: Log Transaction</span>, passing that
              dictionary as input.
            </li>
          </ol>
          <p className="mt-2 text-[12px]">
            Only fires on Apple Pay itself — a physical card swipe or a bank&apos;s own SMS/email for the same
            purchase still lands separately; Vyay&apos;s cross-source dedup keeps it from double-counting.
          </p>
        </div>

        <details className="text-[12px]">
          <summary className="cursor-pointer font-medium text-fg">Building the shortcut yourself (for {origin})</summary>
          <div className="mt-2 space-y-1 rounded-xl bg-card-2 p-3.5 font-mono text-[12px] text-fg">
            <p>One action: Get Contents of URL</p>
            <p className="pl-3">URL: {origin}/api/ingest</p>
            <p className="pl-3">Method: POST</p>
            <p className="pl-3">
              Headers: Authorization: Bearer [tap the value, set to &quot;Ask Each Time&quot; — not a literal
              &quot;Ask for Input&quot; action, which would re-prompt on every run]
            </p>
            <p className="pl-3">Request Body: JSON → Shortcut Input, forwarded as-is</p>
            <p className="mt-1">
              When sharing (Share → Copy iCloud Link), Shortcuts detects the &quot;Ask Each Time&quot; value and offers
              to turn it into an import question — set its prompt to &quot;Vyay API token&quot;. Whoever imports the
              link answers once; it&apos;s then fixed in their copy, never asked again.
            </p>
            <p className="mt-1">Full step-by-step: docs/shortcuts-setup.md in the repo.</p>
          </div>
        </details>
      </div>
    </Card>
  );
}

// ── Account ─────────────────────────────────────────────────────────────────
// Rendered by the real settings page only, NOT inside SettingsPanels — the
// demo shell reuses SettingsPanels and must not show a sign-out. This is
// also the only sign-out reachable on phones: the sidebar footer (which has
// one on desktop) is hidden below the `sm` breakpoint, and the mobile
// bottom tab bar carries nav items only.

export function AccountCard({ name, email }: { name: string | null; email: string | null }) {
  return (
    <Card>
      <CardHeader title="Account" subtitle="Signed in with Google" />
      <div className="flex items-center justify-between gap-3 px-5 pb-5 pt-2">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-medium">{name ?? email ?? "Account"}</p>
          {name && email && <p className="truncate text-[12px] text-muted">{email}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <ThemeToggle />
          <Button variant="secondary" size="sm" onClick={() => signOut({ callbackUrl: "/login" })}>
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function SettingsPanels() {
  return (
    <Suspense>
      <div className="flex flex-col gap-4">
        <GmailCard />
        <EncryptionKeyCard />
        <TokensCard />
        <ExportCard />
        <StatementImportCard />
        <ShortcutCard />
        <SmsWalletCard />
      </div>
    </Suspense>
  );
}
