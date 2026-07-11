import { redirect } from "next/navigation";
import { PageHeader } from "@/components/nav";
import { getIsAdmin } from "@/lib/session";
import { AdminUsersPanel } from "@/components/admin-users";

export const metadata = { title: "Admin" };

export default async function AdminPage() {
  if (!(await getIsAdmin())) redirect("/");
  return (
    <>
      <PageHeader title="Users" subtitle="Grant Gmail access once you've also added someone as a Google test user" />
      <AdminUsersPanel />
    </>
  );
}
