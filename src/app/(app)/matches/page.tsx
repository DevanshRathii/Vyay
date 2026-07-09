import { PageHeader } from "@/components/nav";
import { MatchesList } from "@/components/matches-list";

export const metadata = { title: "Matches" };

export default function MatchesPage() {
  return (
    <>
      <PageHeader title="Matches" subtitle="Pair Shortcut logs with bank transactions" />
      <MatchesList />
    </>
  );
}
