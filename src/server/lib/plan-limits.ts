import { db, saasUsersTable, saasPlansTable } from "../../db";
import { eq, sql } from "drizzle-orm";
import type { Request } from "express";

export interface PlanLimitConfig {
  planId: string;
  name: string;
  monthlyHuntLimit: number; // monthly business/lead generation limit
  aiEmployeeRunsLimit: number; // monthly autonomous AI employee missions
  monthlyEmailLimit: number; // monthly outreach emails
  websitesLimit: number; // active AI websites
  monthlyPrice: number;
}

export const EXACT_PLAN_LIMITS: Record<string, PlanLimitConfig> = {
  free: {
    planId: "free",
    name: "Free Explorer",
    monthlyHuntLimit: 50, // EXACT: 50 businesses / month
    aiEmployeeRunsLimit: 1, // EXACT: 1 mission / month
    monthlyEmailLimit: 150,
    websitesLimit: 1,
    monthlyPrice: 0,
  },
  starter: {
    planId: "starter",
    name: "Starter",
    monthlyHuntLimit: 1500, // EXACT: 1,500 businesses / month
    aiEmployeeRunsLimit: 10, // EXACT: 10 missions / month
    monthlyEmailLimit: 5000,
    websitesLimit: 3,
    monthlyPrice: 49,
  },
  growth: {
    planId: "growth",
    name: "Growth Pro",
    monthlyHuntLimit: 7500, // EXACT: 7,500 businesses / month
    aiEmployeeRunsLimit: 50, // EXACT: 50 missions / month
    monthlyEmailLimit: 25000,
    websitesLimit: 15,
    monthlyPrice: 149,
  },
  scale: {
    planId: "scale",
    name: "Agency Scale",
    monthlyHuntLimit: 25000, // EXACT: 25,000 businesses / month
    aiEmployeeRunsLimit: 250, // EXACT: 250 missions / month
    monthlyEmailLimit: 75000,
    websitesLimit: 100,
    monthlyPrice: 349,
  },
  enterprise: {
    planId: "enterprise",
    name: "Enterprise VIP",
    monthlyHuntLimit: 100000, // EXACT: 100,000 businesses / month
    aiEmployeeRunsLimit: 9999, // UNLIMITED
    monthlyEmailLimit: 300000,
    websitesLimit: 999999,
    monthlyPrice: 799,
  },
};

const OWNER_ADMIN_EMAILS = new Set([
  "jwandersonar@gmail.com",
  "admin@vanguardhunter.io",
  "admin@vanguardhunter.com",
  "admin",
  "owner",
]);

export function isOwnerAdmin(email?: string | null): boolean {
  if (!email) return false;
  const clean = email.trim().toLowerCase();
  const envAdmin = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (envAdmin && clean === envAdmin) return true;
  return OWNER_ADMIN_EMAILS.has(clean);
}

export async function resolveSaasUser(req: Request): Promise<typeof saasUsersTable.$inferSelect | null> {
  const auth = req.headers.authorization || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const headerEmail = String(req.headers["x-user-email"] || "").trim().toLowerCase();

  try {
    if (token) {
      const byToken = await db
        .select()
        .from(saasUsersTable)
        .where(eq(saasUsersTable.sessionToken, token))
        .limit(1);
      if (byToken.length > 0) return byToken[0];
    }

    if (headerEmail && headerEmail.includes("@")) {
      const byEmail = await db
        .select()
        .from(saasUsersTable)
        .where(eq(saasUsersTable.email, headerEmail))
        .limit(1);
      if (byEmail.length > 0) return byEmail[0];
    }

    // Default admin token fallbacks
    if (
      token === "admin123" ||
      token === "admin_owner_token" ||
      token === "adm_root_token" ||
      token.startsWith("adm_")
    ) {
      const admins = await db
        .select()
        .from(saasUsersTable)
        .where(eq(saasUsersTable.role, "admin"))
        .limit(1);
      if (admins.length > 0) return admins[0];
    }
  } catch (err) {
    console.warn("[plan-limits] resolveSaasUser error:", err);
  }

  return null;
}

