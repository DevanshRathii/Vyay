"use client";

import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpDown,
  ArrowUpRight,
  ChevronRight,
  Copy,
  Pencil,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import useSWR from "swr";
import { Badge, Button, Card, Dialog, Empty, Input, Label, Select, Spinner } from "@/components/ui";
import { useE2EOptional } from "@/components/e2e-provider";
import { matchesLedgerFilters } from "@/lib/transactions";
import { useTransactions, type DecryptedTxn } from "@/lib/use-transactions";
import { cn, formatINR } from "@/lib/utils";

interface Txn {
  id: string;
  occurredAt: number;
  amountPaise: number;
  direction: "debit" | "credit";
  merchant: string | null;
  channel: string | null;
  bank: string | null;
  upiId: string | null;
  referenceNumber: string | null;
  cardLast4: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  categorySource: string | null;
  notes: string | null;
  confidence: number | null;
  merchantSource: string | null;
  merchantConfidence: number | null;
  duplicateOfId: string | null;
  deletedAt: number | null;
  emailSubject: string | null;
}

const LOW_MERCHANT_CONFIDENCE = 0.6;
function isLowConfidenceMerchant(t: Pick<Txn, "merchantConfidence">): boolean {
  return t.merchantConfidence != null && t.merchantConfidence < LOW_MERCHANT_CONFIDENCE;
}

const MERCHANT_SOURCE_LABELS: Record<string, string> = {
  contact: "your saved contact",
  narration: "bank narration",
  "vpa-name": "UPI beneficiary name",
  pattern: "email text match",
  "info-freetext": "free-text guess",
  "upi-id": "UPI ID — no name found",
};

const CATEGORY_SOURCE_LABELS: Record<string, string> = {
  user: "your rule",
  brand: "known brand match",
  generic: "generic keyword guess",
};

interface CategoryRow {
  id: string;
  name: string;
  color: string;
}

const CHANNELS = ["UPI", "Card", "IMPS", "NEFT", "RTGS", "ATM", "Wallet", "NetBanking", "Other"];

