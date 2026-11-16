import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Landing } from "@/components/landing";
import { LANG_COOKIE } from "@/lib/lang";
import { AT, RT } from "@/lib/server/session";

const COPY = {
  id: { title: "Bandha: pencatat keuangan dan portofolio", description: "Catat rekening, arus kas, kripto, emas, dan utang dalam satu buku besar. Setiap angka bisa ditelusuri sampai ke catatan aslinya." },
  en: { title: "Bandha: personal finance and portfolio tracker", description: "Track accounts, cash flow, crypto, gold, and debts in one ledger. Every number can be traced back to the record behind it." },
} as const;

export async function generateMetadata(): Promise<Metadata> {
  const lang = (await cookies()).get(LANG_COOKIE)?.value === "en" ? "en" : "id";
  const { title, description } = COPY[lang];
  return { title: { absolute: title }, description, openGraph: { title, description, type: "website", siteName: "Bandha" } };
}

// The public front page. Someone who is already signed in goes straight to their dashboard.
export default async function Home() {
  const jar = await cookies();
  if (jar.get(AT) || jar.get(RT)) redirect("/dashboard");
  return <Landing />;
}
