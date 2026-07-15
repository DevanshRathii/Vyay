"use client";

import { Check, Copy, ExternalLink, Loader2, MailCheck, Plus, ShieldOff, X } from "lucide-react";
import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Badge, Button, Card, CardHeader, ConfirmButton, Empty, Input } from "@/components/ui";
import { cn } from "@/lib/utils";

interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  createdAt: number;
  gmailAccessGranted: boolean;
  hasGmailConnection: boolean;
  initialSyncDone: boolean | null;
  syncStatus: string | null;
  totalSynced: number | null;
}

function SyncBadge({ u }: { u: AdminUserRow }) {
  if (!u.hasGmailConnection) return null;
  if (u.initialSyncDone) {
    return (
      <Badge className="ml-2 align-middle">
        <MailCheck className="h-3 w-3" /> Synced · {u.totalSynced ?? 0} imported
      </Badge>
    );
  }
  return (
    <Badge className="ml-2 align-middle">
      <Loader2 className="h-3 w-3 animate-spin" />
      {u.syncStatus === "error" ? "Sync error" : "Syncing…"}
      {u.totalSynced ? ` · ${u.totalSynced} so far` : ""}
    </Badge>
  );
}

interface PreapprovedRow {
  id: string;
  email: string;
  createdAt: number;
}

const GOOGLE_TEST_USERS_URL = process.env.NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT
  ? `https://console.cloud.google.com/auth/audience?project=${process.env.NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT}`
  : "https://console.cloud.google.com/auth/audience";

