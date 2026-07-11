import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { auth } from "@/auth";
import { AppShell, NAV } from "@/components/nav";
import { getIsAdmin } from "@/lib/session";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const isAdmin = await getIsAdmin();
  const navItems = isAdmin ? [...NAV, { href: "/admin", label: "Admin", icon: ShieldCheck }] : NAV;
  return (
    <AppShell userName={session.user.name ?? session.user.email} navItems={navItems}>
      {children}
    </AppShell>
  );
}
