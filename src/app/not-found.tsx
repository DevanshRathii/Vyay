import Link from "next/link";
import { IndianRupee } from "lucide-react";
import { Button, Card } from "@/components/ui";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-accent-fg shadow-lg shadow-accent/25">
          <IndianRupee className="h-6 w-6" strokeWidth={2.5} />
        </span>
        <Card className="p-6">
          <p className="text-[13px] font-semibold tracking-wide text-muted">404</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Page not found</h1>
          <p className="mt-2 text-[13px] text-muted">
            The page you&apos;re looking for doesn&apos;t exist or may have moved.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Link href="/">
              <Button variant="secondary">Go home</Button>
            </Link>
            <Link href="/login">
              <Button>Sign in</Button>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