function fmt(ms: number) {
  return new Date(ms).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

function CopyEmailButton({ email }: { email: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={async () => {
        await navigator.clipboard.writeText(email);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-positive" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy email"}
    </Button>
  );
}

export function PreapprovedPanel() {
  const { data, mutate } = useSWR<{ rows: PreapprovedRow[] }>("/api/admin/preapproved");
  const { mutate: mutateGlobal } = useSWRConfig();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function add() {
    if (!email.trim()) return;
    setSubmitting(true);
    setNotice(null);
    const res = await fetch("/api/admin/preapproved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice(body.error ?? "Couldn't add that email — try again.");
      setSubmitting(false);
      return;
    }
    if (body.grantedExistingUser) {
      setNotice(`${email.trim()} already has an account — Gmail access was granted on it directly.`);
      // The grant landed on the users list, not this one — refresh that panel.
      mutateGlobal("/api/admin/users");
    }
    setEmail("");
    setSubmitting(false);
    mutate();
  }

  async function remove(id: string) {
    setRemoving(id);
    const res = await fetch(`/api/admin/preapproved/${id}`, { method: "DELETE" });
    setRemoving(null);
    mutate();
    if (!res.ok) setNotice("Couldn't remove that email — try again.");
  }

  return (
    <Card>
      <CardHeader
        title="Pre-approve someone"
        subtitle="Before they've ever signed in — pairs with also adding them as a Google test user"
      />
      <div className="flex flex-col gap-3 px-5 pb-5 pt-2">
        <p className="text-[12px] leading-relaxed text-muted">
          Add their email here, then add the same email to your{" "}
          <a
            href={GOOGLE_TEST_USERS_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 font-medium text-accent underline underline-offset-2"
          >
            Google Test users list <ExternalLink className="h-3 w-3" />
          </a>
          . When they sign in for the first time, Gmail access is granted automatically — nothing left to do.
        </p>
        <div className="flex gap-2">
          <Input
            type="email"
            placeholder="someone@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <Button onClick={add} disabled={submitting || !email.trim()} className="shrink-0">
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
        {notice && <p className="rounded-xl bg-card-2 px-3.5 py-2.5 text-[12px] text-muted">{notice}</p>}
        {data && data.rows.length > 0 && (
          <div className="flex flex-col">
            {data.rows.map((r) => (
              <div key={r.id} className="flex items-center justify-between border-b border-line py-2 text-[13px] last:border-0">
                <span className="min-w-0 truncate">{r.email}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0"
                  disabled={removing === r.id}
                  onClick={() => remove(r.id)}
                  aria-label={`Remove ${r.email}`}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

export function AdminUsersPanel() {
  const { data, mutate } = useSWR<{ rows: AdminUserRow[] }>("/api/admin/users");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setGranted(id: string, granted: boolean) {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gmailAccessGranted: granted }),
    });
    setBusy(null);
    mutate();
    if (!res.ok) setError("Couldn't update Gmail access — try again.");
  }

  return (
    <Card>
      <CardHeader
        title="Signed-up users"
        subtitle="Signing in with Google is always open — it's the separate Gmail connection that's gated"
      />
      <div className="flex flex-col gap-3 px-5 pb-5 pt-2">
        <p className="rounded-xl bg-card-2 px-3.5 py-3 text-[12px] leading-relaxed text-muted">
          Granting Gmail access here only unlocks Vyay&apos;s own gate. While the app is unverified, Google
          separately restricts the Gmail scope to whoever&apos;s on your{" "}
          <a
            href={GOOGLE_TEST_USERS_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 font-medium text-accent underline underline-offset-2"
          >
            OAuth consent screen&apos;s Test users list <ExternalLink className="h-3 w-3" />
          </a>{" "}
          — there&apos;s no API for that, so add them there too, manually, or their Gmail connection will fail even
          after you grant it here.
        </p>
        {error && <p className="rounded-xl bg-negative/10 px-3.5 py-2.5 text-[12px] text-negative">{error}</p>}
        {!data ? (
          <p className="text-[13px] text-muted">Loading…</p>
        ) : data.rows.length === 0 ? (
          <p className="text-[13px] text-muted">No users yet.</p>
        ) : (
          data.rows.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center gap-2 border-b border-line py-2.5 text-[13px] last:border-0">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {u.name ?? u.email}
                  <SyncBadge u={u} />
                </p>
                <p className="truncate text-[12px] text-muted">
                  {u.email} · signed up {fmt(u.createdAt)}
                </p>
              </div>
              <CopyEmailButton email={u.email} />
              {u.gmailAccessGranted ? (
                <ConfirmButton
                  size="sm"
                  disabled={busy === u.id}
                  confirmTitle="Revoke Gmail access?"
                  confirmMessage={`${u.name ?? u.email} will immediately lose access to connect or sync Gmail.`}
                  confirmLabel="Revoke"
                  onConfirm={() => setGranted(u.id, false)}
                >
                  <ShieldOff className="h-3.5 w-3.5" /> Revoke
                </ConfirmButton>
              ) : (
                <Button size="sm" disabled={busy === u.id} onClick={() => setGranted(u.id, true)}>
                  <MailCheck className="h-3.5 w-3.5" /> Grant Gmail access
                </Button>
              )}
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

// ── Parse health ────────────────────────────────────────────────────────────

interface ParseHealthRow {
  id: string;
  provider: string;
  totalCount: number;
  merchantHits: number;
  upiHits: number;
  refHits: number;
  categorizedHits: number;
  updatedAt: number;
}

function pct(hits: number, total: number): number {
  return total === 0 ? 0 : Math.round((hits / total) * 100);
}

function HealthBar({ label, hits, total }: { label: string; hits: number; total: number }) {
  const p = pct(hits, total);
  return (
    <div className="min-w-[90px] flex-1">
      <div className="mb-0.5 flex items-center justify-between text-[11px] text-muted">
        <span>{label}</span>
        <span className={cn("font-medium", p < 30 ? "text-negative" : p < 70 ? "text-amber-500" : "text-positive")}>
          {p}%
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-card-2">
        <div
          className={cn("h-full rounded-full", p < 30 ? "bg-negative" : p < 70 ? "bg-amber-500" : "bg-positive")}
          style={{ width: `${Math.max(3, p)}%` }}
        />
      </div>
    </div>
  );
}

/** Per-provider extraction-quality dashboard — catches the next "Canara"
 *  (a whole bank silently extracting/categorizing nothing) before a user
 *  has to notice and complain. */
export function ParseHealthPanel() {
  const { data } = useSWR<{ rows: ParseHealthRow[] }>("/api/admin/parse-health");

  return (
    <Card>
      <CardHeader title="Parse health" subtitle="Extraction quality by bank/payment app — low numbers mean missing fixtures" />
      <div className="flex flex-col gap-3 px-5 pb-5 pt-2">
        {!data ? null : data.rows.length === 0 ? (
          <p className="text-[12px] text-muted">No transactions ingested since this went live.</p>
        ) : (
          data.rows.map((r) => (
            <div key={r.id} className="border-b border-line pb-3 last:border-0 last:pb-0">
              <div className="mb-1.5 flex items-center justify-between text-[13px]">
                <span className="font-medium capitalize">{r.provider}</span>
                <span className="text-muted">{r.totalCount} txn{r.totalCount === 1 ? "" : "s"}</span>
              </div>
              <div className="flex flex-wrap gap-3">
                <HealthBar label="Merchant" hits={r.merchantHits} total={r.totalCount} />
                <HealthBar label="UPI id" hits={r.upiHits} total={r.totalCount} />
                <HealthBar label="Ref" hits={r.refHits} total={r.totalCount} />
                <HealthBar label="Categorized" hits={r.categorizedHits} total={r.totalCount} />
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

// ── Donated parse samples ───────────────────────────────────────────────────

interface ParseSampleRow {
  id: string;
  kind: "email" | "sms";
  text: string;
  note: string | null;
  createdAt: number;
  reporterEmail: string | null;
}

export function ParseSamplesPanel() {
  const { data, mutate } = useSWR<{ rows: ParseSampleRow[] }>("/api/admin/parse-samples");
  const [busy, setBusy] = useState<string | null>(null);

  async function resolve(id: string) {
    setBusy(id);
    await fetch(`/api/admin/parse-samples/${id}`, { method: "POST" });
    setBusy(null);
    mutate();
  }

  return (
    <Card>
      <CardHeader title="Donated parse samples" subtitle="Reported by users via “Report a bad parse” in the Ledger" />
      <div className="flex flex-col gap-3 px-5 pb-5 pt-2">
        {!data ? null : data.rows.length === 0 ? (
          <Empty title="Nothing reported" hint="Bad-parse reports from the Ledger will show up here." />
        ) : (
          data.rows.map((s) => (
            <div key={s.id} className="rounded-xl border border-line p-3.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[12px] text-muted">
                  <Badge>{s.kind}</Badge>
                  {s.reporterEmail ?? "unknown"} · {fmt(s.createdAt)}
                </span>
                <Button size="sm" variant="secondary" disabled={busy === s.id} onClick={() => resolve(s.id)}>
                  <Check className="h-3.5 w-3.5" /> Mark resolved
                </Button>
              </div>
              {s.note && <p className="mb-2 text-[12px] text-muted">“{s.note}”</p>}
              <pre className="whitespace-pre-wrap break-words rounded-lg bg-card-2 p-2.5 text-[12px]">{s.text}</pre>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
