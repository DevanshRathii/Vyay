import { PageHeader } from "@/components/nav";
import { ContactsManager } from "@/components/contacts-manager";

export const metadata = { title: "Contacts" };

export default function ContactsPage() {
  return (
    <>
      <PageHeader title="Contacts" subtitle="Identify who your UPI transactions are really with" />
      <ContactsManager />
    </>
  );
}
