"use client";

import { ArrowDownLeft, ArrowUpRight, Inbox, ReceiptText, TrendingDown, TrendingUp, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import useSWR from "swr";
import { Button, Card, CardHeader, Empty, Select, Skeleton } from "@/components/ui";
import { useE2EOptional } from "@/components/e2e-provider";
import { computeAnalytics, type AnalyticsRow, type CategoryLite } from "@/lib/analytics-core";
import { useCountUp } from "@/lib/use-count-up";
import { useTransactions } from "@/lib/use-transactions";
import { cn, formatINR } from "@/lib/utils";

interface Analytics {
  totals: { debit: number; credit: number; count: number; net: number };
  previous: { debit: number; credit: number } | null;
  byCategory: Array<{ id: string; name: string; color: string; total: number }>;
  byChannel: Array<{ channel: string; total: number }>;
  topMerchants: Array<{ key: string; label: string; total: number; count: number }>;
  byDay: Array<{ date: string; debit: number; credit: number }>;
  byMonth: Array<{ month: string; debit: number; credit: number }>;
}

interface Slice {
  categoryId: string | null;
  categoryName: string | null;
  channel: string | null;
  merchantKey: string | null;
  merchantLabel: string | null;
}

const EMPTY_SLICE: Slice = {
  categoryId: null,
  categoryName: null,
  channel: null,
  merchantKey: null,
  merchantLabel: null,
};

const RANGES = [
  { label: "This month", value: "month" },
  { label: "Last 30 days", value: "30d" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 90 days", value: "90d" },
  { label: "This year", value: "year" },
  { label: "All time", value: "all" },
] as const;

/** "2026-06-10" -> "10-Jun" */
function fmtDayLabel(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return `${day}-${month}`;
}

function rangeToMs(value: string): { from: number; to: number } {
  const now = new Date();
  const to = now.getTime();
  switch (value) {
    case "7d":
      return { from: to - 7 * 864e5, to };
    case "30d":
      return { from: to - 30 * 864e5, to };
    case "90d":
      return { from: to - 90 * 864e5, to };
    case "year":
      return { from: new Date(now.getFullYear(), 0, 1).getTime(), to };
    case "all":
      return { from: 0, to };
    default:
      return { from: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), to };
  }
}

/** % change vs. the immediately preceding period of equal length. Rises in spend are shown as "worse" (negative tone) regardless of raw sign, since more spend is the unwanted direction. */
function DeltaBadge({ current, prior, invert }: { current: number; prior: number; invert?: boolean }) {
  if (prior === 0) return null;
  const pct = Math.round(((current - prior) / prior) * 100);
  if (pct === 0) return null;
  const rose = pct > 0;
  const good = invert ? !rose : rose;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[11px] font-medium",
        good ? "text-positive" : "text-negative",
      )}
    >
      {rose ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {Math.abs(pct)}%
    </span>
  );
}

