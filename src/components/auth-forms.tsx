"use client";

import { IndianRupee } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Suspense } from "react";
import { Button, Card } from "@/components/ui";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.7 2.9c2.3-2.1 3.7-5.1 3.7-8.6z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.7-2.9c-1 .7-2.4 1.2-4.2 1.2-3.2 0-5.9-2.1-6.9-5.1L1.3 17.2C3.2 21.2 7.3 24 12 24z" />
      <path fill="#FBBC05" d="M5.1 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3L1.3 6.8C.5 8.4 0 10.2 0 12s.5 3.6 1.3 5.2l3.8-2.9z" />
      <path fill="#EA4335" d="M12 4.7c1.8 0 3 .8 3.7 1.4l3.3-3.2C17.9 1.1 15.2 0 12 0 7.3 0 3.2 2.8 1.3 6.8l3.8 2.9c1-3 3.7-5 6.9-5z" />
    </svg>
  );
}

export function AuthCard({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-accent-fg shadow-lg shadow-accent/25">
            <IndianRupee className="h-6 w-6" strokeWidth={2.5} />
          </span>
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-1 text-[13px] text-muted">{subtitle}</p>
          </div>
        </div>
        <Card className="p-5">{children}</Card>
        <footer className="mt-6 text-center text-[11px] text-muted">Created by Devansh Rathi</footer>
      </div>
    </div>
  );
}

function LoginInner({ googleEnabled }: { googleEnabled: boolean }) {
  const params = useSearchParams();
  const next = params.get("next") ?? "/";

  return (
    <AuthCard title="Welcome to Vyay" subtitle="Sign in to track expenses automatically from Gmail">
      {googleEnabled ? (
        <Button variant="secondary" className="w-full" onClick={() => signIn("google", { callbackUrl: next })}>
          <GoogleIcon /> Continue with Google
        </Button>
      ) : (
        <p className="text-[13px] text-negative">
          Google sign-in is not configured on this server. Set GOOGLE_CLIENT_ID and
          GOOGLE_CLIENT_SECRET.
        </p>
      )}
      <Link href="/demo" className="mt-2 block">
        <Button variant="ghost" className="w-full">
          Take a 2-minute tour
        </Button>
      </Link>
    </AuthCard>
  );
}

export function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  return (
    <Suspense>
      <LoginInner googleEnabled={googleEnabled} />
    </Suspense>
  );
}
