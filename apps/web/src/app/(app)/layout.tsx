import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AT, RT } from "@/lib/server/session";

// Cheap gate: no session cookies at all means go to login. Real authorization happens in the API.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  if (!jar.get(AT) && !jar.get(RT)) redirect("/login");
  return children;
}
