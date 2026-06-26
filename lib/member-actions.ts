"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isOwnerEmail } from "@/lib/members";
import { GRANTABLE_KEYS } from "@/lib/access";

const BACK = "/dashboard/members";

/** Only an owner may manage members. */
async function requireOwner() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/login");
  if (!isOwnerEmail(email)) {
    redirect(`${BACK}?error=${encodeURIComponent("Only an owner can manage members.")}`);
  }
  return email;
}

function cleanAccess(values: string[]): string {
  return values.filter((v) => GRANTABLE_KEYS.includes(v)).join(",");
}

export async function addMember(formData: FormData) {
  const owner = await requireOwner();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const access = cleanAccess(formData.getAll("access").map(String));

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    redirect(`${BACK}?error=${encodeURIComponent("Enter a valid email address.")}`);
  }
  const exists = await prisma.member.findUnique({ where: { email } });
  if (exists) {
    redirect(`${BACK}?error=${encodeURIComponent("That email is already a member.")}`);
  }
  await prisma.member.create({
    data: { email, name, access, status: "approved", invitedBy: owner },
  });
  revalidatePath(BACK);
  redirect(`${BACK}?ok=${encodeURIComponent(`${email} added`)}`);
}

export async function updateMemberAccess(formData: FormData) {
  await requireOwner();
  const id = String(formData.get("id") ?? "");
  const access = cleanAccess(formData.getAll("access").map(String));
  await prisma.member.update({ where: { id }, data: { access } });
  revalidatePath(BACK);
  redirect(`${BACK}?ok=${encodeURIComponent("Access updated")}`);
}

export async function setMemberStatus(formData: FormData) {
  await requireOwner();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "approved");
  const next = ["approved", "suspended", "pending"].includes(status) ? status : "approved";
  await prisma.member.update({ where: { id }, data: { status: next } });
  revalidatePath(BACK);
}

export async function removeMember(formData: FormData) {
  await requireOwner();
  const id = String(formData.get("id") ?? "");
  await prisma.member.delete({ where: { id } });
  revalidatePath(BACK);
  redirect(`${BACK}?ok=${encodeURIComponent("Member removed")}`);
}
