"use client";

import {
  Check,
  Copy,
  Download,
  KeyRound,
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
import { Suspense, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { ActionMenu, ActionMenuItem, Button, Card, CardHeader, Input, Label, Spinner } from "@/components/ui";
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
  connected: boolean;
  emailAddress: string | null;
  syncStatus: "idle" | "syncing" | "error" | null;
  syncError: string | null;
  lastSyncAt: number | null;
  initialSyncDone: boolean;
  totalSynced: number;
  syncProgress: { phase: "listing" | "ingesting"; processed: number; total: number } | null;
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
  const { data, mutate } = useSWR<GmailStatus>("/api/gmail/status", {
    refreshInterval: (latest) => (latest?.syncStatus === "syncing" ? 1500 : 30000),
  });
  const [starting, setStarting] = useState(false);
  const [reparsing, setReparsing] = useState(false);
  const [reparseResult, setReparseResult] = useState<{ scanned: number; updated: number } | null>(null);
  const [showTrustInfo, setShowTrustInfo] = useState(false);
  const [autoContinues, setAutoContinues] = useState(0);
  const [autoContinueExhausted, setAutoContinueExhausted] = useState(false);
  const prevSyncStatus = useRef<GmailStatus["syncStatus"]>(undefined);
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
    await fetch(`/api/gmail/sync${full ? "?full=1" : ""}`, { method: "POST" });
    setStarting(false);
    mutate();
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
    if (!confirm("Disconnect Gmail? Your imported transactions are kept.")) return;
    await fetch("/api/gmail/disconnect", { method: "POST" });
    mutate();
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
                      className="block h-full rounded-full bg-accent transition-[width]"
                      style={{ width: `${Math.min(100, (data.syncProgress.processed / data.syncProgress.total) * 100)}%` }}
                    />
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button size="sm" variant="secondary" disabled={syncing} onClick={() => syncNow(false)}>
                  <RefreshCw className={syncing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> Sync now
                </Button>
                <Button size="sm" variant="danger" onClick={disconnect}>
                  <Unplug className="h-3.5 w-3.5" /> Disconnect
                </Button>
                <ActionMenu>
                  <ActionMenuItem disabled={syncing} onClick={() => syncNow(true)}>
                    <RefreshCw className="h-3.5 w-3.5" /> Full resync
                  </ActionMenuItem>
                  <ActionMenuItem disabled={reparsing} onClick={reparse}>
                    <Wand2 className={reparsing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> Re-parse
                  </ActionMenuItem>
                </ActionMenu>
              </div>
            </div>
            {data.syncStatus === "error" && data.syncError && (
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

  async function create() {
    const res = await fetch("/api/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(label.trim() ? { label: label.trim() } : {}),
    });
    const body = await res.json();
    if (res.ok) {
      setFresh({ token: body.token, label: body.label });
      setLabel("");
      mutate();
    }
  }

  async function remove(id: string) {
    await fetch(`/api/tokens?id=${id}`, { method: "DELETE" });
    mutate();
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
          <Button onClick={create} className="shrink-0">
            <Plus className="h-4 w-4" /> Create
          </Button>
        </div>
        {(data?.rows ?? []).map((t) => (
          <div key={t.id} className="flex items-center gap-2 border-b border-line py-2 text-[13px] last:border-0">
            <KeyRound className="h-3.5 w-3.5 shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate font-medium">{t.label}</span>
            <span className="shrink-0 text-[12px] text-muted">last used {fmt(t.lastUsedAt)}</span>
            <Button variant="danger" size="icon" className="h-8 w-8 shrink-0" onClick={() => remove(t.id)} aria-label="Revoke token">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
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

  function download() {
    const p = new URLSearchParams();
    if (from) p.set("from", String(new Date(`${from}T00:00:00+05:30`).getTime()));
    if (to) p.set("to", String(new Date(`${to}T23:59:59+05:30`).getTime()));
    window.location.href = `/api/export?${p.toString()}`;
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
        <Button onClick={download}>
          <Download className="h-4 w-4" /> Download
        </Button>
        <p className="w-full text-[12px] text-muted">Leave the dates empty to export everything.</p>
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
              <p>{'Body (JSON): { "amount": 249.5, "category": "Food", "notes": "lunch" }'}</p>
            </div>
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

export function SettingsPanels() {
  return (
    <Suspense>
      <div className="flex flex-col gap-4">
        <GmailCard />
        <TokensCard />
        <ExportCard />
        <ShortcutCard />
      </div>
    </Suspense>
  );
}
