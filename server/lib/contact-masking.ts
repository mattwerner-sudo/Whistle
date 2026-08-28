import { db } from "../db";
import { contactReveals } from "@shared/schema";
import { and, eq, gte, inArray } from "drizzle-orm";

export const REVEAL_GRACE_DAYS = 90;

export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [local, domain] = email.split("@");
  if (!domain) return "•••";
  const localMasked = local.length <= 2 ? local[0] + "•" : local[0] + "•••" + local.slice(-1);
  const domainParts = domain.split(".");
  const tld = domainParts.pop() || "";
  const root = domainParts.join(".");
  const rootMasked = root.length <= 2 ? "•••" : root[0] + "•••";
  return `${localMasked}@${rootMasked}.${tld}`;
}

export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "•••";
  return "•••-•••-" + digits.slice(-4);
}

export async function getRevealedStaffIds(
  userId: number | null | undefined,
  staffIds: number[],
): Promise<Set<number>> {
  if (!userId || staffIds.length === 0) return new Set();
  const cutoff = new Date(Date.now() - REVEAL_GRACE_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ staffId: contactReveals.staffId })
    .from(contactReveals)
    .where(
      and(
        eq(contactReveals.userId, userId),
        inArray(contactReveals.staffId, staffIds),
        gte(contactReveals.revealedAt, cutoff),
      ),
    );
  return new Set(rows.map((r) => r.staffId));
}

export interface MaskableStaff {
  id: number;
  email: string | null;
  phone: string | null;
  [key: string]: any;
}

export function applyMaskToStaff<T extends MaskableStaff>(
  member: T,
  revealedIds: Set<number>,
): T & { emailRevealed: boolean; phoneRevealed: boolean; isRevealed: boolean } {
  const isRevealed = revealedIds.has(member.id);
  if (isRevealed) {
    return { ...member, isRevealed: true, emailRevealed: true, phoneRevealed: true };
  }
  return {
    ...member,
    email: maskEmail(member.email),
    phone: maskPhone(member.phone),
    isRevealed: false,
    emailRevealed: false,
    phoneRevealed: false,
  };
}

export async function maskStaffList<T extends MaskableStaff>(
  userId: number | null | undefined,
  members: T[],
): Promise<Array<T & { emailRevealed: boolean; phoneRevealed: boolean; isRevealed: boolean }>> {
  const ids = members.map((m) => m.id);
  const revealedIds = await getRevealedStaffIds(userId, ids);
  return members.map((m) => applyMaskToStaff(m, revealedIds));
}
