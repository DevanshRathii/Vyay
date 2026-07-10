"use client";

import { ArrowDownLeft, ArrowUpRight, Inbox, ReceiptText } from "lucide-react";
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
import { Card, CardHeader, Empty, Select, Spinner } from "@/components/ui";
import { formatINR } from "@/lib/utils";

interface Analytics {
  totals: { debit: number; credit: number; count: number; net: number };
  byCategory: Array<{ id: string; name: string; color: string; total: number }>;
  byChannel: Array<{ channel: string; total: number }>;
  topMerchants: Array<{ label: string; total: number; count: number }>;
  byDay: Array<{ date: string; debit: number; credit: number }>;
  byMonth: Array<{ month: string; debit: number; credit: number }>;
}

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

function StatCard({
  label,
  value,
  compactValue,
  icon,
  tone,
}: {
  label: string;
  value: string;
  /** Shorter rendering shown below the `sm` breakpoint, where a 2-col grid leaves little room. */
  compactValue?: string;
  icon: React.ReactNode;
  tone?: "positive" | "negative";
}) {
  return (
    <Card className="flex items-center gap-3.5 p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card-2 text-muted">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[12px] font-medium text-muted">{label}</p>
        <p
          className={
            "truncate text-lg font-semibold tracking-tight " +
            (tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "")
          }
        >
          {compactValue ? (
            <>
              <span className="sm:hidden">{compactValue}</span>
              <span className="hidden sm:inline">{value}</span>
            </>
          ) : (
            value
          )}
        </p>
      </div>
    </Card>
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
  const { from, to } = useMemo(() => rangeToMs(range), [range]);
  const { data, isLoading } = useSWR<Analytics>(`/api/analytics?from=${from}&to=${to}`);

  if (isLoading || !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const { totals } = data;
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
      <div className="flex justify-end">
        <Select value={range} onChange={(e) => setRange(e.target.value)} aria-label="Date range">
          {RANGES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Spent"
          value={formatINR(totals.debit)}
          compactValue={formatINR(totals.debit, { compact: true })}
          tone="negative"
          icon={<ArrowUpRight className="h-5 w-5" />}
        />
        <StatCard
          label="Received"
          value={formatINR(totals.credit)}
          compactValue={formatINR(totals.credit, { compact: true })}
          tone="positive"
          icon={<ArrowDownLeft className="h-5 w-5" />}
        />
        <StatCard
          label="Net"
          value={formatINR(totals.net)}
          compactValue={formatINR(totals.net, { compact: true })}
          icon={<ReceiptText className="h-5 w-5" />}
        />
        <StatCard label="Transactions" value={String(totals.count)} icon={<Inbox className="h-5 w-5" />} />
      </div>

      {empty ? (
        <Card>
          <Empty
            icon={<Inbox className="h-8 w-8" />}
            title="No transactions in this range"
            hint="Connect Gmail in Settings and run a sync, or try a wider date range."
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Daily activity" subtitle="Debits and credits in the selected range" />
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

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader title="By category" subtitle="Where the money went" />
              <div className="flex flex-col gap-2.5 px-5 pb-5 pt-2">
                {data.byCategory.slice(0, 8).map((c) => (
                  <div key={c.id}>
                    <div className="mb-1 flex items-baseline justify-between text-[13px]">
                      <span className="flex items-center gap-2 font-medium">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                        {c.name}
                      </span>
                      <span className="tabular-nums text-muted">{formatINR(c.total)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-card-2">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(3, (c.total / maxCat) * 100)}%`, background: c.color }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <CardHeader title="Top merchants" subtitle="Biggest recipients this period" />
              <div className="flex flex-col px-5 pb-5 pt-2">
                {data.topMerchants.slice(0, 8).map((m, i) => (
                  <div key={m.label + i} className="flex items-center justify-between border-b border-line py-2 text-[13px] last:border-0">
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
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <CardHeader title="By channel" subtitle="UPI, cards, transfers" />
              <div className="flex flex-col px-5 pb-5 pt-2">
                {data.byChannel.map((ch) => {
                  const pct = totals.debit ? Math.round((ch.total / totals.debit) * 100) : 0;
                  return (
                    <div key={ch.channel} className="flex items-center justify-between border-b border-line py-2.5 text-[13px] last:border-0">
                      <span className="font-medium">{ch.channel}</span>
                      <span className="tabular-nums text-muted">
                        {formatINR(ch.total)} <span className="ml-1 text-[11px]">({pct}%)</span>
                      </span>
                    </div>
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
