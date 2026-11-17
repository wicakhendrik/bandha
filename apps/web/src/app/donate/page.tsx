import type { Metadata } from "next";
import { DonatePage } from "@/components/donate";

export const metadata: Metadata = { title: "Dukung Bandha", description: "Bantu membayar biaya server, domain, dan email Bandha lewat QRIS atau kripto." };

export default function Donate() {
  return <DonatePage />;
}