function StatCard({
  label,
  amount,
  format,
  compactFormat,
  icon,
  tone,
  delta,
}: {
  label: string;
  /** Raw numeric value (paise, or a plain count) — animated with a count-up tween. */
  amount: number;
  format: (n: number) => string;
  /** Shorter rendering shown below the `sm` breakpoint, where a 2-col grid leaves little room. */
  compactFormat?: (n: number) => string;
  icon: React.ReactNode;
  tone?: "positive" | "negative";
  delta?: React.ReactNode;
}) {
  const animated = useCountUp(amount);
  return (
    <Card elevation="raised" className="flex items-center gap-3.5 p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card-2 text-muted">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
          {label}
          {delta}
        </p>
        <p
          className={cn(
            "truncate text-lg font-semibold tabular-nums tracking-tight",
            tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "",
          )}
        >
          {compactFormat ? (
            <>
              <span className="sm:hidden">{compactFormat(animated)}</span>
              <span className="hidden sm:inline">{format(animated)}</span>
            </>
          ) : (
            format(animated)
          )}
        </p>
      </div>
    </Card>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      onClick={onClear}
      className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 py-1 pl-3 pr-2 text-[12px] font-medium text-accent"
    >
      {label}
      <X className="h-3 w-3" />
    </button>
  );
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color?: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line bg-card px-3 py-2 text-[12px] shadow-lg">
      <p className="mb-1 font-medium">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="text-muted">
          {p.name}: <span className="font-medium text-fg">{formatINR(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

export function Dashboard() {
  const [range, setRange] = useState<string>("month");
  const [slice, setSlice] = useState<Slice>(EMPTY_SLICE);
  const { from, to } = useMemo(() => rangeToMs(range), [range]);
  const keyed = useE2EOptional()?.status === "ready";

  const analyticsUrl = useMemo(() => {
    const p = new URLSearchParams({ from: String(from), to: String(to) });
    if (slice.categoryId !== null) p.set("categoryId", slice.categoryId);
    if (slice.channel !== null) p.set("channel", slice.channel);
    if (slice.merchantKey !== null) p.set("merchant", slice.merchantKey);
    return `/api/analytics?${p.toString()}`;
  }, [from, to, slice]);
  const server = useSWR<Analytics>(!keyed ? analyticsUrl : null, { keepPreviousData: true });

  // Keyed: no server aggregation possible over ciphertext — compute the same
  // shape client-side from decrypted rows (shared computeAnalytics core).
  const { rows: txnRows, isLoading: txnLoading } = useTransactions();
  const { data: catsData } = useSWR<{ rows: CategoryLite[] }>(keyed ? "/api/categories" : null);
  const clientAnalytics = useMemo<Analytics | null>(() => {
    if (!keyed || !catsData) return null;
    const yearAgo = Date.now() - 366 * 24 * 3600 * 1000;
    const analyticsRows: AnalyticsRow[] = txnRows
      .filter((t) => t.deletedAt == null)
      .map((t) => ({
        occurredAt: t.occurredAt,
        amountPaise: t.amountPaise,
        direction: t.direction,
        categoryId: t.categoryId,
        channel: t.channel,
        merchant: t.merchantNormalized ?? null,
        merchantRaw: t.merchant,
      }));
    return computeAnalytics(analyticsRows, catsData.rows, {
      from,
      to,
      yearAgo,
      filterCategory: slice.categoryId,
      filterChannel: slice.channel,
      filterMerchant: slice.merchantKey,
    });
  }, [keyed, catsData, txnRows, from, to, slice]);

  const data = keyed ? clientAnalytics : server.data;
  const isLoading = keyed ? txnLoading || !catsData : server.isLoading;
  const isValidating = keyed ? false : server.isValidating;

  const sliceActive = slice.categoryId !== null || slice.channel !== null || slice.merchantKey !== null;
  const ledgerHref = useMemo(() => {
    const p = new URLSearchParams();
    if (slice.categoryId !== null) p.set("category", slice.categoryId === "__none__" ? "uncategorized" : slice.categoryId);
    if (slice.channel !== null) p.set("channel", slice.channel);
    if (slice.merchantKey !== null) p.set("q", slice.merchantLabel ?? slice.merchantKey);
    return `/ledger?${p.toString()}`;
  }, [slice]);

  function toggleCategory(id: string, name: string) {
    setSlice((s) => (s.categoryId === id ? { ...s, categoryId: null, categoryName: null } : { ...s, categoryId: id, categoryName: name }));
  }
  function toggleChannel(channel: string) {
    setSlice((s) => (s.channel === channel ? { ...s, channel: null } : { ...s, channel }));
  }
  function toggleMerchant(key: string, label: string) {
    setSlice((s) => (s.merchantKey === key ? { ...s, merchantKey: null, merchantLabel: null } : { ...s, merchantKey: key, merchantLabel: label }));
  }

  if ((isLoading && !data) || !data) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} elevation="raised" className="flex items-center gap-3.5 p-4">
              <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-5 w-20" />
              </div>
            </Card>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="h-72 p-4">
            <Skeleton className="h-full w-full rounded-xl" />
          </Card>
          <Card className="h-72 p-4">
            <Skeleton className="h-full w-full rounded-xl" />
          </Card>
        </div>
      </div>
    );
  }

  const { totals, previous } = data;
  const maxCat = data.byCategory[0]?.total ?? 1;
  const maxMerchant = data.topMerchants[0]?.total ?? 1;
  const monthData = data.byMonth.map((m) => ({
    ...m,
    label: new Date(`${m.month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" }),
    debitR: m.debit / 100,
  }));
  const dayData = data.byDay.map((d) => ({
    ...d,
    label: fmtDayLabel(d.date),
    debitR: d.debit / 100,
    creditR: d.credit / 100,
  }));

  const empty = totals.count === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {slice.categoryName !== null && (
            <FilterChip
              label={`Category: ${slice.categoryName}`}
              onClear={() => setSlice((s) => ({ ...s, categoryId: null, categoryName: null }))}
            />
          )}
          {slice.channel !== null && (
            <FilterChip label={`Channel: ${slice.channel}`} onClear={() => setSlice((s) => ({ ...s, channel: null }))} />
          )}
          {slice.merchantLabel !== null && (
            <FilterChip
              label={`Merchant: ${slice.merchantLabel}`}
              onClear={() => setSlice((s) => ({ ...s, merchantKey: null, merchantLabel: null }))}
            />
          )}
          {sliceActive && (
            <button onClick={() => setSlice(EMPTY_SLICE)} className="text-[12px] font-medium text-muted hover:text-fg">
              Clear all
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {sliceActive && !empty && (
            <a href={ledgerHref}>
              <Button variant="secondary" size="sm">
                View in Ledger
              </Button>
            </a>
          )}
          <Select value={range} onChange={(e) => setRange(e.target.value)} aria-label="Date range">
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div data-tour="overview-stats" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Spent"
          amount={totals.debit}
          format={formatINR}
          compactFormat={(n) => formatINR(n, { compact: true })}
          tone="negative"
          icon={<ArrowUpRight className="h-5 w-5" />}
          delta={previous && <DeltaBadge current={totals.debit} prior={previous.debit} invert />}
        />
        <StatCard
          label="Received"
          amount={totals.credit}
          format={formatINR}
          compactFormat={(n) => formatINR(n, { compact: true })}
          tone="positive"
          icon={<ArrowDownLeft className="h-5 w-5" />}
          delta={previous && <DeltaBadge current={totals.credit} prior={previous.credit} />}
        />
        <StatCard
          label="Net"
          amount={totals.net}
          format={formatINR}
          compactFormat={(n) => formatINR(n, { compact: true })}
          icon={<ReceiptText className="h-5 w-5" />}
          delta={previous && <DeltaBadge current={totals.net} prior={previous.credit - previous.debit} />}
        />
        <StatCard
          label="Transactions"
          amount={totals.count}
          format={(n) => String(Math.round(n))}
          icon={<Inbox className="h-5 w-5" />}
        />
      </div>

      {empty ? (
        <Card>
          <Empty
            icon={<Inbox className="h-8 w-8" />}
            title={sliceActive ? "No transactions match this filter" : "No transactions in this range"}
            hint={
              sliceActive
                ? "Try clearing a filter or widening the date range."
                : "Connect Gmail in Settings and run a sync, or try a wider date range."
            }
          >
            {sliceActive && (
              <Button variant="secondary" size="sm" onClick={() => setSlice(EMPTY_SLICE)} className="mt-1">
                Clear filters
              </Button>
            )}
          </Empty>
        </Card>
      ) : (
        <>
          <div className={cn("grid gap-4 lg:grid-cols-2", isValidating && "opacity-60 transition-opacity")}>
            <Card>
              <CardHeader
                title="Daily activity"
                subtitle="Debits and credits in the selected range"
                action={
                  <div className="flex items-center gap-3 text-[11px] font-medium text-muted">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: "var(--negative)" }} />
                      Spent
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: "var(--positive)" }} />
                      Received
                    </span>
                  </div>
                }
              />
              <div className="h-56 px-2 pb-4 pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dayData} margin={{ top: 5, right: 12, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="debitFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--negative)" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="var(--negative)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)" }} tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                    <Tooltip content={({ active, payload, label }) => (
                      <ChartTooltip active={active} label={String(label)} payload={payload?.map((p) => ({ name: p.dataKey === "debitR" ? "Spent" : "Received", value: Math.round((p.value as number) * 100) }))} />
                    )} />
                    <Area type="monotone" dataKey="debitR" stroke="var(--negative)" strokeWidth={2} fill="url(#debitFill)" name="Spent" />
                    <Area type="monotone" dataKey="creditR" stroke="var(--positive)" strokeWidth={2} fill="transparent" name="Received" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <CardHeader title="Monthly trend" subtitle="Spend over the last 12 months" />
              <div className="h-56 px-2 pb-4 pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthData} margin={{ top: 5, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)" }} tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                    <Tooltip
                      cursor={{ fill: "var(--line)", opacity: 0.4 }}
                      content={({ active, payload, label }) => (
                        <ChartTooltip active={active} label={String(label)} payload={payload?.map((p) => ({ name: "Spent", value: Math.round((p.value as number) * 100) }))} />
                      )}
                    />
                    <Bar dataKey="debitR" fill="var(--accent)" radius={[6, 6, 0, 0]} name="Spent" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <div className={cn("grid gap-4 lg:grid-cols-3", isValidating && "opacity-60 transition-opacity")}>
            <Card>
              <CardHeader title="By category" subtitle="Click a category to slice the whole dashboard" />
              <div className="flex flex-col gap-2.5 px-5 pb-5 pt-2">
                {data.byCategory.slice(0, 8).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => toggleCategory(c.id, c.name)}
                    className={cn(
                      "-mx-2 rounded-lg px-2 py-1 text-left transition-colors hover:bg-card-2",
                      slice.categoryId === c.id && "bg-card-2 ring-1 ring-accent/40",
                    )}
                  >
                    <div className="mb-1 flex items-baseline justify-between text-[13px]">
                      <span className="flex items-center gap-2 font-medium">
                        <span
                          className="category-dot h-2.5 w-2.5 rounded-full"
                          style={{ background: c.color, "--dot-color": c.color } as React.CSSProperties}
                        />
                        {c.name}
                      </span>
                      <span className="tabular-nums text-muted">{formatINR(c.total)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-card-2">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(3, (c.total / maxCat) * 100)}%`, background: c.color }} />
                    </div>
                  </button>
                ))}
              </div>
            </Card>

            <Card>
              <CardHeader title="Top merchants" subtitle="Click a merchant to slice the whole dashboard" />
              <div className="flex flex-col px-5 pb-5 pt-2">
                {data.topMerchants.slice(0, 8).map((m) => (
                  <button
                    key={m.key}
                    onClick={() => toggleMerchant(m.key, m.label)}
                    className={cn(
                      "-mx-2 flex items-center justify-between rounded-lg border-b border-line px-2 py-2 text-left text-[13px] transition-colors last:border-0 hover:bg-card-2",
                      slice.merchantKey === m.key && "bg-card-2 ring-1 ring-accent/40",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium capitalize">{m.label}</p>
                      <p className="text-[12px] text-muted">{m.count} txn{m.count > 1 ? "s" : ""}</p>
                    </div>
                    <div className="ml-3 flex flex-col items-end">
                      <span className="tabular-nums font-medium">{formatINR(m.total)}</span>
                      <span className="h-1 w-16 overflow-hidden rounded-full bg-card-2">
                        <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(4, (m.total / maxMerchant) * 100)}%` }} />
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </Card>

            <Card>
              <CardHeader title="By channel" subtitle="Click a channel to slice the whole dashboard" />
              <div className="flex flex-col px-5 pb-5 pt-2">
                {data.byChannel.map((ch) => {
                  const pct = totals.debit ? Math.round((ch.total / totals.debit) * 100) : 0;
                  return (
                    <button
                      key={ch.channel}
                      onClick={() => toggleChannel(ch.channel)}
                      className={cn(
                        "-mx-2 flex items-center justify-between rounded-lg border-b border-line px-2 py-2.5 text-left text-[13px] transition-colors last:border-0 hover:bg-card-2",
                        slice.channel === ch.channel && "bg-card-2 ring-1 ring-accent/40",
                      )}
                    >
                      <span className="font-medium">{ch.channel}</span>
                      <span className="tabular-nums text-muted">
                        {formatINR(ch.total)} <span className="ml-1 text-[11px]">({pct}%)</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
