import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/password-forms";

export const metadata: Metadata = { title: "Lupa kata sandi" };
export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
