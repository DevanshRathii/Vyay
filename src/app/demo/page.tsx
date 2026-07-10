import type { Metadata } from "next";
import { DemoShell } from "@/components/demo-shell";

export const metadata: Metadata = {
  title: "Demo",
  description: "See Vyay's ledger, categories, and matches with sample data — no sign-in required.",
};

export default function DemoPage() {
  return <DemoShell />;
}
