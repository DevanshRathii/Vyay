"use client";

import { createContext, useContext, useEffect, useState } from "react";
import useSWR from "swr";
import { Button, Card, Input, Label, Spinner } from "@/components/ui";
import { generateKeypair, makeKeyCheck, openWithKey, sealForUser, type E2EDecryptError } from "@/lib/e2e-crypto";
import { clearKey, loadKey, saveKey, verifyKey } from "@/lib/key-store";

type Status = "checking" | "setup-required" | "locked" | "ready";

interface E2EContextValue {
  status: Status;
  publicKey: string | null;
  /** Decrypts a sealed blob. Throws E2EDecryptError if not `ready`. */
  decrypt: <T = unknown>(blob: string) => T;
  /** Seals a value for the current user. Throws if not `ready`. */
  seal: (obj: unknown) => string;
  unlock: (pastedKey: string) => Promise<boolean>;
  resetKey: () => Promise<void>;
}

const E2EContext = createContext<E2EContextValue | null>(null);

/** Use inside the (app) layout tree only — throws outside a KeyProvider. */
export function useE2E(): E2EContextValue {
  const ctx = useContext(E2EContext);
  if (!ctx) throw new Error("useE2E must be used within a KeyProvider");
  return ctx;
}

/** Same as useE2E(), but returns null instead of throwing — for components
 *  shared with /demo, which never mounts a KeyProvider. */
export function useE2EOptional(): E2EContextValue | null {
  return useContext(E2EContext);
}

interface StatusResponse {
  hasKey: boolean;
  publicKey: string | null;
  keyCheck: string | null;
  backfillRemaining: number;
}

export function KeyProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const { data, mutate } = useSWR<StatusResponse>("/api/e2e/status");
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    if (!data) return;
    if (!data.hasKey) {
      // Every real signed-in account is required to onboard onto zero-access
      // encryption at next sign-in — there's no steady-state "skip this"
      // path here. /demo never mounts KeyProvider at all, so it's unaffected.
      setStatus("setup-required");
      return;
    }
    const local = loadKey(userId);
    if (local) {
      setPrivateKey(local);
      setStatus("ready");
    } else {
      setStatus("locked");
    }
  }, [data, userId]);

  async function completeSetup(newPrivateKey: string) {
    saveKey(userId, newPrivateKey);
    setPrivateKey(newPrivateKey);
    setStatus("ready");
    await mutate();
  }

  async function unlock(pastedKey: string): Promise<boolean> {
    if (!data?.publicKey || !data?.keyCheck) return false;
    if (!verifyKey(pastedKey, data.keyCheck, data.publicKey)) return false;
    saveKey(userId, pastedKey);
    setPrivateKey(pastedKey);
    setStatus("ready");
    return true;
  }

  async function resetKey() {
    clearKey(userId);
    setPrivateKey(null);
    setStatus("checking");
    await mutate();
  }

  const value: E2EContextValue = {
    status,
    publicKey: data?.publicKey ?? null,
    decrypt: <T,>(blob: string) => {
      if (!privateKey) throw new Error("Not unlocked") as E2EDecryptError;
      return openWithKey<T>(privateKey, blob);
    },
    seal: (obj: unknown) => {
      if (!data?.publicKey) throw new Error("No public key on file");
      return sealForUser(data.publicKey, obj);
    },
    unlock,
    resetKey,
  };

  if (status === "checking") {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (status === "setup-required") {
    return <SetupScreen userId={userId} onComplete={completeSetup} />;
  }

  if (status === "locked") {
    return <LockedScreen onUnlock={unlock} />;
  }

  return <E2EContext.Provider value={value}>{children}</E2EContext.Provider>;
}

/** Blocking one-time-reveal screen shown right after a fresh sign-in for an
 *  account that hasn't onboarded onto zero-access encryption yet. */
