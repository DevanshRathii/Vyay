"use client";

import {
  ArrowDownLeft,
  ArrowUpDown,
  ArrowUpRight,
  Copy,
  Pencil,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { Badge, Button, Card, Dialog, Empty, Input, Label, Select, Spinner } from "@/components/ui";
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
  notes: string | null;
  confidence: number | null;
  duplicateOfId: string | null;
  deletedAt: number | null;
  emailSubject: string | null;
}

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

export function Ledger() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [channel, setChannel] = useState("");
  const [direction, setDirection] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "occurredAt", dir: "desc" });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Txn | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (category) p.set("category", category);
    if (channel) p.set("channel", channel);
    if (direction) p.set("direction", direction);
    if (showDeleted) p.set("onlyDeleted", "1");
    p.set("sort", sort.key);
    p.set("dir", sort.dir);
    p.set("page", String(page));
    p.set("pageSize", "50");
    return p.toString();
  }, [q, category, channel, direction, showDeleted, sort, page]);

  const { data, isLoading, mutate } = useSWR<{ rows: Txn[]; total: number; pageSize: number }>(
    `/api/transactions?${query}`,
    { keepPreviousData: true },
  );
  const { data: cats } = useSWR<{ rows: CategoryRow[] }>("/api/categories");

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  function toggleSort(key: string) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  }

  async function patch(id: string, body: Record<string, unknown>) {
    await fetch(`/api/transactions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    mutate();
  }

  function resetFilters(fn: () => void) {
    fn();
    setPage(1);
  }

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
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input placeholder="Search merchant, notes, ref…" value={q} onChange={(e) => resetFilters(() => setQ(e.target.value))} className="pl-9" />
        </div>
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
        <Button variant={showDeleted ? "primary" : "secondary"} size="sm" onClick={() => resetFilters(() => setShowDeleted((v) => !v))}>
          <Trash2 className="h-3.5 w-3.5" /> Deleted
        </Button>
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
              <tr key={t.id} className={cn("border-b border-line/70 last:border-0 hover:bg-card-2/60", t.deletedAt && "opacity-50")}>
                <td className="whitespace-nowrap px-3 py-2.5 text-[13px]">
                  <div>{fmtDate(t.occurredAt)}</div>
                  <div className="text-[11px] text-muted">{fmtTime(t.occurredAt)}</div>
                </td>
                <td className="max-w-[220px] px-3 py-2.5 text-[13px]">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium capitalize">{t.merchant ?? t.upiId ?? "—"}</span>
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
                <td className="px-3 py-2.5">
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
                </td>
                <td className="max-w-[180px] truncate px-3 py-2.5 text-[13px] text-muted">{t.notes ?? ""}</td>
                <td className="px-3 py-2.5">
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
        {data && data.rows.length === 0 && (
          <Empty title={showDeleted ? "No deleted transactions" : "No transactions found"} hint="Try clearing filters, or sync Gmail from Settings." />
        )}
      </Card>

      {/* Mobile cards */}
      <div className="flex flex-col gap-2 md:hidden">
        {isLoading && !data && (
          <div className="flex h-40 items-center justify-center">
            <Spinner />
          </div>
        )}
        {data?.rows.map((t) => (
          <Card key={t.id} className={cn("p-3.5", t.deletedAt && "opacity-50")} onClick={() => setEditing(t)}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 truncate text-[14px] font-medium capitalize">
                  {t.merchant ?? t.upiId ?? "Transaction"}
                  {t.duplicateOfId && <Copy className="h-3 w-3 shrink-0 text-amber-500" />}
                </p>
                <p className="mt-0.5 text-[12px] text-muted">
                  {fmtDate(t.occurredAt)} · {fmtTime(t.occurredAt)}
                  {t.channel ? ` · ${t.channel}` : ""}
                </p>
              </div>
              <p className={cn("shrink-0 text-[15px] font-semibold tabular-nums", t.direction === "credit" ? "text-positive" : "")}>
                {t.direction === "credit" ? "+" : "−"}
                {formatINR(t.amountPaise)}
              </p>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {t.categoryName ? (
                <Badge color={t.categoryColor ?? undefined}>{t.categoryName}</Badge>
              ) : (
                <Badge className="text-muted">Uncategorized</Badge>
              )}
              {t.notes && <span className="truncate text-[12px] text-muted">{t.notes}</span>}
            </div>
          </Card>
        ))}
        {data && data.rows.length === 0 && (
          <Card>
            <Empty title={showDeleted ? "No deleted transactions" : "No transactions found"} hint="Try clearing filters, or sync Gmail from Settings." />
          </Card>
        )}
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

      {/* Edit dialog */}
      <EditDialog txn={editing} cats={cats?.rows ?? []} onClose={() => setEditing(null)} onSave={async (body) => {
        if (editing) await patch(editing.id, body);
        setEditing(null);
      }} onDeleteToggle={async () => {
        if (editing) await patch(editing.id, { deleted: !editing.deletedAt });
        setEditing(null);
      }} />
    </div>
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
  const [categoryId, setCategoryId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [key, setKey] = useState<string | null>(null);
  if (txn && key !== txn.id) {
    setKey(txn.id);
    setCategoryId(txn.categoryId ?? "");
    setNotes(txn.notes ?? "");
  }

  return (
    <Dialog open={!!txn} onClose={onClose} title="Edit transaction">
      {txn && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl bg-card-2 p-3.5 text-[13px]">
            <p className="font-medium capitalize">{txn.merchant ?? txn.upiId ?? "Transaction"}</p>
            <p className="mt-0.5 text-muted">
              {formatINR(txn.amountPaise)} {txn.direction} · {fmtDate(txn.occurredAt)} {fmtTime(txn.occurredAt)}
            </p>
            {txn.referenceNumber && <p className="mt-0.5 text-[12px] text-muted">Ref {txn.referenceNumber}</p>}
            {txn.emailSubject && <p className="mt-1 line-clamp-2 text-[12px] text-muted">“{txn.emailSubject}”</p>}
            {txn.confidence != null && <p className="mt-1 text-[11px] text-muted">Parse confidence {(txn.confidence * 100).toFixed(0)}%</p>}
          </div>
          <div>
            <Label>Category</Label>
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