export async function checkUserGenerationLimit(
  reqOrUser: Request | (typeof saasUsersTable.$inferSelect) | string | null | undefined,
  requestedCount: number
): Promise<{
  allowed: boolean;
  isOwnerOrAdmin: boolean;
  user: typeof saasUsersTable.$inferSelect | null;
  planId: string;
  planName: string;
  usedThisMonth: number;
  monthlyLimit: number;
  remainingThisMonth: number;
  allowedCount: number;
  errorMessage?: string;
}> {
  let user: typeof saasUsersTable.$inferSelect | null = null;
  if (typeof reqOrUser === "string") {
    try {
      const cleanEmail = reqOrUser.trim().toLowerCase();
      const byEmail = await db
        .select()
        .from(saasUsersTable)
        .where(eq(saasUsersTable.email, cleanEmail))
        .limit(1);
      if (byEmail.length > 0) user = byEmail[0];
    } catch {}
  } else if (reqOrUser && "headers" in reqOrUser) {
    user = (reqOrUser as any).saasUser || (await resolveSaasUser(reqOrUser as Request));
  } else {
    user = reqOrUser as typeof saasUsersTable.$inferSelect | null;
  }

  // If no user found, assume free explorer tier with 50 limit
  const planId = (user?.planId || "free").toLowerCase();
  const planConfig = EXACT_PLAN_LIMITS[planId] || EXACT_PLAN_LIMITS.free;
  const isOwner = user ? (user.role === "admin" || isOwnerAdmin(user.email)) : false;

  if (isOwner) {
    return {
      allowed: true,
      isOwnerOrAdmin: true,
      user,
      planId: "enterprise",
      planName: "Enterprise VIP (Owner)",
      usedThisMonth: user?.huntsUsedThisMonth || 0,
      monthlyLimit: 999999,
      remainingThisMonth: 999999,
      allowedCount: requestedCount,
    };
  }

  const usedThisMonth = user?.huntsUsedThisMonth || 0;
  const monthlyLimit = planConfig.monthlyHuntLimit;
  const remainingThisMonth = Math.max(0, monthlyLimit - usedThisMonth);

  if (remainingThisMonth <= 0) {
    return {
      allowed: false,
      isOwnerOrAdmin: false,
      user,
      planId,
      planName: planConfig.name,
      usedThisMonth,
      monthlyLimit,
      remainingThisMonth: 0,
      allowedCount: 0,
      errorMessage: `Monthly Lead Generation Limit Reached: Your ${planConfig.name} account includes ${monthlyLimit} verified business leads per month (${usedThisMonth}/${monthlyLimit} used this month). Please upgrade your subscription plan to continue generating businesses.`,
    };
  }

  // User has remaining limit: cap allowedCount so it never exceeds monthlyLimit
  const allowedCount = Math.min(requestedCount, remainingThisMonth);

  return {
    allowed: true,
    isOwnerOrAdmin: false,
    user,
    planId,
    planName: planConfig.name,
    usedThisMonth,
    monthlyLimit,
    remainingThisMonth,
    allowedCount,
  };
}

