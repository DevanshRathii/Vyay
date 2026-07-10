"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SWRConfig } from "swr";
import { AppShell, NAV, PageHeader } from "@/components/nav";
import { CategoryManager } from "@/components/category-manager";
import { Dashboard } from "@/components/dashboard";
import { Ledger } from "@/components/ledger";
import { MatchesList } from "@/components/matches-list";
import { SettingsPanels } from "@/components/settings";
import { useDemoTour } from "@/components/demo-tour";
import { demoFetcher } from "@/lib/demo-data";

// Contacts isn't part of the tour and its vCard-import flow can't be
// meaningfully simulated with static data — hidden in the demo.
const DEMO_NAV = NAV.filter((n) => n.href !== "/contacts");

const PAGES: Record<string, { title: string; subtitle: string; render: () => React.ReactNode }> = {
  "/": { title: "Overview", subtitle: "Your spending at a glance", render: () => <Dashboard /> },
  "/ledger": { title: "Ledger", subtitle: "Every transaction parsed from your inbox", render: () => <Ledger /> },
  "/categories": {
    title: "Categories",
    subtitle: "Organize spending and automate with rules",
    render: () => <CategoryManager />,
  },
  "/matches": { title: "Matches", subtitle: "Pair Shortcut logs with bank transactions", render: () => <MatchesList /> },
  "/settings": {
    title: "Settings",
    subtitle: "Gmail, tokens, export, and the Apple Shortcut",
    render: () => <SettingsPanels />,
  },
};

function DemoBanner({ onRestartTour }: { onRestartTour: () => void }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent/30 bg-accent/5 px-3.5 py-2.5 text-[12px]">
      <span>Demo with sample data — nothing you do here is saved.</span>
      <span className="flex items-center gap-3">
        <button type="button" onClick={onRestartTour} className="font-medium text-accent underline underline-offset-2">
          Restart tour
        </button>
        <Link href="/login" className="font-medium underline underline-offset-2">
          Exit demo
        </Link>
      </span>
    </div>
  );
}

function DemoToast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="fixed bottom-20 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-fg px-4 py-2 text-[13px] font-medium text-canvas shadow-lg sm:bottom-6">
      {message}
    </div>
  );
}

export function DemoShell() {
  const [page, setPage] = useState("/");
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToastRef = useRef((_msg: string) => {});
  showToastRef.current = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  };

  const { start: startTour } = useDemoTour(page, setPage);

  // Every /api/* read resolves from the static demo dataset; every write is
  // intercepted with a toast. Nothing from /demo ever reaches the real
  // backend. Scoped to this component's lifetime only.
  useEffect(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (!url.startsWith("/api/")) return realFetch(input, init);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method !== "GET") {
        showToastRef.current("Sign in to make changes");
        return new Response(JSON.stringify({ demo: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      const data = await demoFetcher(url);
      return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    return () => {
      window.fetch = realFetch;
    };
  }, []);

  // Start the guided tour shortly after the first paint.
  useEffect(() => {
    const t = setTimeout(() => startTour(), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = PAGES[page] ?? PAGES["/"];

  return (
    <SWRConfig value={{ fetcher: demoFetcher, dedupingInterval: 0, revalidateOnFocus: false }}>
      <AppShell userName="Demo" activePage={page} onNavigate={setPage} navItems={DEMO_NAV}>
        <DemoBanner onRestartTour={startTour} />
        <PageHeader title={current.title} subtitle={current.subtitle} />
        {current.render()}
      </AppShell>
      <DemoToast message={toast} />
    </SWRConfig>
  );
}
