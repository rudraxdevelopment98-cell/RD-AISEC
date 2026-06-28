"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

const STATUSES = ["todo", "learning", "done"];

/** Set the user's progress on a learn topic (todo | learning | done). */
export async function setLearnStatus(formData: FormData) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/login");
  const key = String(formData.get("key") ?? "").slice(0, 64);
  const status = String(formData.get("status") ?? "");
  if (!key || !STATUSES.includes(status)) return;

  await prisma.learnProgress.upsert({
    where: { key_ownerEmail: { key, ownerEmail: email } },
    create: { key, ownerEmail: email, status },
    update: { status },
  });
  revalidatePath("/dashboard/learn");
}
