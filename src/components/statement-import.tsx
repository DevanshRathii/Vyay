"use client";

import { AlertTriangle, Check, FileSpreadsheet, Upload, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button, Card, CardHeader, Dialog, Label, Select, Spinner } from "@/components/ui";
import { useE2EOptional } from "@/components/e2e-provider";
import { useTransactions } from "@/lib/use-transactions";
import { chunk } from "@/lib/utils";
import { formatINR } from "@/lib/utils";
import { detectHeaderRow, isMappingComplete, type ColumnMapping } from "@/lib/statement/columns";
import { findDuplicates, type ExistingTxnLite } from "@/lib/statement/dedup";
import { normalizeStatementRow, type NormalizeResult, type StatementRow } from "@/lib/statement/normalize";
import { readStatementFile } from "@/lib/statement/read-file";

type Step = "closed" | "map" | "review" | "importing" | "summary";

const ROLE_OPTIONS: Array<{ key: keyof ColumnMapping; label: string }> = [
  { key: "date", label: "Date" },
  { key: "narration", label: "Narration / description" },
  { key: "debit", label: "Debit amount" },
  { key: "credit", label: "Credit amount" },
  { key: "amount", label: "Amount (single signed column)" },
  { key: "crDr", label: "Cr/Dr indicator" },
  { key: "ref", label: "Reference / cheque no." },
];

const REJECT_LABELS: Record<string, string> = {
  "bad-date": "Unparseable date",
  "bad-amount": "No debit or credit amount",
  "no-direction": "Amount found, but no debit/credit signal",
  "before-baseline": "Before Jan 2026 — outside Vyay's tracking baseline",
};

interface ReviewRow {
  key: number;
  normalized: NormalizeResult;
  /** Only set for rows that normalized OK. */
  duplicateOfId?: string;
  /** User's include/exclude choice — defaults to true for New, false for Duplicate. */
  include: boolean;
}

function buildExternalIdInput(row: StatementRow) {
  return { occurredAt: row.occurredAt, amountPaise: row.amountPaise, direction: row.direction, narration: row.narration };
}

