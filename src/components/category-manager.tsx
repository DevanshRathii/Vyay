"use client";

import { Pencil, Plus, Tags, Trash2, Wand2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { Badge, Button, Card, CardHeader, ConfirmButton, Dialog, Empty, Input, Label, Select, Spinner } from "@/components/ui";

interface CategoryRow {
  id: string;
  name: string;
  color: string;
  txnCount: number;
}

interface RuleRow {
  id: string;
  pattern: string;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
}

const PALETTE = [
  "#0071e3", "#1f9d55", "#e02d3c", "#f59e0b", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#8e8e93",
];

export function CategoryManager() {
  const { data: cats, mutate: mutateCats } = useSWR<{ rows: CategoryRow[] }>("/api/categories");
  const { data: rules, mutate: mutateRules } = useSWR<{ rows: RuleRow[] }>("/api/rules");

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function createCategory(name: string, color: string) {
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color }),
    });
    if (res.ok) {
      setCreating(false);
      mutateCats();
    } else {
      const body = await res.json().catch(() => ({}));
      setNotice(body.error ?? "Could not create category.");
    }
  }

  async function updateCategory(id: string, body: { name?: string; color?: string }) {
    await fetch(`/api/categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setEditing(null);
    mutateCats();
    mutateRules();
  }

  async function deleteCategory(id: string) {
    const res = await fetch(`/api/categories/${id}`, { method: "DELETE" });
    mutateCats();
    mutateRules();
    if (!res.ok) throw new Error("Couldn't delete that category — try again.");
    setEditing(null);
  }

  async function createRule(pattern: string, categoryId: string, applyToExisting: boolean) {
    const res = await fetch("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pattern, categoryId, applyToExisting }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      setRuleOpen(false);
      setNotice(applyToExisting ? `Rule added — applied to ${body.applied} existing transaction${body.applied === 1 ? "" : "s"}.` : "Rule added.");
      mutateRules();
    } else {
      setNotice(body.error ?? "Could not create rule.");
    }
  }

  async function deleteRule(id: string) {
    const res = await fetch(`/api/rules/${id}`, { method: "DELETE" });
    mutateRules();
    if (!res.ok) throw new Error("Couldn't delete that rule — try again.");
  }

  if (!cats) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {notice && (
        <div className="flex items-center justify-between rounded-xl border border-line bg-card px-4 py-2.5 text-[13px]">
          <span>{notice}</span>
          <button className="text-muted hover:text-fg" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      <Card data-tour="categories-list">
        <CardHeader
          title="Categories"
          subtitle="Used across the ledger, analytics, and the Apple Shortcut"
          action={
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" /> New
            </Button>
          }
        />
        <div className="grid gap-2 p-5 pt-3 sm:grid-cols-2 lg:grid-cols-3">
          {cats.rows.map((c) => (
            <Link
              key={c.id}
              href={`/ledger?category=${c.id}`}
              className="flex items-center justify-between rounded-xl border border-line bg-card-2/60 px-3.5 py-3 hover:border-accent/40"
              title={`View ${c.name} transactions in the Ledger`}
            >
              <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: c.color }} />
                <span className="truncate">{c.name}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-[12px] tabular-nums text-muted">{c.txnCount}</span>
                <button
                  type="button"
                  className="rounded-lg p-1 text-muted hover:bg-line/60 hover:text-fg"
                  onClick={(e) => {
                    e.preventDefault();
                    setEditing(c);
                  }}
                  aria-label={`Edit ${c.name}`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </span>
            </Link>
          ))}
          {cats.rows.length === 0 && (
            <div className="sm:col-span-2 lg:col-span-3">
              <Empty icon={<Tags className="h-7 w-7" />} title="No categories yet" hint="Create one to start organizing your spending." />
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Merchant rules"
          subtitle="Auto-categorize future emails whose merchant matches a pattern"
          action={
            <Button size="sm" variant="secondary" onClick={() => setRuleOpen(true)} disabled={cats.rows.length === 0}>
              <Wand2 className="h-3.5 w-3.5" /> Add rule
            </Button>
          }
        />
        <div className="flex flex-col px-5 pb-5 pt-2">
          {(rules?.rows ?? []).map((r) => (
            <div key={r.id} className="flex items-center justify-between border-b border-line py-2.5 last:border-0">
              <div className="flex min-w-0 items-center gap-2.5 text-[13px]">
                <code className="rounded-md bg-card-2 px-2 py-0.5 font-mono text-[12px]">{r.pattern}</code>
                <span className="text-muted">→</span>
                <Badge color={r.categoryColor}>{r.categoryName}</Badge>
              </div>
              <ConfirmButton
                size="icon"
                className="h-8 w-8"
                aria-label="Delete rule"
                confirmTitle="Delete this rule?"
                confirmMessage={
                  <>
                    Future emails matching <code className="rounded bg-card-2 px-1 font-mono text-[12px]">{r.pattern}</code> will
                    no longer auto-categorize into {r.categoryName}.
                  </>
                }
                onConfirm={() => deleteRule(r.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </ConfirmButton>
            </div>
          ))}
          {rules && rules.rows.length === 0 && (
            <p className="py-4 text-[13px] text-muted">
              No rules yet. Example: pattern <code className="rounded bg-card-2 px-1.5 font-mono text-[12px]">swiggy</code> → Food, applied automatically on every sync.
            </p>
          )}
        </div>
      </Card>

      <CategoryDialog
        open={creating}
        title="New category"
        onClose={() => setCreating(false)}
        onSubmit={(name, color) => createCategory(name, color)}
      />
      <CategoryDialog
        open={!!editing}
        title="Edit category"
        initialName={editing?.name}
        initialColor={editing?.color}
        onClose={() => setEditing(null)}
        onSubmit={(name, color) => editing && updateCategory(editing.id, { name, color })}
        onDelete={editing ? () => deleteCategory(editing.id) : undefined}
        deleteHint={editing?.txnCount ? `${editing.txnCount} transaction${editing.txnCount === 1 ? "" : "s"} will become uncategorized.` : undefined}
      />
      <RuleDialog open={ruleOpen} cats={cats.rows} onClose={() => setRuleOpen(false)} onSubmit={createRule} />
    </div>
  );
}

function CategoryDialog({
  open,
  title,
  initialName,
  initialColor,
  onClose,
  onSubmit,
  onDelete,
  deleteHint,
}: {
  open: boolean;
  title: string;
  initialName?: string;
  initialColor?: string;
  onClose: () => void;
  onSubmit: (name: string, color: string) => void;
  onDelete?: () => Promise<void>;
  deleteHint?: string;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [seed, setSeed] = useState<string | undefined>(undefined);
  const dialogSeed = `${title}:${initialName ?? ""}:${open}`;
  if (open && seed !== dialogSeed) {
    setSeed(dialogSeed);
    setName(initialName ?? "");
    setColor(initialColor ?? PALETTE[0]);
  }

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-4">
        <div>
          <Label htmlFor="cat-name">Name</Label>
          <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Groceries" />
        </div>
        <div>
          <Label>Color</Label>
          <div className="flex flex-wrap gap-2">
            {PALETTE.map((c) => (
              <button
                key={c}
                className="h-8 w-8 rounded-full border-2"
                style={{ background: c, borderColor: color === c ? "var(--fg)" : "transparent" }}
                onClick={() => setColor(c)}
                aria-label={`Color ${c}`}
              />
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between pt-1">
          {onDelete ? (
            <div className="flex flex-col">
              <ConfirmButton
                size="sm"
                confirmTitle="Delete this category?"
                confirmMessage={
                  deleteHint
                    ? `${deleteHint} This can't be undone.`
                    : "This can't be undone."
                }
                onConfirm={onDelete}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </ConfirmButton>
              {deleteHint && <span className="mt-1 max-w-[180px] text-[11px] text-muted">{deleteHint}</span>}
            </div>
          ) : (
            <span />
          )}
          <Button disabled={!name.trim()} onClick={() => onSubmit(name.trim(), color)}>
            Save
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function RuleDialog({
  open,
  cats,
  onClose,
  onSubmit,
}: {
  open: boolean;
  cats: CategoryRow[];
  onClose: () => void;
  onSubmit: (pattern: string, categoryId: string, applyToExisting: boolean) => void;
}) {
  const [pattern, setPattern] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [applyToExisting, setApplyToExisting] = useState(true);

  return (
    <Dialog open={open} onClose={onClose} title="New merchant rule">
      <div className="flex flex-col gap-4">
        <div>
          <Label htmlFor="rule-pattern">Merchant contains</Label>
          <Input id="rule-pattern" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="e.g. swiggy" maxLength={60} />
          <p className="mt-1.5 text-[12px] text-muted">Case-insensitive match against merchant name, UPI ID, and email subject.</p>
        </div>
        <div>
          <Label htmlFor="rule-cat">Assign category</Label>
          <Select id="rule-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full">
            <option value="">Choose…</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={applyToExisting} onChange={(e) => setApplyToExisting(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
          Also apply to existing uncategorized transactions
        </label>
        <div className="flex justify-end">
          <Button disabled={pattern.trim().length < 2 || !categoryId} onClick={() => onSubmit(pattern.trim(), categoryId, applyToExisting)}>
            Add rule
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
