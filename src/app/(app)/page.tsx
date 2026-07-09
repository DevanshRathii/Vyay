import { PageHeader } from "@/components/nav";
import { Dashboard } from "@/components/dashboard";

export default function OverviewPage() {
  return (
    <>
      <PageHeader title="Overview" subtitle="Your spending at a glance" />
      <Dashboard />
    </>
  );
}
