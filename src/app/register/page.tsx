import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { googleLoginEnabled } from "@/auth.config";
import { RegisterForm } from "@/components/auth-forms";

export const metadata = { title: "Create account" };

export default async function RegisterPage() {
  const session = await auth();
  if (session?.user) redirect("/");
  return <RegisterForm googleEnabled={googleLoginEnabled} />;
}
