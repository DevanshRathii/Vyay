import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/nav";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return <AppShell userName={session.user.name ?? session.user.email}>{children}</AppShell>;
}
