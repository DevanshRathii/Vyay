import { redirect } from "next/navigation";
import { PageHeader } from "@/components/nav";
import { getIsAdmin } from "@/lib/session";
import { AdminUsersPanel, PreapprovedPanel } from "@/components/admin-users";
import { NewsletterPanel } from "@/components/newsletter-panel";

export const metadata = { title: "Admin" };

export default async function AdminPage() {
  if (!(await getIsAdmin())) redirect("/");
  return (
    <>
      <PageHeader title="Users" subtitle="Grant Gmail access once you've also added someone as a Google test user" />
      <div className="flex flex-col gap-4">
        <PreapprovedPanel />
        <AdminUsersPanel />
        <NewsletterPanel />
      </div>
    </>
  );
}
