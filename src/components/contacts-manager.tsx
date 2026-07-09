"use client";

import { Trash2, Upload, Users } from "lucide-react";
import { useRef, useState } from "react";
import useSWR from "swr";
import { Button, Card, CardHeader, Empty, Spinner } from "@/components/ui";

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

export function ContactsManager() {
  const { data, mutate } = useSWR<{ rows: ContactRow[] }>("/api/contacts");
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
    mutate();
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
        <div className="flex flex-col px-5 pb-5 pt-2">
          {!data ? (
            <div className="flex h-32 items-center justify-center">
              <Spinner />
            </div>
          ) : data.rows.length === 0 ? (
            <Empty
              icon={<Users className="h-7 w-7" />}
              title="No contacts yet"
              hint="Import a .vcf contacts export — banks show a UPI id (like a phone number or handle), not always a name. A matching contact always wins over whatever the bank email says."
            />
          ) : (
            data.rows.map((c) => (
              <div key={c.id} className="flex items-center justify-between border-b border-line py-2.5 text-[13px] last:border-0">
                <div className="min-w-0">
                  <p className="font-medium">{c.name}</p>
                  {(c.phones.length > 0 || c.emails.length > 0) && (
                    <p className="truncate text-[12px] text-muted">{[...c.phones, ...c.emails].join(", ")}</p>
                  )}
                </div>
                <Button variant="danger" size="icon" className="h-8 w-8 shrink-0" onClick={() => deleteContact(c.id)} aria-label="Delete contact">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
