import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/nav";
import { KeyProvider } from "@/components/e2e-provider";
import { ParserSyncRunner } from "@/components/parser-sync-runner";
import { getIsAdmin } from "@/lib/session";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const isAdmin = await getIsAdmin();
  return (
    <AppShell userName={session.user.name ?? session.user.email} showAdmin={isAdmin}>
      <KeyProvider userId={session.user.id!}>
        <ParserSyncRunner />
        {children}
      </KeyProvider>
    </AppShell>
  );
}
