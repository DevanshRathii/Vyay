"use client";

import { Phone, Trash2, Upload, Users } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Button, Card, CardHeader, Dialog, Empty, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

interface ContactRow {
  id: string;
  name: string;
  phones: string[];
  emails: string[];
}

interface ImportSummary {
  parsed: number;
  imported: number;
  updated: number;
  skipped: number;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function letterFor(name: string): string {
  const first = name.trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(first) ? first : "#";
}

/** Groups contacts by first letter (Contacts-app style), sorted A-Z with "#" last. */
function groupContacts(rows: ContactRow[]): Map<string, ContactRow[]> {
  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name));
  const groups = new Map<string, ContactRow[]>();
  for (const c of sorted) {
    const letter = letterFor(c.name);
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter)!.push(c);
  }
  const ordered = new Map<string, ContactRow[]>();
  for (const letter of [...ALPHABET, "#"]) {
    if (groups.has(letter)) ordered.set(letter, groups.get(letter)!);
  }
  return ordered;
}

export function ContactsManager() {
  const { data, mutate } = useSWR<{ rows: ContactRow[] }>("/api/contacts");
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<ContactRow | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const grouped = useMemo(() => groupContacts(data?.rows ?? []), [data?.rows]);
  const availableLetters = useMemo(() => new Set(grouped.keys()), [grouped]);

  async function handleFile(file: File) {
    setImporting(true);
    setNotice(null);
    const text = await file.text();
    const res = await fetch("/api/contacts/import", {
      method: "POST",
      headers: { "Content-Type": "text/vcard" },
      body: text,
    });
    const body = await res.json().catch(() => ({}));
    setImporting(false);
    if (res.ok) {
      const s = body as ImportSummary;
      setNotice(
        `${s.parsed} contact${s.parsed === 1 ? "" : "s"} found — ${s.imported} new, ${s.updated} updated ` +
          `(already had this name, added a new phone number), ${s.skipped} skipped (no usable name, or an exact duplicate). ` +
          `Run “Re-parse” in Settings to apply these to already-imported transactions.`,
      );
      mutate();
    } else {
      setNotice(body.error ?? "Could not import that file.");
    }
  }

  async function deleteContact(id: string) {
    await fetch(`/api/contacts/${id}`, { method: "DELETE" });
    setSelected(null);
    mutate();
  }

  function jumpTo(letter: string) {
    document.getElementById(`contact-letter-${letter}`)?.scrollIntoView({ block: "start" });
  }

  return (
    <div className="flex flex-col gap-4">
      {notice && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-card px-4 py-2.5 text-[13px]">
          <span>{notice}</span>
          <button className="shrink-0 text-muted hover:text-fg" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      <Card>
        <CardHeader
          title="Contacts"
          subtitle="Names & phone numbers used to identify who a UPI transaction was really with"
          action={
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".vcf,text/vcard"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                  e.target.value = "";
                }}
              />
              <Button size="sm" disabled={importing} onClick={() => fileRef.current?.click()}>
                {importing ? <Spinner className="h-3.5 w-3.5" /> : <Upload className="h-3.5 w-3.5" />}
                Import .vcf
              </Button>
            </>
          }
        />
        {!data ? (
          <div className="flex h-32 items-center justify-center">
            <Spinner />
          </div>
        ) : data.rows.length === 0 ? (
          <div className="px-5 pb-5 pt-2">
            <Empty
              icon={<Users className="h-7 w-7" />}
              title="No contacts yet"
              hint="Import a .vcf contacts export — banks show a UPI id (like a phone number or handle), not always a name. A matching contact always wins over whatever the bank email says."
            />
          </div>
        ) : (
          <div className="relative flex">
            <div ref={listRef} className="max-h-[70dvh] flex-1 overflow-y-auto px-5 pb-5 pt-2">
              {[...grouped.entries()].map(([letter, contacts]) => (
                <div key={letter} id={`contact-letter-${letter}`} className="scroll-mt-2">
                  <p className="sticky top-0 z-10 -mx-5 bg-card px-5 py-1 text-[12px] font-semibold text-muted">{letter}</p>
                  {contacts.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setSelected(c)}
                      className="flex w-full items-center justify-between border-b border-line py-2.5 text-left text-[13px] last:border-0 hover:bg-card-2/60"
                    >
                      <div className="min-w-0">
                        <p className="font-medium">{c.name}</p>
                        {(c.phones.length > 0 || c.emails.length > 0) && (
                          <p className="truncate text-[12px] text-muted">{[...c.phones, ...c.emails].join(", ")}</p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
            {/* A-Z index rail — Contacts-app style. Letters with no contacts are dimmed but still tappable-inert. */}
            <div className="flex w-6 shrink-0 flex-col items-center justify-center gap-[1px] py-2 pr-1 text-[9px] font-medium sm:w-7 sm:text-[10px]">
              {[...ALPHABET, "#"].map((letter) => {
                const has = availableLetters.has(letter);
                return (
                  <button
                    key={letter}
                    type="button"
                    disabled={!has}
                    onClick={() => jumpTo(letter)}
                    className={cn("leading-none", has ? "text-accent hover:font-semibold" : "text-muted/40")}
                    aria-label={has ? `Jump to ${letter}` : undefined}
                    tabIndex={has ? 0 : -1}
                  >
                    {letter}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      {/* Detail view — read-only contact info; delete lives here, not on the list row. */}
      <Dialog open={!!selected} onClose={() => setSelected(null)} title={selected?.name ?? "Contact"}>
        {selected && (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl bg-card-2 p-3.5 text-[13px]">
              {selected.phones.length === 0 && selected.emails.length === 0 ? (
                <p className="text-muted">No phone number or email on file for this contact.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {selected.phones.map((p) => (
                    <p key={p} className="flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5 shrink-0 text-muted" /> {p}
                    </p>
                  ))}
                  {selected.emails.map((e) => (
                    <p key={e} className="flex items-center gap-2">
                      <span className="w-3.5 shrink-0 text-center text-muted">@</span> {e}
                    </p>
                  ))}
                </div>
              )}
            </div>
            <p className="text-[12px] text-muted">
              Matched against the UPI id and beneficiary name in your bank alerts — a match here always wins over
              whatever name the bank email itself included.
            </p>
            <div className="flex justify-end">
              <Button variant="danger" size="sm" onClick={() => deleteContact(selected.id)}>
                <Trash2 className="h-3.5 w-3.5" /> Delete contact
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