function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit", timeZone: "Asia/Kolkata" });
}
function fmtTime(ms: number) {
  return new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

function LedgerInner() {
  const initialParams = useSearchParams();
  const initialCategory = initialParams.get("category") ?? "";
  const initialChannel = initialParams.get("channel") ?? "";
  const initialQ = initialParams.get("q") ?? "";
  const [q, setQ] = useState(initialQ);
  const [category, setCategory] = useState(initialCategory);
  const [channel, setChannel] = useState(initialChannel);
  const [direction, setDirection] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [lowConfidence, setLowConfidence] = useState(false);
  const [autoCategorized, setAutoCategorized] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "occurredAt", dir: "desc" });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Txn | null>(null);

  const PAGE_SIZE = 50;
  const keyed = useE2EOptional()?.status === "ready";

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (category) p.set("category", category);
    if (channel) p.set("channel", channel);
    if (direction) p.set("direction", direction);
    if (showDeleted) p.set("onlyDeleted", "1");
    if (lowConfidence) p.set("lowConfidence", "1");
    if (autoCategorized) p.set("categorySource", "generic");
    p.set("sort", sort.key);
    p.set("dir", sort.dir);
    p.set("page", String(page));
    p.set("pageSize", String(PAGE_SIZE));
    return p.toString();
  }, [q, category, channel, direction, showDeleted, lowConfidence, autoCategorized, sort, page]);

  // Non-keyed (and /demo): unchanged — server-side filter/sort/paginate.
  const server = useSWR<{ rows: Txn[]; total: number; pageSize: number }>(
    !keyed ? `/api/transactions?${query}` : null,
    { keepPreviousData: true },
  );

  // Keyed: fetch everything once, decrypt, and filter/sort/paginate in JS —
  // the server can't evaluate a substring search against ciphertext.
  const client = useTransactions();
  const clientFiltered = useMemo(() => {
    if (!keyed) return [];
    const filtered = client.rows.filter((t) =>
      matchesLedgerFilters(t, {
        q,
        category,
        channel,
        direction,
        onlyDeleted: showDeleted,
        lowConfidence,
        categorySource: autoCategorized ? "generic" : undefined,
      }),
    );
    const dir = sort.dir === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
      const av = a[sort.key as keyof DecryptedTxn];
      const bv = b[sort.key as keyof DecryptedTxn];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return filtered;
  }, [keyed, client.rows, q, category, channel, direction, showDeleted, lowConfidence, autoCategorized, sort]);

  const data = keyed
    ? {
        rows: clientFiltered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
        total: clientFiltered.length,
        pageSize: PAGE_SIZE,
      }
    : server.data;
  const isLoading = keyed ? client.isLoading : server.isLoading;
  const isValidating = keyed ? client.isValidating : server.isValidating;
  const mutate = keyed ? client.mutate : server.mutate;

  const filtersActive = Boolean(q.trim() || category || channel || direction || showDeleted || lowConfidence || autoCategorized);
  const { data: cats } = useSWR<{ rows: CategoryRow[] }>("/api/categories");

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  function toggleSort(key: string) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  }

  async function patch(id: string, body: Record<string, unknown>) {
    const patchBody: Record<string, unknown> = { ...body };
    if (keyed && "notes" in body) {
      const encPayload = client.reseal(id, { notes: (body.notes as string | null) ?? null });
      if (encPayload) {
        patchBody.encPayload = encPayload;
        delete patchBody.notes;
      }
      // else: a dual-read plaintext straggler row — PATCH notes as plaintext, same as non-keyed.
    }
    await fetch(`/api/transactions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patchBody),
    });
    mutate();
  }

  function resetFilters(fn: () => void) {
    fn();
    setPage(1);
  }

  function clearAllFilters() {
    resetFilters(() => {
      setQ("");
      setCategory("");
      setChannel("");
      setDirection("");
      setShowDeleted(false);
      setLowConfidence(false);
      setAutoCategorized(false);
    });
  }

  const emptyState = (
    <Empty
      title={showDeleted ? "No deleted transactions" : filtersActive ? "No transactions match your filters" : "No transactions found"}
      hint={filtersActive ? undefined : "Sync Gmail from Settings to import transactions."}
    >
      {filtersActive && (
        <Button variant="secondary" size="sm" onClick={clearAllFilters} className="mt-1">
          Clear filters
        </Button>
      )}
    </Empty>
  );

  const Th = ({ label, sortKey, className }: { label: string; sortKey?: string; className?: string }) => (
    <th className={cn("px-3 py-2.5 text-left text-[12px] font-semibold text-muted", className)}>
      {sortKey ? (
        <button className="inline-flex items-center gap-1 hover:text-fg" onClick={() => toggleSort(sortKey)}>
          {label}
          <ArrowUpDown className={cn("h-3 w-3", sort.key === sortKey ? "text-accent" : "opacity-40")} />
        </button>
      ) : (
        label
      )}
    </th>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Filters */}
      <div className="flex flex-col gap-3">
        <div data-tour="ledger-search" className="relative">
          {isValidating ? (
            <Spinner className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2" />
          ) : (
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          )}
          <Input
            placeholder="Search by merchant, notes, or reference number…"
            value={q}
            onChange={(e) => resetFilters(() => setQ(e.target.value))}
            className="w-full pl-10"
            aria-label="Search transactions"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={category} onChange={(e) => resetFilters(() => setCategory(e.target.value))} aria-label="Category filter">
            <option value="">All categories</option>
            <option value="uncategorized">Uncategorized</option>
            {cats?.rows.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select value={channel} onChange={(e) => resetFilters(() => setChannel(e.target.value))} aria-label="Channel filter">
            <option value="">All channels</option>
            {CHANNELS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
          <Select value={direction} onChange={(e) => resetFilters(() => setDirection(e.target.value))} aria-label="Direction filter">
            <option value="">Debit + credit</option>
            <option value="debit">Debits</option>
            <option value="credit">Credits</option>
          </Select>
          <span className="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden />
          <Button variant={showDeleted ? "primary" : "secondary"} onClick={() => resetFilters(() => setShowDeleted((v) => !v))}>
            <Trash2 className="h-4 w-4" /> Deleted
          </Button>
          <Button
            variant={lowConfidence ? "primary" : "secondary"}
            onClick={() => resetFilters(() => setLowConfidence((v) => !v))}
            title="Merchant name is a guess — needs verifying"
          >
            <AlertTriangle className="h-4 w-4" /> Low-confidence
          </Button>
          <Button
            variant={autoCategorized ? "primary" : "secondary"}
            onClick={() => resetFilters(() => setAutoCategorized((v) => !v))}
            title="Category assigned by a broad generic keyword, not a specific brand"
          >
            <Sparkles className="h-4 w-4" /> Auto-categorized
          </Button>
        </div>
      </div>

      {/* Desktop table */}
      <Card className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[820px] border-collapse">
          <thead className="border-b border-line">
            <tr>
              <Th label="Date" sortKey="occurredAt" />
              <Th label="Merchant" sortKey="merchant" />
              <Th label="Amount" sortKey="amountPaise" className="text-right" />
              <Th label="Channel" />
              <Th label="Category" />
              <Th label="Notes" />
              <Th label="" className="w-20" />
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((t) => (
              <tr
                key={t.id}
                onClick={() => setEditing(t)}
                className={cn(
                  "cursor-pointer border-b border-line/70 last:border-0 hover:bg-card-2/60",
                  t.deletedAt && "opacity-50",
                )}
              >
                <td className="whitespace-nowrap px-3 py-2.5 text-[13px]">
                  <div>{fmtDate(t.occurredAt)}</div>
                  <div className="text-[11px] text-muted">{fmtTime(t.occurredAt)}</div>
                </td>
                <td className="max-w-[220px] px-3 py-2.5 text-[13px]">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium capitalize">{t.merchant ?? t.upiId ?? "—"}</span>
                    {isLowConfidenceMerchant(t) && (
                      <span title="Merchant name is a guess — tap to verify">
                        <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" />
                      </span>
                    )}
                    {t.duplicateOfId && (
                      <span title="Possible duplicate">
                        <Copy className="h-3 w-3 shrink-0 text-amber-500" />
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-muted">
                    {t.bank ?? ""}
                    {t.cardLast4 ? ` ··${t.cardLast4}` : ""}
                    {t.upiId && t.merchant ? ` · ${t.upiId}` : ""}
                  </div>
                </td>
                <td className={cn("whitespace-nowrap px-3 py-2.5 text-right text-[13px] font-semibold tabular-nums", t.direction === "credit" ? "text-positive" : "")}>
                  <span className="inline-flex items-center gap-1">
                    {t.direction === "credit" ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5 text-muted" />}
                    {formatINR(t.amountPaise)}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-[13px] text-muted">{t.channel ?? "—"}</td>
                <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-1">
                    <Select
                      value={t.categoryId ?? ""}
                      onChange={(e) => patch(t.id, { categoryId: e.target.value || null })}
                      className="h-8 max-w-[150px] text-[12px]"
                      aria-label="Category"
                    >
                      <option value="">—</option>
                      {cats?.rows.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                    {t.categorySource === "generic" && (
                      <span title="Auto-categorized by a broad keyword — verify">
                        <Sparkles className="h-3 w-3 shrink-0 text-muted" />
                      </span>
                    )}
                  </div>
                </td>
                <td className="max-w-[180px] truncate px-3 py-2.5 text-[13px] text-muted">{t.notes ?? ""}</td>
                <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(t)} aria-label="Edit">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {t.deletedAt ? (
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => patch(t.id, { deleted: false })} aria-label="Restore">
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <Button variant="danger" size="icon" className="h-8 w-8" onClick={() => patch(t.id, { deleted: true })} aria-label="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {isLoading && !data && (
          <div className="flex h-40 items-center justify-center">
            <Spinner />
          </div>
        )}
        {data && data.rows.length === 0 && emptyState}
      </Card>

      {/* Mobile cards */}
      <div className="flex flex-col gap-2 md:hidden">
        {isLoading && !data && (
          <div className="flex h-40 items-center justify-center">
            <Spinner />
          </div>
        )}
        {data?.rows.map((t) => (
          <Card
            key={t.id}
            role="button"
            tabIndex={0}
            onClick={() => setEditing(t)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setEditing(t);
              }
            }}
            aria-label={`Edit transaction: ${t.merchant ?? t.upiId ?? "Transaction"}, ${formatINR(t.amountPaise)}`}
            className={cn("cursor-pointer p-3.5", t.deletedAt && "opacity-50")}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 truncate text-[14px] font-medium capitalize">
                  {t.merchant ?? t.upiId ?? "Transaction"}
                  {isLowConfidenceMerchant(t) && (
                    <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" aria-label="Merchant name is a guess" />
                  )}
                  {t.duplicateOfId && <Copy className="h-3 w-3 shrink-0 text-amber-500" />}
                </p>
                <p className="mt-0.5 text-[12px] text-muted">
                  {fmtDate(t.occurredAt)} · {fmtTime(t.occurredAt)}
                  {t.channel ? ` · ${t.channel}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <p className={cn("text-[15px] font-semibold tabular-nums", t.direction === "credit" ? "text-positive" : "")}>
                  {t.direction === "credit" ? "+" : "−"}
                  {formatINR(t.amountPaise)}
                </p>
                <ChevronRight className="h-3.5 w-3.5 text-muted" aria-hidden />
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {t.categoryName ? (
                <Badge color={t.categoryColor ?? undefined} className={cn(t.categorySource === "generic" && "border-dashed")}>
                  {t.categorySource === "generic" && <Sparkles className="h-2.5 w-2.5" aria-hidden />}
                  {t.categoryName}
                </Badge>
              ) : (
                <Badge className="text-muted">Uncategorized</Badge>
              )}
              {t.notes && <span className="truncate text-[12px] text-muted">{t.notes}</span>}
            </div>
          </Card>
        ))}
        {data && data.rows.length === 0 && <Card>{emptyState}</Card>}
      </div>

      {/* Pagination */}
      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-between text-[13px] text-muted">
          <span>
            {data.total} transaction{data.total === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span className="tabular-nums">
              {page} / {totalPages}
            </span>
            <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Edit dialog. Keyed by transaction id so React remounts it fresh per
          transaction instead of resetting form state during render. */}
      <EditDialog key={editing?.id ?? "none"} txn={editing} cats={cats?.rows ?? []} onClose={() => setEditing(null)} onSave={async (body) => {
        if (editing) await patch(editing.id, body);
        setEditing(null);
      }} onDeleteToggle={async () => {
        if (editing) await patch(editing.id, { deleted: !editing.deletedAt });
        setEditing(null);
      }} />
    </div>
  );
}

