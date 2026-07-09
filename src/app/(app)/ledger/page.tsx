import { PageHeader } from "@/components/nav";
import { Ledger } from "@/components/ledger";

export const metadata = { title: "Ledger" };

export default function LedgerPage() {
  return (
    <>
      <PageHeader title="Ledger" subtitle="Every transaction parsed from your inbox" />
      <Ledger />
    </>
  );
}