export async function checkUserAiEmployeeLimit(
  reqOrUser: Request | (typeof saasUsersTable.$inferSelect) | string | null | undefined
): Promise<{
  allowed: boolean;
  isOwnerOrAdmin: boolean;
  user: typeof saasUsersTable.$inferSelect | null;
  planId: string;
  planName: string;
  usedThisMonth: number;
  monthlyLimit: number;
  remainingThisMonth: number;
  errorMessage?: string;
}> {
  let user: typeof saasUsersTable.$inferSelect | null = null;
  if (typeof reqOrUser === "string") {
    try {
      const cleanEmail = reqOrUser.trim().toLowerCase();
      const byEmail = await db
        .select()
        .from(saasUsersTable)
        .where(eq(saasUsersTable.email, cleanEmail))
        .limit(1);
      if (byEmail.length > 0) user = byEmail[0];
    } catch {}
  } else if (reqOrUser && "headers" in reqOrUser) {
    user = (reqOrUser as any).saasUser || (await resolveSaasUser(reqOrUser as Request));
  } else {
    user = reqOrUser as typeof saasUsersTable.$inferSelect | null;
  }

  const planId = (user?.planId || "free").toLowerCase();
  const planConfig = EXACT_PLAN_LIMITS[planId] || EXACT_PLAN_LIMITS.free;
  const isOwner = user ? (user.role === "admin" || isOwnerAdmin(user.email)) : false;

  if (isOwner) {
    return {
      allowed: true,
      isOwnerOrAdmin: true,
      user,
      planId: "enterprise",
      planName: "Enterprise VIP (Owner)",
      usedThisMonth: user?.aiEmployeeRunsUsedThisMonth || 0,
      monthlyLimit: 9999,
      remainingThisMonth: 9999,
    };
  }

  const usedThisMonth = user?.aiEmployeeRunsUsedThisMonth || 0;
  const monthlyLimit = planConfig.aiEmployeeRunsLimit;
  const remainingThisMonth = Math.max(0, monthlyLimit - usedThisMonth);

  if (remainingThisMonth <= 0) {
    return {
      allowed: false,
      isOwnerOrAdmin: false,
      user,
      planId,
      planName: planConfig.name,
      usedThisMonth,
      monthlyLimit,
      remainingThisMonth: 0,
      errorMessage: `Monthly AI Employee Mission Limit Reached: Your ${planConfig.name} account includes ${monthlyLimit} autonomous mission(s) per month (${usedThisMonth}/${monthlyLimit} used this month). Please upgrade your subscription plan to launch additional autonomous AI workforce missions.`,
    };
  }

  return {
    allowed: true,
    isOwnerOrAdmin: false,
    user,
    planId,
    planName: planConfig.name,
    usedThisMonth,
    monthlyLimit,
    remainingThisMonth,
  };
}

export async function recordUserHunts(userEmailOrId?: string | number | null, count = 1): Promise<void> {
  if (!userEmailOrId || count <= 0) return;
  try {
    if (typeof userEmailOrId === "number") {
      await db
        .update(saasUsersTable)
        .set({
          huntsUsedThisMonth: sql`${saasUsersTable.huntsUsedThisMonth} + ${count}`,
          creditsBalance: sql`GREATEST(0, ${saasUsersTable.creditsBalance} - ${count})`,
        })
        .where(eq(saasUsersTable.id, userEmailOrId));
    } else {
      const cleanEmail = String(userEmailOrId).trim().toLowerCase();
      await db
        .update(saasUsersTable)
        .set({
          huntsUsedThisMonth: sql`${saasUsersTable.huntsUsedThisMonth} + ${count}`,
          creditsBalance: sql`GREATEST(0, ${saasUsersTable.creditsBalance} - ${count})`,
        })
        .where(eq(saasUsersTable.email, cleanEmail));
    }
  } catch (err) {
    console.warn("[plan-limits] Failed to record hunts:", err);
  }
}

export async function recordUserAiEmployeeRun(userEmailOrId?: string | number | null): Promise<void> {
  if (!userEmailOrId) return;
  try {
    if (typeof userEmailOrId === "number") {
      await db
        .update(saasUsersTable)
        .set({
          aiEmployeeRunsUsedThisMonth: sql`${saasUsersTable.aiEmployeeRunsUsedThisMonth} + 1`,
        })
        .where(eq(saasUsersTable.id, userEmailOrId));
    } else {
      const cleanEmail = String(userEmailOrId).trim().toLowerCase();
      await db
        .update(saasUsersTable)
        .set({
          aiEmployeeRunsUsedThisMonth: sql`${saasUsersTable.aiEmployeeRunsUsedThisMonth} + 1`,
        })
        .where(eq(saasUsersTable.email, cleanEmail));
    }
  } catch (err) {
    console.warn("[plan-limits] Failed to record employee run:", err);
  }
}
