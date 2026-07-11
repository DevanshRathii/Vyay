"use client";

import { Check, Copy, ExternalLink, Loader2, MailCheck, Plus, ShieldOff, X } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { Badge, Button, Card, CardHeader, Input } from "@/components/ui";

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
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  async function add() {
    if (!email.trim()) return;
    setSubmitting(true);
    await fetch("/api/admin/preapproved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    });
    setEmail("");
    setSubmitting(false);
    mutate();
  }

  async function remove(id: string) {
    setRemoving(id);
    await fetch(`/api/admin/preapproved/${id}`, { method: "DELETE" });
    setRemoving(null);
    mutate();
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

  async function setGranted(id: string, granted: boolean) {
    setBusy(id);
    await fetch(`/api/admin/users/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gmailAccessGranted: granted }),
    });
    setBusy(null);
    mutate();
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
                <Button size="sm" variant="danger" disabled={busy === u.id} onClick={() => setGranted(u.id, false)}>
                  <ShieldOff className="h-3.5 w-3.5" /> Revoke
                </Button>
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
