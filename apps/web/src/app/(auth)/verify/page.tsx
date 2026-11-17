import type { Metadata } from "next";
import { Suspense } from "react";
import { VerifyEmailForm } from "@/components/verify-form";

export const metadata: Metadata = { title: "Verifikasi email", robots: { index: false } };
export default function VerifyPage() {
  return <Suspense><VerifyEmailForm /></Suspense>;
}
