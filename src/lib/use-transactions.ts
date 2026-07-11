import { useMemo } from "react";
import useSWR from "swr";
import { useE2E } from "@/components/e2e-provider";
import type { TransactionEncPayload } from "@/lib/ingest";

/** The exact row shape Ledger/Dashboard/Matches already expect — decrypted
 *  (or pass-through, for a dual-read plaintext row) so components never
 *  special-case keyed vs. non-keyed. */
export interface DecryptedTxn {
  id: string;
  occurredAt: number;
  amountPaise: number;
  direction: "debit" | "credit";
  merchant: string | null;
  merchantNormalized: string | null;
  channel: string | null;
  bank: string | null;
  referenceNumber: string | null;
  upiId: string | null;
  cardLast4: string | null;
  categoryId: string | null;
  categorySource: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  notes: string | null;
  confidence: number | null;
  merchantSource: string | null;
  merchantConfidence: number | null;
  duplicateOfId: string | null;
  deletedAt: number | null;
  emailSubject: string | null;
}

interface RawRow extends Omit<DecryptedTxn, "amountPaise"> {
  amountPaise: number | null;
  encPayload?: string | null;
}

interface TransactionsResponse {
  encrypted?: boolean;
  publicKey?: string;
  rows: RawRow[];
  total: number;
}

/**
 * Fetches the whole (keyed) transaction list once and decrypts every row
 * client-side. Only meaningful once KeyProvider reports `ready` — callers
 * should gate on that themselves (see Ledger/Dashboard/Matches).
 */
export function useTransactions() {
  const { decrypt, seal, status } = useE2E();
  const { data, isLoading, isValidating, mutate } = useSWR<TransactionsResponse>(
    status === "ready" ? "/api/transactions" : null,
  );

  const rows = useMemo<DecryptedTxn[]>(() => {
    if (!data) return [];
    return data.rows.map((row) => {
      if (!row.encPayload) {
        // Dual-read: a row with plaintext fields already present (a
        // straggler from before this account was keyed) passes through
        // untouched.
        return { ...row, amountPaise: row.amountPaise ?? 0 };
      }
      const payload = decrypt<TransactionEncPayload>(row.encPayload);
      return {
        ...row,
        amountPaise: payload.amountPaise,
        merchant: payload.merchant,
        merchantNormalized: payload.merchantNormalized,
        notes: payload.notes,
        upiId: payload.upiId,
        referenceNumber: payload.referenceNumber,
        emailSubject: payload.emailSubject,
        bank: payload.bank,
        cardLast4: payload.cardLast4,
        channel: payload.channel,
      };
    });
  }, [data, decrypt]);

  /**
   * Re-seals a keyed transaction's encPayload with `updates` merged in
   * (e.g. edited notes) — decrypts the original ciphertext fresh so fields
   * not shown in the UI (like `raw`, the original email) survive the
   * round-trip instead of being silently dropped. Returns undefined for a
   * dual-read plaintext row (nothing to re-seal — PATCH the plaintext
   * column directly instead) or when the row can't be found.
   */
  function reseal(id: string, updates: Partial<TransactionEncPayload>): string | undefined {
    const row = data?.rows.find((r) => r.id === id);
    if (!row?.encPayload) return undefined;
    const payload = decrypt<TransactionEncPayload>(row.encPayload);
    return seal({ ...payload, ...updates });
  }

  return { rows, isLoading, isValidating, mutate, reseal };
}
