import type { Metadata } from "next";
import { connection } from "next/server";
import { AuthForm } from "@/components/auth-form";
import { googleClientId } from "@/lib/server/google";

export const metadata: Metadata = { title: "Daftar" };
export default async function RegisterPage() {
  await connection(); // read the Google client id per request, not at build time
  return <AuthForm mode="register" googleClientId={googleClientId()} />;
}