function SetupScreen({ userId, onComplete }: { userId: string; onComplete: (privateKey: string) => Promise<void> }) {
  const [keypair] = useState(() => generateKeypair());
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backfillRemaining, setBackfillRemaining] = useState<number | null>(null);

  async function copy() {
    await navigator.clipboard.writeText(keypair.privateKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadKeyFile() {
    const blob = new Blob(
      [
        `Vyay personal key\n\nKeep this safe — it is the ONLY way to decrypt your data.\nVyay cannot recover it if lost.\n\n${keypair.privateKey}\n`,
      ],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vyay-personal-key.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const keyCheck = makeKeyCheck(keypair.publicKey);
      const res = await fetch("/api/e2e/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey: keypair.publicKey, keyCheck }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Setup failed.");
      }
      await onComplete(keypair.privateKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed.");
      setBusy(false);
    }
  }

  useEffect(() => {
    if (busy) return; // stop polling once onComplete() has taken over
    let cancelled = false;
    const poll = setInterval(async () => {
      const res = await fetch("/api/e2e/status").catch(() => null);
      if (!res?.ok || cancelled) return;
      const body = await res.json();
      if (body.hasKey) setBackfillRemaining(body.backfillRemaining);
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [busy]);

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 py-8">
      <Card className="p-5">
        <h1 className="text-[17px] font-semibold tracking-tight">Set up zero-access encryption</h1>
        <p className="mt-1.5 text-[13px] text-muted">
          Your transactions are sealed with a key only you hold. A database breach — or even Vyay&apos;s operator —
          cannot read your financial data.
        </p>
        <p className="mt-3 rounded-xl bg-card-2 px-3.5 py-2.5 text-[12px] text-muted">
          If you lose this key, Vyay cannot recover your data — you&apos;d reset your key and re-import from Gmail
          (notes and edits don&apos;t survive that).
        </p>

        <Label className="mt-4">Your personal key</Label>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-lg border border-line bg-card-2 px-3 py-2 text-[13px]">
            {keypair.privateKey}
          </code>
          <Button variant="secondary" size="sm" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <Button variant="secondary" size="sm" className="mt-2 w-full" onClick={downloadKeyFile}>
          Download key file (.txt)
        </Button>

        {/* A real password field inside a form gives browser/1Password/iCloud
            Keychain password managers something to offer to save — the
            sanctioned "backup" channel. Never submitted anywhere. */}
        <form className="mt-3" onSubmit={(e) => e.preventDefault()}>
          <Label htmlFor="vyay-key-username">Account (for your password manager)</Label>
          <input id="vyay-key-username" type="text" name="username" autoComplete="username" value={userId} readOnly className="sr-only" />
          <Label htmlFor="vyay-key-password" className="mt-2">
            Personal key (for your password manager)
          </Label>
          <input
            id="vyay-key-password"
            type="password"
            name="new-password"
            autoComplete="new-password"
            value={keypair.privateKey}
            readOnly
            className="w-full rounded-lg border border-line bg-card-2 px-3 py-2 text-[13px]"
          />
        </form>

        <label className="mt-4 flex items-start gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
          />
          I&apos;ve saved my key — I understand Vyay cannot recover it.
        </label>

        {error && <p className="mt-2 text-[13px] text-negative">{error}</p>}

        <Button className="mt-4 w-full" disabled={!confirmed || busy} onClick={submit}>
          {busy ? <Spinner className="border-white/40 border-t-white" /> : null}
          {busy ? "Setting up…" : "Continue"}
        </Button>

        {busy && (
          <p className="mt-2 text-center text-[12px] text-muted">
            {backfillRemaining === null
              ? "Sealing your existing data…"
              : backfillRemaining === 0
                ? "Done — loading your ledger…"
                : `Sealing existing data — ${backfillRemaining} left…`}
          </p>
        )}
      </Card>
    </div>
  );
}

/** Shown when the server has a public key on file but this browser has no
 *  local copy of the matching private key (new device, cleared storage). */
function LockedScreen({ onUnlock }: { onUnlock: (key: string) => Promise<boolean> }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const ok = await onUnlock(key.trim());
    if (!ok) {
      setError("That key doesn't match this account. Check for typos and try again.");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 py-8">
      <Card className="p-5">
        <h1 className="text-[17px] font-semibold tracking-tight">Enter your personal key</h1>
        <p className="mt-1.5 text-[13px] text-muted">
          This browser doesn&apos;t have your decryption key. Paste it below to unlock your ledger.
        </p>
        <Label className="mt-4">Personal key</Label>
        <Input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Paste your personal key…"
          className="font-mono"
        />
        {error && <p className="mt-2 text-[13px] text-negative">{error}</p>}
        <Button className="mt-4 w-full" disabled={!key.trim() || busy} onClick={submit}>
          {busy ? <Spinner className="border-white/40 border-t-white" /> : null}
          Unlock
        </Button>
      </Card>
    </div>
  );
}
