"use client";

import { Check, GitMerge, X } from "lucide-react";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { Badge, Button, Card, ConfirmButton, Empty, Spinner } from "@/components/ui";
import { useE2EOptional } from "@/components/e2e-provider";
import { cn, formatINR } from "@/lib/utils";

interface Candidate {
  id: string;
  occurredAt: number;
  merchant: string | null;
  channel: string | null;
  bank: string | null;
  amountPaise: number | null;
  encPayload?: string | null;
  categoryId: string | null;
}

interface PendingEvent {
  id: string;
  createdAt: number;
  amountPaise: number | null;
  encPayload?: string | null;
  direction: string;
  categoryName: string;
  notes: string | null;
  candidates: Candidate[];
}

/** Decrypts amount/notes (event) or amount/merchant (candidate) when the row
 *  carries ciphertext instead of plaintext columns — pass-through otherwise. */
function useDecryptedMatches(rows: PendingEvent[] | undefined) {
  const e2e = useE2EOptional();
  return useMemo(() => {
    if (!rows) return undefined;
    const decrypt = e2e?.status === "ready" ? e2e.decrypt : null;
    return rows.map((e) => {
      const event =
        e.encPayload && decrypt
          ? { ...e, ...decrypt<{ amountPaise: number; notes: string | null }>(e.encPayload) }
          : { ...e, amountPaise: e.amountPaise ?? 0 };
      return {
        ...event,
        candidates: e.candidates.map((c) =>
          c.encPayload && decrypt
            ? { ...c, ...decrypt<{ amountPaise: number; merchant: string | null }>(c.encPayload) }
            : { ...c, amountPaise: c.amountPaise ?? 0 },
        ),
      };
    });
  }, [rows, e2e]);
}

function fmt(ms: number) {
  return new Date(ms).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

export function MatchesList() {
  const { data, mutate } = useSWR<{ rows: PendingEvent[] }>("/api/matches");
  const rows = useDecryptedMatches(data?.rows);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function act(eventId: string, action: "resolve" | "dismiss", transactionId?: string) {
    setBusy(eventId);
    setError(null);
    const res = await fetch(`/api/matches/${eventId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, transactionId }),
    });
    setBusy(null);
    mutate();
    if (!res.ok) {
      throw new Error(action === "dismiss" ? "Couldn't dismiss that — try again." : "Couldn't apply that match — try again.");
    }
  }

  if (!rows) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <Empty
          icon={<GitMerge className="h-8 w-8" />}
          title="Nothing to resolve"
          hint="When an Apple Shortcut log matches several transactions — or none yet — it appears here for a decision."
        />
      </Card>
    );
  }

  return (
    <div data-tour="matches-list" className="flex flex-col gap-3">
      {error && <p className="rounded-xl bg-negative/10 px-3.5 py-2.5 text-[13px] text-negative">{error}</p>}
      {rows.map((e) => {
        const chosen = selected[e.id] ?? (e.candidates.length === 1 ? e.candidates[0].id : "");
        return (
          <Card key={e.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-[14px] font-semibold tabular-nums">
                  {formatINR(e.amountPaise)} <span className="font-normal text-muted">{e.direction}</span>
                </p>
                <p className="mt-0.5 text-[12px] text-muted">
                  Logged {fmt(e.createdAt)} · <Badge>{e.categoryName}</Badge>
                  {e.notes && <span className="ml-1.5">“{e.notes}”</span>}
                </p>
              </div>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  disabled={!chosen || busy === e.id}
                  onClick={() => act(e.id, "resolve", chosen).catch((err) => setError(err.message))}
                >
                  {busy === e.id ? <Spinner className="border-white/40 border-t-white" /> : <Check className="h-3.5 w-3.5" />}
                  Apply
                </Button>
                <ConfirmButton
                  variant="secondary"
                  size="sm"
                  disabled={busy === e.id}
                  confirmTitle="Dismiss this log?"
                  confirmMessage="It won't auto-resolve against future matching transactions either — this discards it for good."
                  confirmLabel="Dismiss"
                  onConfirm={() => act(e.id, "dismiss")}
                >
                  <X className="h-3.5 w-3.5" /> Dismiss
                </ConfirmButton>
              </div>
            </div>

            {e.candidates.length === 0 ? (
              <p className="mt-3 rounded-xl bg-card-2 px-3.5 py-2.5 text-[13px] text-muted">
                No matching email yet — this will auto-resolve when the transaction email arrives, or you can dismiss it.
              </p>
            ) : (
              <div className="mt-3 flex flex-col gap-1.5">
                {e.candidates.map((c) => (
                  <label
                    key={c.id}
                    className={cn(
                      "flex cursor-pointer items-center justify-between rounded-xl border px-3.5 py-2.5 text-[13px]",
                      chosen === c.id ? "border-accent bg-accent/5" : "border-line bg-card-2/50 hover:border-accent/40",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <input
                        type="radio"
                        name={`cand-${e.id}`}
                        checked={chosen === c.id}
                        onChange={() => setSelected((s) => ({ ...s, [e.id]: c.id }))}
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium capitalize">{c.merchant ?? "Transaction"}</span>
                        <span className="block text-[12px] text-muted">
                          {fmt(c.occurredAt)}
                          {c.channel ? ` · ${c.channel}` : ""}
                          {c.bank ? ` · ${c.bank}` : ""}
                          {c.categoryId ? " · already categorized" : ""}
                        </span>
                      </span>
                    </span>
                    <span className="ml-3 shrink-0 tabular-nums font-medium">{formatINR(c.amountPaise)}</span>
                  </label>
                ))}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
