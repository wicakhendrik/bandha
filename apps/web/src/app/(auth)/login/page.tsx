import type { Metadata } from "next";
import { connection } from "next/server";
import { AuthForm } from "@/components/auth-form";
import { googleClientId } from "@/lib/server/google";

export const metadata: Metadata = { title: "Masuk" };
export default async function LoginPage() {
  await connection(); // read the Google client id per request, not at build time
  return <AuthForm mode="login" googleClientId={googleClientId()} />;
}
