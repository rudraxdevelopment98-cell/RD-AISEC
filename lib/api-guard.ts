import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMemberAccess } from "@/lib/members";
import { canAccess } from "@/lib/access";

type GuardOk = { res: null; email: string };
type GuardFail = { res: NextResponse; email: null };

/**
 * Gate an API route the same way the dashboard nav is gated: authenticated AND
 * granted the given section. Usage:
 *   const g = await guardApi("/dashboard/findings");
 *   if (g.res) return g.res;
 *   // ...use g.email
 */
export async function guardApi(section: string): Promise<GuardOk | GuardFail> {
  const session = await auth();
  const email = session?.user?.email ?? null;
  if (!email) {
    return { res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), email: null };
  }
  const info = await getMemberAccess(email);
  if (!canAccess(section, info)) {
    return { res: NextResponse.json({ error: "Forbidden" }, { status: 403 }), email: null };
  }
  return { res: null, email };
}
