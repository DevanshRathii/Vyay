"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button, Card } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[vyay] unhandled page error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60dvh] items-center justify-center px-4">
      <Card className="w-full max-w-sm p-6 text-center">
        <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-negative/10 text-negative">
          <AlertTriangle className="h-5 w-5" />
        </span>
        <h1 className="text-[16px] font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-2 text-[13px] text-muted">
          An unexpected error occurred loading this page. You can try again, or head back to the Overview.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Link href="/">
            <Button variant="secondary">Overview</Button>
          </Link>
          <Button onClick={reset}>Try again</Button>
        </div>
      </Card>
    </div>
  );
}
