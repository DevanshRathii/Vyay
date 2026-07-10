import Link from "next/link";
import { IndianRupee } from "lucide-react";
import { Card } from "@/components/ui";

/** Shared shell for the public /privacy and /terms pages. */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-10 sm:px-6">
      <Link href="/login" className="mb-8 flex items-center gap-2.5 self-start">
        <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-accent text-accent-fg">
          <IndianRupee className="h-4.5 w-4.5" strokeWidth={2.5} />
        </span>
        <span className="text-[17px] font-semibold tracking-tight">Vyay</span>
      </Link>
      <Card className="p-6 sm:p-8">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        <p className="mt-1 text-[13px] text-muted">Last updated {updated}</p>
        <div className="prose-legal mt-6 flex flex-col gap-4 text-[14px] leading-relaxed text-fg">
          {children}
        </div>
      </Card>
      <div className="mt-6 flex items-center justify-center gap-4 text-[12px] text-muted">
        <Link href="/privacy" className="hover:text-fg">
          Privacy Policy
        </Link>
        <span>·</span>
        <Link href="/terms" className="hover:text-fg">
          Terms of Service
        </Link>
        <span>·</span>
        <Link href="/login" className="hover:text-fg">
          Sign in
        </Link>
      </div>
    </div>
  );
}
