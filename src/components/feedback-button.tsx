"use client";

import { LifeBuoy } from "lucide-react";
import { useState } from "react";
import { Button, Dialog } from "@/components/ui";
import { cn } from "@/lib/utils";

export function UrgentFeedbackButton() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  function close() {
    setOpen(false);
    setTimeout(() => {
      setMessage("");
      setSent(false);
    }, 200);
  }

  async function submit() {
    if (!message.trim()) return;
    setSubmitting(true);
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim() }),
      });
      setSent(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        data-tour="urgent-feedback"
        onClick={() => setOpen(true)}
        className={cn(
          "fixed bottom-24 right-4 z-30 flex items-center gap-1.5 rounded-full px-4 py-2.5",
          "bg-negative text-[13px] font-medium text-white shadow-lg shadow-negative/30 hover:opacity-90",
          "sm:bottom-6 sm:right-6",
        )}
      >
        <LifeBuoy className="h-4 w-4" />
        Feedback
      </button>

      <Dialog open={open} onClose={close} title="Report a blocking bug">
        {sent ? (
          <div className="py-2 text-[13px] text-fg">
            Sent — thanks, this&apos;ll get looked at as a priority.
            <Button className="mt-4 w-full" onClick={close}>
              Done
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-muted">
              Use this only for something that&apos;s actively blocking you — a broken sync, a crash, data that
              looks wrong. It goes straight to Devansh.
            </p>
            <textarea
              autoFocus
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What's broken, and what were you trying to do?"
              rows={4}
              className="w-full resize-none rounded-xl border border-line bg-card px-3.5 py-2.5 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none"
            />
            <Button onClick={submit} disabled={submitting || !message.trim()}>
              {submitting ? "Sending…" : "Send"}
            </Button>
          </div>
        )}
      </Dialog>
    </>
  );
}
