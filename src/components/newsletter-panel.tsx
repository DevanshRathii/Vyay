"use client";

import { Mail, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { Button, Card, CardHeader, ConfirmButton, Input, Label } from "@/components/ui";

interface RecipientPreview {
  count: number;
  emails: string[];
}

/** Feature-announcement newsletter to test users — see the "shipping a
 *  major feature" checklist in CLAUDE.md. Sends one real email per
 *  recipient (never a single email with everyone bcc'd) via the same Gmail
 *  SMTP transporter already used for admin notifications. */
export function NewsletterPanel() {
  const { data: preview } = useSWR<RecipientPreview>("/api/admin/newsletter");
  const [title, setTitle] = useState("");
  const [paragraphs, setParagraphs] = useState([""]);
  const [ctaLabel, setCtaLabel] = useState("Try it now");
  const [ctaUrl, setCtaUrl] = useState("https://vyay-five.vercel.app");
  const [footerNote, setFooterNote] = useState("");
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const cleanParagraphs = paragraphs.map((p) => p.trim()).filter(Boolean);
  const canSend = title.trim().length > 0 && cleanParagraphs.length > 0 && ctaLabel.trim().length > 0 && ctaUrl.trim().length > 0;

  function updateParagraph(i: number, value: string) {
    setParagraphs((prev) => prev.map((p, idx) => (idx === i ? value : p)));
  }
  function addParagraph() {
    if (paragraphs.length < 6) setParagraphs((prev) => [...prev, ""]);
  }
  function removeParagraph(i: number) {
    setParagraphs((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function send() {
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          paragraphs: cleanParagraphs,
          ctaLabel: ctaLabel.trim(),
          ctaUrl: ctaUrl.trim(),
          footerNote: footerNote.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn't send — try again.");
      setResult({ sent: body.sent, failed: body.failed });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send — try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Send feature newsletter"
        subtitle="Notify test users when you ship something worth trying — one real email per recipient"
      />
      <div className="flex flex-col gap-3 px-5 pb-5 pt-2 text-[13px]">
        <p className="rounded-xl bg-card-2 px-3.5 py-2.5 text-[12px] text-muted">
          Sends to {preview ? `${preview.count} tester${preview.count === 1 ? "" : "s"}` : "…"} with Gmail access
          granted (excluding your own account).
        </p>
        <div>
          <Label htmlFor="nl-title">Title</Label>
          <Input id="nl-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New: import bank statements" maxLength={120} />
        </div>
        <div className="flex flex-col gap-2">
          <Label>Body</Label>
          {paragraphs.map((p, i) => (
            <div key={i} className="flex gap-2">
              <textarea
                value={p}
                onChange={(e) => updateParagraph(i, e.target.value)}
                placeholder="One short paragraph — this is a nudge to go try it, not a changelog."
                rows={2}
                maxLength={1000}
                className="w-full resize-none rounded-xl border border-line bg-card px-3.5 py-2.5 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none"
              />
              {paragraphs.length > 1 && (
                <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => removeParagraph(i)} aria-label="Remove paragraph">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
          {paragraphs.length < 6 && (
            <Button variant="secondary" size="sm" className="w-fit" onClick={addParagraph}>
              <Plus className="h-3.5 w-3.5" /> Add paragraph
            </Button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="nl-cta-label">Button text</Label>
            <Input id="nl-cta-label" value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} maxLength={40} />
          </div>
          <div>
            <Label htmlFor="nl-cta-url">Button link</Label>
            <Input id="nl-cta-url" value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} maxLength={300} />
          </div>
        </div>
        <div>
          <Label htmlFor="nl-footer">Footer note (optional)</Label>
          <Input id="nl-footer" value={footerNote} onChange={(e) => setFooterNote(e.target.value)} placeholder="Reply to this email to tell us what broke." maxLength={300} />
        </div>
        {error && <p className="rounded-xl bg-negative/10 px-3.5 py-2.5 text-[12px] text-negative">{error}</p>}
        {result && (
          <p className="rounded-xl bg-positive/10 px-3.5 py-2.5 text-[12px] text-positive">
            Sent to {result.sent} tester{result.sent === 1 ? "" : "s"}
            {result.failed > 0 && ` — ${result.failed} failed`}.
          </p>
        )}
        <ConfirmButton
          className="w-fit"
          disabled={!canSend || sending || !preview?.count}
          confirmTitle="Send this newsletter?"
          confirmMessage={`This emails ${preview?.count ?? 0} tester${preview?.count === 1 ? "" : "s"} right now — there's no undo.`}
          confirmLabel="Send"
          onConfirm={send}
        >
          <Mail className="h-3.5 w-3.5" /> Send to {preview?.count ?? "…"} tester{preview?.count === 1 ? "" : "s"}
        </ConfirmButton>
      </div>
    </Card>
  );
}
