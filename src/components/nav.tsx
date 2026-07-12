"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useTheme } from "next-themes";
import {
  ChartPie,
  GitMerge,
  IndianRupee,
  List,
  LogOut,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  Tags,
  type LucideIcon,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { UrgentFeedbackButton } from "@/components/feedback-button";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV: NavItem[] = [
  { href: "/", label: "Overview", icon: ChartPie },
  { href: "/ledger", label: "Ledger", icon: List },
  { href: "/categories", label: "Categories", icon: Tags },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/matches", label: "Matches", icon: GitMerge },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <span className="h-9 w-9" />;
  return (
    <button
      className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-line/50 hover:text-fg"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label="Toggle theme"
    >
      {resolvedTheme === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
    </button>
  );
}

function MatchesDot() {
  const { data } = useSWR<{ rows: unknown[] }>("/api/matches", { refreshInterval: 60_000 });
  if (!data?.rows?.length) return null;
  return (
    <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-accent">
      <span className="sr-only">Pending matches</span>
    </span>
  );
}

/**
 * App shell: fixed sidebar ≥sm, bottom tab bar on phones.
 *
 * Demo mode (activePage + onNavigate both set): nav items become buttons
 * that switch a locally-held "page" instead of real routing, so a driver.js
 * tour running across "pages" never remounts and never loses its place.
 * Omitting them (the entire real app) is byte-identical to before this.
 */
export function AppShell({
  children,
  userName,
  activePage,
  onNavigate,
  navItems = NAV,
  showAdmin = false,
}: {
  children: React.ReactNode;
  userName?: string | null;
  activePage?: string;
  onNavigate?: (href: string) => void;
  navItems?: NavItem[];
  /** Appends an "Admin" item — computed here, not passed in, since a plain
   *  array of icon-bearing objects doesn't reliably cross the server→client
   *  boundary from an async Server Component (only real "use client" props
   *  like this boolean should). */
  showAdmin?: boolean;
}) {
  const pathname = usePathname();
  const isDemo = onNavigate !== undefined;
  const isActive = (href: string) => (isDemo ? activePage === href : pathname === href);
  const items = showAdmin ? [...navItems, { href: "/admin", label: "Admin", icon: ShieldCheck }] : navItems;

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col justify-between border-r border-line px-3 py-5 sm:flex">
        <div>
          <Link href="/" className="mb-6 flex items-center gap-2.5 px-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-accent text-accent-fg">
              <IndianRupee className="h-4.5 w-4.5" strokeWidth={2.5} />
            </span>
            <span className="text-[17px] font-semibold tracking-tight">Vyay</span>
          </Link>
          <nav className="flex flex-col gap-0.5">
            {items.map(({ href, label, icon: Icon }) => {
              const active = isActive(href);
              const className = cn(
                "relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium",
                active ? "bg-line/60 text-fg" : "text-muted hover:bg-line/40 hover:text-fg",
              );
              const content = (
                <>
                  <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
                  {label}
                  {href === "/matches" && <MatchesDot />}
                </>
              );
              return isDemo ? (
                <button key={href} type="button" data-tour={`nav-${href}`} onClick={() => onNavigate!(href)} className={className}>
                  {content}
                </button>
              ) : (
                <Link key={href} href={href} className={className}>
                  {content}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center justify-between px-2">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium">{userName ?? "Account"}</p>
            {isDemo ? (
              <Link href="/login" className="flex items-center gap-1 text-[12px] text-muted hover:text-fg">
                <LogOut className="h-3 w-3" /> Exit demo
              </Link>
            ) : (
              <button
                className="flex items-center gap-1 text-[12px] text-muted hover:text-fg"
                onClick={() => signOut({ callbackUrl: "/login" })}
              >
                <LogOut className="h-3 w-3" /> Sign out
              </button>
            )}
          </div>
          <ThemeToggle />
        </div>
      </aside>

      {/* Content */}
      <main className="min-w-0 flex-1 px-4 pb-24 pt-5 sm:px-8 sm:pb-10">
        {children}
        <footer className="mt-10 pb-2 text-center text-[11px] text-muted">Created by Devansh Rathi</footer>
      </main>

      {/* Mobile bottom tabs */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-line bg-card/90 backdrop-blur-lg sm:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {items.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          const className = cn(
            "relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium",
            active ? "text-accent" : "text-muted",
          );
          const content = (
            <>
              <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 2} />
              {label}
              {href === "/matches" && <MatchesDot />}
            </>
          );
          return isDemo ? (
            <button key={href} type="button" onClick={() => onNavigate!(href)} className={className}>
              {content}
            </button>
          ) : (
            <Link key={href} href={href} className={className}>
              {content}
            </Link>
          );
        })}
      </nav>

      <UrgentFeedbackButton />
    </div>
  );
}

/** Page heading used across screens. */
export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