export function Ledger() {
  return (
    <Suspense>
      <LedgerInner />
    </Suspense>
  );
}

function EditDialog({
  txn,
  cats,
  onClose,
  onSave,
  onDeleteToggle,
}: {
  txn: Txn | null;
  cats: CategoryRow[];
  onClose: () => void;
  onSave: (body: { categoryId: string | null; notes: string | null }) => Promise<void>;
  onDeleteToggle: () => Promise<void>;
}) {
  const [categoryId, setCategoryId] = useState<string>(txn?.categoryId ?? "");
  const [notes, setNotes] = useState(txn?.notes ?? "");

  return (
    <Dialog open={!!txn} onClose={onClose} title="Edit transaction">
      {txn && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl bg-card-2 p-3.5 text-[13px]">
            <p className="flex items-center gap-1.5 font-medium capitalize">
              {txn.merchant ?? txn.upiId ?? "Transaction"}
              {isLowConfidenceMerchant(txn) && (
                <span title="Merchant name is a guess — tap to verify">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                </span>
              )}
            </p>
            <p className="mt-0.5 text-muted">
              {formatINR(txn.amountPaise)} {txn.direction} · {fmtDate(txn.occurredAt)} {fmtTime(txn.occurredAt)}
            </p>
            {txn.referenceNumber && <p className="mt-0.5 text-[12px] text-muted">Ref {txn.referenceNumber}</p>}
            {txn.emailSubject && <p className="mt-1 line-clamp-2 text-[12px] text-muted">“{txn.emailSubject}”</p>}
            <div className="mt-2 flex flex-col gap-0.5 border-t border-line pt-2">
              <p className={cn("text-[11px]", isLowConfidenceMerchant(txn) ? "text-amber-500" : "text-muted")}>
                Merchant: {txn.merchantSource ? MERCHANT_SOURCE_LABELS[txn.merchantSource] ?? txn.merchantSource : "unknown"}
                {txn.merchantConfidence != null && ` (${Math.round(txn.merchantConfidence * 100)}%)`}
                {isLowConfidenceMerchant(txn) && " — worth verifying"}
              </p>
              <p className={cn("text-[11px]", txn.categorySource === "generic" ? "text-amber-500" : "text-muted")}>
                Category:{" "}
                {txn.categoryId
                  ? txn.categorySource
                    ? (CATEGORY_SOURCE_LABELS[txn.categorySource] ?? txn.categorySource)
                    : "manually set"
                  : "not set"}
                {txn.categorySource === "generic" && " — worth verifying"}
              </p>
            </div>
          </div>
          <div>
            <Label className="flex items-center gap-1.5">
              Category
              {txn.categorySource === "generic" && (
                <span className="inline-flex items-center gap-1 text-[11px] font-normal text-muted" title="Assigned by a broad generic keyword, not a specific brand">
                  <Sparkles className="h-3 w-3" /> auto
                </span>
              )}
            </Label>
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full">
              <option value="">Uncategorized</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add a note…" maxLength={500} />
          </div>
          <div className="flex items-center justify-between pt-1">
            <Button variant="danger" size="sm" onClick={onDeleteToggle}>
              {txn.deletedAt ? (
                <>
                  <RotateCcw className="h-3.5 w-3.5" /> Restore
                </>
              ) : (
                <>
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </>
              )}
            </Button>
            <Button onClick={() => onSave({ categoryId: categoryId || null, notes: notes || null })}>Save</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
