import type { Metadata } from "next";
import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/password-forms";

export const metadata: Metadata = { title: "Kata sandi baru", robots: { index: false } };
export default function ResetPasswordPage() {
  return <Suspense><ResetPasswordForm /></Suspense>;
}
