import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { googleLoginEnabled } from "@/auth.config";
import { LoginForm } from "@/components/auth-forms";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect(session.user.approved ? "/" : "/pending-approval");
  return <LoginForm googleEnabled={googleLoginEnabled} />;
}
