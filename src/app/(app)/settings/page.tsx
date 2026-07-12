import { auth } from "@/auth";
import { PageHeader } from "@/components/nav";
import { AccountCard, SettingsPanels } from "@/components/settings";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await auth();
  return (
    <>
      <PageHeader title="Settings" subtitle="Gmail, tokens, export, and the Apple Shortcut" />
      <div className="flex flex-col gap-4">
        <SettingsPanels />
        <AccountCard name={session?.user?.name ?? null} email={session?.user?.email ?? null} />
      </div>
    </>
  );
}