export function StatementImportCard() {
  const [step, setStep] = useState<Step>("closed");
  const [fileName, setFileName] = useState("");
  const [allRows, setAllRows] = useState<string[][]>([]);
  const [headerRowIndex, setHeaderRowIndex] = useState(0);
  const [mapping, setMapping] = useState<Partial<ColumnMapping>>({});
  const [reviewRows, setReviewRows] = useState<ReviewRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ inserted: number; duplicates: number; skipped: number } | null>(null);

  const keyed = useE2EOptional()?.status === "ready";
  const { rows: existingDecrypted } = useTransactions();
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setStep("closed");
    setFileName("");
    setAllRows([]);
    setHeaderRowIndex(0);
    setMapping({});
    setReviewRows([]);
    setError(null);
    setSummary(null);
  }

  async function handleFile(file: File) {
    setError(null);
    try {
      const rows = await readStatementFile(file);
      if (rows.length === 0) throw new Error("That file has no rows.");
      setAllRows(rows);
      setFileName(file.name);
      const detected = detectHeaderRow(rows);
      if (detected) {
        setHeaderRowIndex(detected.headerRowIndex);
        setMapping(detected.mapping);
        runNormalize(rows, detected.headerRowIndex, detected.mapping);
      } else {
        setHeaderRowIndex(0);
        setMapping({});
        setStep("map");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that file.");
    }
  }

  function runNormalize(rows: string[][], headerIdx: number, map: Partial<ColumnMapping>) {
    if (!isMappingComplete(map)) return;
    const dataRows = rows.slice(headerIdx + 1);
    const normalized = dataRows.map((cells, i) => normalizeStatementRow(cells, map, i));

    const okRows = normalized.filter((r): r is { ok: true; row: StatementRow } => r.ok).map((r) => r.row);
    let dupMap = new Map<number, string>();
    if (keyed) {
      const existing: ExistingTxnLite[] = existingDecrypted
        .filter((t) => t.deletedAt == null)
        .map((t) => ({ id: t.id, occurredAt: t.occurredAt, amountPaise: t.amountPaise, direction: t.direction, referenceNumber: t.referenceNumber }));
      dupMap = findDuplicates(okRows, existing);
    }

    const built: ReviewRow[] = normalized.map((n, i) => ({
      key: i,
      normalized: n,
      duplicateOfId: n.ok ? dupMap.get(n.row.rowIndex) : undefined,
      include: n.ok ? !dupMap.has(n.row.rowIndex) : false,
    }));
    setReviewRows(built);
    setStep("review");
  }

  function confirmMapping() {
    if (!isMappingComplete(mapping)) {
      setError("Map at least Date, Narration, and a debit/credit/amount column to continue.");
      return;
    }
    runNormalize(allRows, headerRowIndex, mapping);
  }

  const counts = useMemo(() => {
    let neu = 0, dup = 0, bad = 0;
    for (const r of reviewRows) {
      if (!r.normalized.ok) bad++;
      else if (r.duplicateOfId) dup++;
      else neu++;
    }
    return { neu, dup, bad };
  }, [reviewRows]);

  async function runImport() {
    setStep("importing");
    const toImport = reviewRows.filter((r) => r.include && r.normalized.ok).map((r) => (r.normalized as { ok: true; row: StatementRow }).row);
    let inserted = 0, duplicates = 0, skipped = 0;
    try {
      for (const batch of chunk(toImport, 500)) {
        const res = await fetch("/api/statement/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rows: batch.map((row) => ({
              ...buildExternalIdInput(row),
              merchant: row.merchant,
              merchantSource: row.merchantSource,
              merchantConfidence: row.merchantConfidence,
              upiId: row.upiId,
              channel: row.channel,
              referenceNumber: row.referenceNumber,
              cells: row.cells,
            })),
          }),
        });
        if (!res.ok) throw new Error("Import failed partway through — try again with the remaining rows.");
        const body = await res.json();
        inserted += body.inserted;
        duplicates += body.duplicates;
        skipped += body.skipped;
      }
      setSummary({ inserted, duplicates, skipped });
      setStep("summary");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
      setStep("review");
    }
  }

  return (
    <Card>
      <CardHeader
        title="Import bank statement"
        subtitle="Backfill history from a CSV/XLS/XLSX export — CSV/XLSX only for now, PDF is coming"
      />
      <div className="flex flex-col gap-3 px-5 pb-5 pt-2 text-[13px] text-muted">
        <p>
          Upload your bank&apos;s account-statement export and Vyay will find new transactions, skip ones it already
          has, and let you review everything before anything is saved. Only covers 2026 onward — Vyay&apos;s ledger
          starts 1 January 2026.
        </p>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xls,.xlsx,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />
          <Button size="sm" onClick={() => fileRef.current?.click()}>
            <FileSpreadsheet className="h-3.5 w-3.5" /> Choose file
          </Button>
        </div>
        {error && step !== "review" && <p className="rounded-xl bg-negative/10 px-3.5 py-2.5 text-[12px] text-negative">{error}</p>}
      </div>

      <Dialog open={step === "map"} onClose={reset} title="Map your columns" wide>
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-muted">
            Couldn&apos;t confidently find a header row in <span className="font-medium text-fg">{fileName}</span> —
            tell Vyay which column is which. Showing the first few rows below.
          </p>
          <div>
            <Label htmlFor="header-row">Header row number</Label>
            <input
              id="header-row"
              type="number"
              min={0}
              value={headerRowIndex}
              onChange={(e) => setHeaderRowIndex(Math.max(0, Number(e.target.value)))}
              className="h-9.5 w-24 rounded-xl border border-line bg-card px-3 text-sm text-fg"
            />
          </div>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[600px] border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-line bg-card-2">
                  {(allRows[headerRowIndex] ?? []).map((_, colIdx) => (
                    <th key={colIdx} className="p-2 text-left">
                      <Select
                        value={(Object.entries(mapping).find(([, v]) => v === colIdx)?.[0] as string) ?? ""}
                        onChange={(e) => {
                          const role = e.target.value as keyof ColumnMapping | "";
                          setMapping((prev) => {
                            const next = { ...prev };
                            for (const k of Object.keys(next) as (keyof ColumnMapping)[]) {
                              if (next[k] === colIdx) delete next[k];
                            }
                            if (role) next[role] = colIdx;
                            return next;
                          });
                        }}
                        className="h-8 w-full text-[11px]"
                      >
                        <option value="">Ignore</option>
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r.key} value={r.key}>
                            {r.label}
                          </option>
                        ))}
                      </Select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allRows.slice(headerRowIndex, headerRowIndex + 6).map((row, i) => (
                  <tr key={i} className="border-b border-line/60 last:border-0">
                    {row.map((cell, c) => (
                      <td key={c} className="max-w-[160px] truncate p-2 text-muted">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && <p className="rounded-xl bg-negative/10 px-3.5 py-2.5 text-[12px] text-negative">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={reset}>
              Cancel
            </Button>
            <Button size="sm" onClick={confirmMapping}>
              Continue
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={step === "review" || step === "importing"} onClose={reset} title={`Review — ${fileName}`} wide>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3 text-[12px]">
            <span className="rounded-full bg-positive/10 px-3 py-1 font-medium text-positive">{counts.neu} new</span>
            {keyed && <span className="rounded-full bg-card-2 px-3 py-1 font-medium text-muted">{counts.dup} duplicate</span>}
            <span className="rounded-full bg-negative/10 px-3 py-1 font-medium text-negative">{counts.bad} skipped</span>
            {!keyed && (
              <span className="text-muted">
                Duplicate detection runs after import for this account — genuine duplicates get flagged, not silently
                dropped.
              </span>
            )}
          </div>
          <div className="max-h-[50dvh] overflow-y-auto rounded-xl border border-line">
            <table className="w-full min-w-[700px] border-collapse text-[12px]">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-line">
                  <th className="w-8 p-2"></th>
                  <th className="p-2 text-left">Date</th>
                  <th className="p-2 text-left">Narration</th>
                  <th className="p-2 text-right">Amount</th>
                  <th className="p-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {reviewRows.map((r) => (
                  <tr key={r.key} className="border-b border-line/60 last:border-0">
                    <td className="p-2">
                      <input
                        type="checkbox"
                        checked={r.include}
                        disabled={!r.normalized.ok}
                        onChange={() =>
                          setReviewRows((prev) => prev.map((x) => (x.key === r.key ? { ...x, include: !x.include } : x)))
                        }
                        className="h-3.5 w-3.5 accent-[var(--accent)]"
                      />
                    </td>
                    {r.normalized.ok ? (
                      <>
                        <td className="whitespace-nowrap p-2">{new Date(r.normalized.row.occurredAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
                        <td className="max-w-[240px] truncate p-2">{r.normalized.row.merchant ?? r.normalized.row.narration}</td>
                        <td className="whitespace-nowrap p-2 text-right tabular-nums">
                          {r.normalized.row.direction === "credit" ? "+" : "−"}
                          {formatINR(r.normalized.row.amountPaise)}
                        </td>
                        <td className="p-2">
                          {r.duplicateOfId ? (
                            <span className="text-muted">Duplicate</span>
                          ) : (
                            <span className="flex items-center gap-1 text-positive">
                              <Check className="h-3 w-3" /> New
                            </span>
                          )}
                        </td>
                      </>
                    ) : (
                      <>
                        <td colSpan={3} className="max-w-[300px] truncate p-2 text-muted">
                          {r.normalized.cells.join(", ")}
                        </td>
                        <td className="p-2">
                          <span className="flex items-center gap-1 text-negative">
                            <AlertTriangle className="h-3 w-3" /> {REJECT_LABELS[r.normalized.reason]}
                          </span>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && <p className="rounded-xl bg-negative/10 px-3.5 py-2.5 text-[12px] text-negative">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={reset} disabled={step === "importing"}>
              Cancel
            </Button>
            <Button size="sm" onClick={runImport} disabled={step === "importing" || counts.neu + counts.dup === 0}>
              {step === "importing" ? <Spinner className="h-3.5 w-3.5 border-white/40 border-t-white" /> : <Upload className="h-3.5 w-3.5" />}
              Import {reviewRows.filter((r) => r.include).length} transaction{reviewRows.filter((r) => r.include).length === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={step === "summary"} onClose={reset} title="Import complete">
        {summary && (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-fg">
              <span className="font-medium">{summary.inserted}</span> transaction{summary.inserted === 1 ? "" : "s"} imported
              {summary.duplicates > 0 && (
                <>
                  , <span className="font-medium">{summary.duplicates}</span> flagged as possible duplicates (visible
                  in the Ledger)
                </>
              )}
              {summary.skipped > 0 && (
                <>
                  , <span className="font-medium">{summary.skipped}</span> skipped
                </>
              )}
              .
            </p>
            <div className="flex justify-end">
              <Button size="sm" onClick={reset}>
                <X className="h-3.5 w-3.5" /> Done
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </Card>
  );
}
