import { redirect } from "next/navigation";
import { Clock } from "lucide-react";
import { auth, signOut } from "@/auth";
import { AuthCard } from "@/components/auth-forms";

export const metadata = { title: "Pending approval" };

export default async function PendingApprovalPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.approved) redirect("/");

  return (
    <AuthCard title="Access requested" subtitle="Your sign-in was recorded — the app owner needs to approve it">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-card-2 text-muted">
          <Clock className="h-5 w-5" />
        </span>
        <p className="text-[13px] text-muted">
          Signed in as <span className="font-medium text-fg">{session.user.email}</span>. Vyay is currently
          invite-only while it&apos;s in testing — you&apos;ll get access once it&apos;s approved. Try signing in
          again later.
        </p>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button type="submit" className="mt-1 text-[13px] font-medium text-accent underline underline-offset-2">
            Sign out
          </button>
        </form>
      </div>
    </AuthCard>
  );
}
