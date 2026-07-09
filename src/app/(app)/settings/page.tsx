import { PageHeader } from "@/components/nav";
import { SettingsPanels } from "@/components/settings";

export const metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" subtitle="Gmail, tokens, export, and the Apple Shortcut" />
      <SettingsPanels />
    </>
  );
}
