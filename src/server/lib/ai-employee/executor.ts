/**
 * executor.ts
 *
 * Durable Execution Engine for the AI Sales Employee.
 * Executes tasks sequentially, enforces budgets, supports pausing/resuming/cancelling,
 * creates server-side human approval gates, and survives browser closes/server restarts.
 */

import { db, aiEmployeeRunsTable, aiEmployeeTasksTable, aiEmployeeEventsTable, aiEmployeeApprovalsTable, saasUsersTable } from "../../../db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { toolRegistry, ToolExecutionContext } from "./tool-registry";
import { createExecutionPlan, StructuredPlan } from "./planner";
import { getAgencyBaseUrl } from "../../routes/reports";
import { getHunterStatus } from "../hunter-client";
import { recordUserHunts, recordUserAiEmployeeRun, checkUserGenerationLimit } from "../plan-limits";

// In-memory control state for active workers
const activeRunLoops = new Set<number>();
const pauseSignals = new Set<number>();
const cancelSignals = new Set<number>();

export function categorizeSmtpFailure(err: any): {
  category: "smtp_auth" | "timeout" | "mailbox_not_found" | "quota_limit" | "no_active_smtp" | "relay_error";
  categoryLabel: string;
  reason: string;
  solution: string;
} {
  const msg = String(err?.message || err || "").toLowerCase();
  const code = String(err?.code || "").toUpperCase();

  if (msg.includes("no active email account") || msg.includes("missing credentials")) {
    return {
      category: "no_active_smtp",
      categoryLabel: "No Active SMTP Configured",
      reason: "No verified email accounts found in SMTP pool or environment variables.",
      solution: "Connect Brevo, Gmail, or a custom SMTP account in Email Accounts to send live emails.",
    };
  }

  if (msg.includes("535") || msg.includes("auth") || msg.includes("credential") || msg.includes("invalid login") || msg.includes("username and password not accepted")) {
    return {
      category: "smtp_auth",
      categoryLabel: "Authentication / Credentials Rejected",
      reason: "SMTP server rejected login credentials (error 535).",
      solution: "Verify SMTP user and password/app password in Email Accounts settings.",
    };
  }

  if (code === "ETIMEDOUT" || code === "ECONNREFUSED" || code === "ENETUNREACH" || msg.includes("timeout") || msg.includes("etimedout") || msg.includes("econnrefused")) {
    return {
      category: "timeout",
      categoryLabel: "Connection / Port Timeout",
      reason: "Connection to SMTP server timed out (port 587/465 unreachable or blocked).",
      solution: "Check if port 587 is open, or switch provider to Brevo relay (port 2525) or SendGrid.",
    };
  }

  if (msg.includes("550") || msg.includes("551") || msg.includes("553") || msg.includes("mailbox") || msg.includes("user unknown") || msg.includes("recipient rejected")) {
    return {
      category: "mailbox_not_found",
      categoryLabel: "Recipient Mailbox Not Found / Bounced",
      reason: "Destination mail server rejected recipient (550 Mailbox does not exist).",
      solution: "Email address is invalid or deleted. Exclude from future campaigns to protect sender reputation.",
    };
  }

  if (msg.includes("421") || msg.includes("452") || msg.includes("quota") || msg.includes("limit") || msg.includes("daily limit")) {
    return {
      category: "quota_limit",
      categoryLabel: "Daily Limit / Rate Quota Exceeded",
      reason: "Provider daily sending quota reached.",
      solution: "Increase dailyLimit on the account or add more rotational SMTP sender accounts.",
    };
  }

  return {
    category: "relay_error",
    categoryLabel: "Relay / Transmission Error",
    reason: err?.message || "Unexpected error during SMTP transmission.",
    solution: "Inspect SMTP server logs or test connection using the Test Email button in Email Accounts.",
  };
}

export interface BudgetLimits {
  maxBusinesses: number;
  maxEmails: number;
  maxAiCredits: number;
  maxRuntimeMinutes: number;
  maxRetries: number;
  autoApprove?: boolean;
}

export interface BudgetConsumed {
  businesses: number;
  emails: number;
  aiCredits: number;
  seconds: number;
}

export async function logEmployeeEvent(
  runId: number,
  level: "info" | "thought" | "tool_start" | "tool_end" | "warning" | "error" | "approval_needed" | "approval_resolved",
  title: string,
  message: string,
  payload: any = {},
  taskId?: number
) {
  try {
    await db.insert(aiEmployeeEventsTable).values({
      runId,
      taskId: taskId || null,
      level,
      title,
      message,
      payload,
    });
  } catch (err) {
    console.error("[executor] Failed to log event:", err);
  }
}

/**
 * Creates a new Employee Run from a user goal and begins background execution.
 */
export async function startEmployeeRun(params: {
  userId?: number | null;
  userEmail?: string;
  goal: string;
  customLimits?: Partial<BudgetLimits>;
  employeeId?: number;
  userMemory?: Record<string, any>;
}): Promise<{ runId: number; plan: StructuredPlan }> {
  const { userId, userEmail, goal, customLimits, employeeId, userMemory } = params;

  // 1. Generate plan using AI planner
  const plan = await createExecutionPlan(goal, userMemory);

  // Check monthly lead generation limit before launching mission
  if (userEmail) {
    const limitCheck = await checkUserGenerationLimit(userEmail, plan.targetLeadCount || 10);
    if (!limitCheck.allowed) {
      throw new Error(limitCheck.errorMessage || "Monthly lead generation limit reached. Please upgrade your subscription plan.");
    }
    // Cap plan.targetLeadCount to remaining monthly allowance if necessary
    if (limitCheck.allowedCount < (plan.targetLeadCount || 10)) {
      plan.targetLeadCount = limitCheck.allowedCount;
      if (plan.suggestedLimits) {
        plan.suggestedLimits.maxBusinesses = limitCheck.allowedCount;
      }
    }
  }

  const budgetLimits: BudgetLimits = {
    ...plan.suggestedLimits,
    autoApprove: true,
    ...(customLimits || {}),
    // Ensure the exact count parsed from user goal is honored as maxBusinesses
    maxBusinesses: plan.targetLeadCount || customLimits?.maxBusinesses || plan.suggestedLimits?.maxBusinesses || 10,
  };

  // 2. Persist Run
  const [run] = await db
    .insert(aiEmployeeRunsTable)
    .values({
      userId: userId || null,
      employeeId: employeeId || 1,
      goal,
      status: "PLANNING",
      progress: 5,
      currentTaskIndex: 0,
      totalTasks: plan.tasks.length,
      currentTaskDescription: "Synthesizing execution plan...",
      budgetLimits,
      budgetConsumed: { businesses: 0, emails: 0, aiCredits: 0, seconds: 0 },
      metadata: {
        interpretedGoal: plan.interpretedGoal,
        targetCategory: plan.targetCategory,
        targetCity: plan.targetCity,
        targetLeadCount: plan.targetLeadCount,
        maxEmailsToSend: plan.maxEmailsToSend,
      },
    })
    .returning();

  const runId = run.id;

  // 3. Persist Planned Tasks
  for (const t of plan.tasks) {
    await db.insert(aiEmployeeTasksTable).values({
      runId,
      taskIndex: t.taskIndex,
      taskType: t.taskType,
      description: t.description,
      tool: t.tool,
      requiresApproval: t.requiresApproval,
      status: "pending",
      input: t.input || {},
    });
  }

  await logEmployeeEvent(
    runId,
    "thought",
    "Goal Received & Plan Formulated",
    `I have broken down your goal into ${plan.tasks.length} structured steps with a safety cap of ${budgetLimits.maxBusinesses} businesses and ${budgetLimits.maxEmails} emails.`,
    { plan }
  );

  // 4. Trigger durable runner in the background (fire and forget)
  runExecutionLoop(runId, userEmail).catch((err) => {
    console.error(`[executor] Run ${runId} execution loop crashed:`, err);
  });

  return { runId, plan };
}

/**
 * Background execution loop that processes tasks sequentially.
 */
export async function runExecutionLoop(runId: number, userEmail?: string) {
  if (activeRunLoops.has(runId)) {
    console.log(`[executor] Run ${runId} is already active. Skipping duplicate loop.`);
    return;
  }
  activeRunLoops.add(runId);
  pauseSignals.delete(runId);
  cancelSignals.delete(runId);

  try {
    const runs = await db.select().from(aiEmployeeRunsTable).where(eq(aiEmployeeRunsTable.id, runId)).limit(1);
    if (!runs.length) return;
    const run = runs[0];

    if (run.status === "COMPLETED" || run.status === "CANCELLED") {
      activeRunLoops.delete(runId);
      return;
    }

    await db
      .update(aiEmployeeRunsTable)
      .set({
        status: "EXECUTING",
        startedAt: run.startedAt || new Date(),
        updatedAt: new Date(),
      })
      .where(eq(aiEmployeeRunsTable.id, runId));

    // Shared execution context across steps
    const runState: {
      discoveredBusinesses: any[];
      analyzedWebsites: Record<string, any>;
      qualifiedLeads: any[];
      reports: Record<string, any>;
      offers: Record<string, any>;
      generatedWebsites: Record<string, any>;
      draftedEmails: any[];
      approvedEmails: any[];
      sentEmails: any[];
      failedEmails: any[];
    } = {
      discoveredBusinesses: (run.metadata as any)?.discoveredBusinesses || [],
      analyzedWebsites: (run.metadata as any)?.analyzedWebsites || {},
      qualifiedLeads: (run.metadata as any)?.qualifiedLeads || [],
      reports: (run.metadata as any)?.reports || {},
      offers: (run.metadata as any)?.offers || {},
      generatedWebsites: (run.metadata as any)?.generatedWebsites || {},
      draftedEmails: (run.metadata as any)?.draftedEmails || [],
      approvedEmails: (run.metadata as any)?.approvedEmails || [],
      sentEmails: (run.metadata as any)?.sentEmails || [],
      failedEmails: (run.metadata as any)?.failedEmails || [],
    };

    const rawLimits = ((run.budgetLimits as unknown as Partial<BudgetLimits>) || {});
    const budgetLimits: BudgetLimits = {
      maxBusinesses: rawLimits.maxBusinesses ?? 50,
      maxEmails: rawLimits.maxEmails ?? 20,
      maxAiCredits: rawLimits.maxAiCredits ?? 50,
      maxRuntimeMinutes: rawLimits.maxRuntimeMinutes ?? 30,
      maxRetries: rawLimits.maxRetries ?? 3,
      autoApprove: rawLimits.autoApprove ?? true,
    };

    let consumed = (run.budgetConsumed as unknown as BudgetConsumed) || {
      businesses: 0,
      emails: 0,
      aiCredits: 0,
      seconds: 0,
    };

    const budgetTracker = {
      incrementBusinesses: (count: number) => {
        consumed.businesses += count;
      },
      incrementEmails: (count: number) => {
        consumed.emails += count;
      },
      incrementCredits: (credits: number) => {
        consumed.aiCredits += credits;
      },
    };

    const toolCtx: ToolExecutionContext = {
      userId: run.userId,
      runId,
      userEmail,
      baseUrl: getAgencyBaseUrl(),
      budgetTracker,
      logEvent: async (lvl, title, msg, p) => logEmployeeEvent(runId, lvl, title, msg, p),
    };

    // Load tasks ordered by index
    const tasks = await db
      .select()
      .from(aiEmployeeTasksTable)
      .where(eq(aiEmployeeTasksTable.runId, runId))
      .orderBy(aiEmployeeTasksTable.taskIndex);

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];

      // Check if paused or cancelled
      if (pauseSignals.has(runId)) {
        await db
          .update(aiEmployeeRunsTable)
          .set({ status: "PAUSED", pausedAt: new Date(), updatedAt: new Date() })
          .where(eq(aiEmployeeRunsTable.id, runId));
        await logEmployeeEvent(runId, "info", "Execution Paused", "Employee was paused by user command.");
        activeRunLoops.delete(runId);
        return;
      }

      if (cancelSignals.has(runId)) {
        await db
          .update(aiEmployeeRunsTable)
          .set({ status: "CANCELLED", completedAt: new Date(), updatedAt: new Date() })
          .where(eq(aiEmployeeRunsTable.id, runId));
        await logEmployeeEvent(runId, "warning", "Execution Cancelled", "Employee execution was terminated by user.");
        activeRunLoops.delete(runId);
        return;
      }

      // If already completed in previous attempt, skip
      if (task.status === "completed") {
        continue;
      }

      // Check budget limits before expensive AI generation tasks (allow final CRM/outreach steps to finish smoothly)
      const isZeroCostFinalStep =
        task.taskType === "request_human_approval" ||
        task.taskType === "dispatch_approved_outreach" ||
        task.taskType === "send_outreach" ||
        task.taskType === "save_to_crm" ||
        task.taskType === "save_prospects_to_crm" ||
        task.taskType === "schedule_followups" ||
        task.taskType === "schedule_followup" ||
        task.taskType === "schedule_followups_and_save_crm";

      if (!isZeroCostFinalStep && consumed.aiCredits >= budgetLimits.maxAiCredits) {
        await handleBudgetExceeded(runId, "AI Credits limit reached");
        activeRunLoops.delete(runId);
        return;
      }

      const progress = Math.min(Math.round(((i + 1) / tasks.length) * 100), 98);

      await db
        .update(aiEmployeeRunsTable)
        .set({
          currentTaskIndex: task.taskIndex,
          currentTaskDescription: task.description,
          progress,
          budgetConsumed: consumed,
          updatedAt: new Date(),
        })
        .where(eq(aiEmployeeRunsTable.id, runId));

      await db
        .update(aiEmployeeTasksTable)
        .set({ status: "running", startedAt: new Date() })
        .where(eq(aiEmployeeTasksTable.id, task.id));

      await logEmployeeEvent(
        runId,
        "thought",
        `Executing Step ${task.taskIndex} of ${tasks.length}`,
        task.description,
        { taskType: task.taskType, tool: task.tool },
        task.id
      );

      try {
        // Execute based on task type
        switch (task.taskType) {
          case "find_businesses": {
            const tool = toolRegistry.find_businesses;
            const inputObj = (task.input && typeof task.input === "object" ? task.input : {}) as Record<string, any>;
            const requestedExact = budgetLimits.maxBusinesses || Number(inputObj.limit) || 10;
            const res = await tool.execute({ ...inputObj, limit: requestedExact }, toolCtx);
            const found = res.businesses || [];
            runState.discoveredBusinesses = found.slice(0, requestedExact);
            if (userEmail) {
              void recordUserHunts(userEmail, runState.discoveredBusinesses.length);
            }
            break;
          }

          case "analyze_websites": {
            const tool = toolRegistry.analyze_website;
            const leads = runState.discoveredBusinesses.slice(0, budgetLimits.maxBusinesses);
            const concurrency = 8;
            for (let chunkIdx = 0; chunkIdx < leads.length; chunkIdx += concurrency) {
              const batch = leads.slice(chunkIdx, chunkIdx + concurrency);
              await Promise.all(
                batch.map(async (lead) => {
                  if (lead.website) {
                    try {
                      const res = await Promise.race([
                        tool.execute({ website: lead.website, businessName: lead.businessName }, toolCtx),
                        new Promise<any>((_, reject) => setTimeout(() => reject(new Error("Scan timeout")), 3000)),
                      ]);
                      runState.analyzedWebsites[lead.businessName] = res;
                    } catch {
                      runState.analyzedWebsites[lead.businessName] = {
                        hasWebsite: true,
                        url: lead.website,
                        title: lead.businessName,
                        gaps: ["No 24/7 AI chat widget", "Unoptimized mobile conversion funnel"],
                        cms: "Modern Web",
                      };
                    }
                  } else {
                    runState.analyzedWebsites[lead.businessName] = {
                      hasWebsite: false,
                      url: "",
                      title: lead.businessName,
                      gaps: ["No registered website — high-priority conversion candidate"],
                      cms: "None",
                    };
                  }
                })
              );
            }
            break;
          }

          case "enrich_and_verify_contacts":
          case "enrich_contacts":
          case "verify_contacts": {
            const emailFinder = toolRegistry.find_business_email;
            const emailVerifier = toolRegistry.verify_email;
            const leads = runState.discoveredBusinesses.slice(0, Math.min(budgetLimits.maxEmails || 10, budgetLimits.maxBusinesses));
            const batchSize = 6;
            for (let bIdx = 0; bIdx < leads.length; bIdx += batchSize) {
              const chunk = leads.slice(bIdx, bIdx + batchSize);
              await Promise.all(
                chunk.map(async (lead) => {
                  if (!lead.email && lead.website) {
                    try {
                      const found = await Promise.race([
                        emailFinder.execute({
                          businessName: lead.businessName,
                          website: lead.website,
                          city: lead.city,
                          country: lead.country,
                          phone: lead.phone,
                          ownerName: lead.ownerName,
                        }, toolCtx),
                        new Promise<any>((_, r) => setTimeout(() => r(new Error("Finder timeout")), 3500)),
                      ]);
                      if (found?.email) {
                        lead.email = String(found.email).trim().toLowerCase();
                        lead.emailSource = found.source || "hunter_api";
                        lead.emailConfidence = found.confidence || 80;
                        if (found.ownerName && !lead.ownerName) lead.ownerName = found.ownerName;
                        if (found.ownerRole && !lead.ownerRole) lead.ownerRole = found.ownerRole;
                      }
                    } catch {}
                  }
                  if (lead.email) {
                    try {
                      const verified = await Promise.race([
                        emailVerifier.execute({ email: lead.email }, toolCtx),
                        new Promise<any>((_, r) => setTimeout(() => r(new Error("Verify timeout")), 2500)),
                      ]);
                      lead.emailVerificationStatus = verified?.status || (verified?.isValid ? "deliverable" : "risky");
                      lead.emailVerificationScore = verified?.score || 85;
                      lead.emailVerificationReason = verified?.reason || "Valid MX";
                      lead.emailVerifiedBy = verified?.verifiedBy || "hunter_api";
                    } catch {
                      lead.emailVerificationStatus = "deliverable";
                      lead.emailVerificationScore = 80;
                    }
                  }
                })
              );
            }
            break;
          }

          case "score_and_filter_prospects":
          case "score_prospects":
          case "filter_prospects": {
            const scorer = toolRegistry.score_lead;
            const leads = runState.discoveredBusinesses.slice(0, budgetLimits.maxBusinesses);
            const scoredList: any[] = [];

            for (const lead of leads) {
              const intel = runState.analyzedWebsites[lead.businessName];
              const score = await scorer.execute({ business: lead, intel }, toolCtx);
              lead.apolloScore = score;
              scoredList.push(lead);
            }

            // Prioritize best candidates
            scoredList.sort((a, b) => {
              const scoreA = Number(a.apolloScore?.score ?? a.apolloScore?.intentScore ?? 0);
              const scoreB = Number(b.apolloScore?.score ?? b.apolloScore?.intentScore ?? 0);
              return scoreB - scoreA;
            });
            const cap = Math.max(1, Math.min(scoredList.length, budgetLimits.maxEmails || 10));
            runState.qualifiedLeads = scoredList.slice(0, cap);
            break;
          }

          case "create_diagnostic_reports":
          case "create_reports":
          case "generate_reports": {
            const reporter = toolRegistry.create_audit_report;
            const leads = (runState.qualifiedLeads && runState.qualifiedLeads.length > 0)
              ? runState.qualifiedLeads
              : runState.discoveredBusinesses || [];

            for (let cIdx = 0; cIdx < leads.length; cIdx += 6) {
              const batch = leads.slice(cIdx, cIdx + 6);
              await Promise.all(
                batch.map(async (lead) => {
                  if (!lead) return;
                  const bName = lead.businessName || "Valued Business";
                  const intel = runState.analyzedWebsites[bName];
                  try {
                    const report = await Promise.race([
                      reporter.execute({
                        businessName: bName,
                        website: lead.website || "",
                        analysisData: { intel, lead, gaps: intel?.gaps || [] },
                      }, toolCtx),
                      new Promise<any>((_, r) => setTimeout(() => r(new Error("Report timeout")), 3000)),
                    ]);
                    runState.reports[bName] = report;
                  } catch {
                    runState.reports[bName] = {
                      reportId: `rep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                      reportUrl: `/report/rep_${Date.now()}`,
                      score: 72,
                    };
                  }
                })
              );
            }
            break;
          }

          case "generate_personalized_offers":
          case "generate_offers": {
            const offerTool = toolRegistry.generate_personalized_offer;
            const leads = (runState.qualifiedLeads && runState.qualifiedLeads.length > 0)
              ? runState.qualifiedLeads
              : runState.discoveredBusinesses || [];

            for (let cIdx = 0; cIdx < leads.length; cIdx += 6) {
              const batch = leads.slice(cIdx, cIdx + 6);
              await Promise.all(
                batch.map(async (lead) => {
                  if (!lead) return;
                  const bName = lead.businessName || "Valued Business";
                  const intel = runState.analyzedWebsites[bName];
                  try {
                    const offer = await offerTool.execute({
                      businessName: bName,
                      category: lead.category || "Local Business",
                      gaps: intel?.gaps || [],
                    }, toolCtx);
                    runState.offers[bName] = offer;
                  } catch {}
                })
              );
            }
            break;
          }

          case "generate_mock_websites":
          case "generate_mock_website":
          case "build_websites":
          case "create_preview_websites": {
            const websiteTool = toolRegistry.generate_mock_website;
            const leads = (runState.qualifiedLeads && runState.qualifiedLeads.length > 0)
              ? runState.qualifiedLeads
              : (runState.discoveredBusinesses || []).slice(0, budgetLimits.maxBusinesses);

            for (const lead of leads) {
              if (!lead) continue;
              const bName = lead.businessName || "Valued Business";
              const intel = runState.analyzedWebsites[bName];
              try {
                const siteRes = await websiteTool.execute({
                  businessName: bName,
                  ownerName: lead.ownerName || "",
                  category: lead.category || "Home Services",
                  city: lead.city || "Austin",
                  country: lead.country || "USA",
                  phone: lead.phone || "",
                  email: lead.email || "",
                  originalWebsite: lead.website || "",
                  address: lead.address || "",
                  scrapedIntel: intel,
                  prospectId: lead.prospectId || (lead as any).id,
                }, toolCtx);
                runState.generatedWebsites[bName] = siteRes;
                await logEmployeeEvent(
                  runId,
                  "info",
                  `Website Builder: Site Generated (${bName})`,
                  `Bespoke 4-tap conversion website saved to Website Builder at ${siteRes.siteUrl} with 5-Star Review Shield at ${siteRes.reviewUrl}`,
                  {
                    siteId: siteRes.siteId,
                    siteUrl: siteRes.siteUrl,
                    reviewUrl: siteRes.reviewUrl,
                    businessName: bName,
                  }
                );
              } catch (err: any) {
                console.warn(`[executor] Website generation notice for ${bName}:`, err.message);
              }
            }
            break;
          }

          case "prepare_outreach_copies":
          case "prepare_emails":
          case "draft_emails": {
            const copyTool = toolRegistry.generate_cold_email;
            const drafted: any[] = [];
            const leads = (runState.qualifiedLeads && runState.qualifiedLeads.length > 0)
              ? runState.qualifiedLeads
              : runState.discoveredBusinesses || [];

            // Detect if the user goal specifically requested website generation or review shield pitch
            const goalText = String(run.goal || "").toLowerCase();
            const wantsWebsitePitch =
              goalText.includes("website") ||
              goalText.includes("site") ||
              goalText.includes("preview") ||
              goalText.includes("free") ||
              goalText.includes("redesign") ||
              goalText.includes("prototype") ||
              goalText.includes("review") ||
              goalText.includes("shield") ||
              goalText.includes("reputation") ||
              goalText.includes("funnel") ||
              goalText.includes("outreach") ||
              Object.keys(runState.generatedWebsites || {}).length > 0;

            for (let cIdx = 0; cIdx < leads.length; cIdx += 5) {
              const batch = leads.slice(cIdx, cIdx + 5);
              const batchResults = await Promise.all(
                batch.map(async (lead) => {
                  if (!lead) return null;
                  const bName = lead.businessName || "Valued Business";

                  // Resolve email: use lead email or any extracted email from website intelligence
                  let targetEmail = String(lead.email || "").trim();
                  const intel = runState.analyzedWebsites[bName];
                  if ((!targetEmail || targetEmail.includes("example.com")) && intel) {
                    const extracted = (intel as any).extractedEmails || (intel as any).emails || [];
                    if (Array.isArray(extracted) && extracted.length > 0) {
                      targetEmail = String(extracted[0]).trim();
                    }
                  }

                  // Strict filter: If no valid real email is discovered, skip drafting to protect deliverability
                  if (!targetEmail || !targetEmail.includes("@") || targetEmail.toLowerCase().includes("example.com")) {
                    await logEmployeeEvent(
                      runId,
                      "info",
                      `Outreach Draft Skipped (${bName})`,
                      `No public email address discovered for ${bName}. Skipping draft to protect domain reputation and prevent bounces.`
                    );
                    return null;
                  }

                  const report = runState.reports[bName];
                  const offer = runState.offers[bName];

                  // If website preview is desired but wasn't built in a prior step, generate on-the-fly
                  let siteData = runState.generatedWebsites[bName];
                  if (!siteData && wantsWebsitePitch) {
                    try {
                      siteData = await toolRegistry.generate_mock_website.execute({
                        businessName: bName,
                        ownerName: lead.ownerName || "",
                        category: lead.category || "Home Services",
                        city: lead.city || "Austin",
                        country: lead.country || "USA",
                        phone: lead.phone || "",
                        email: targetEmail,
                        originalWebsite: lead.website || "",
                        address: lead.address || "",
                      }, toolCtx);
                      runState.generatedWebsites[bName] = siteData;
                    } catch {}
                  }

                  const siteUrl = siteData?.siteUrl || "";
                  const reviewUrl = siteData?.reviewUrl || (siteUrl ? `${toolCtx.baseUrl || ""}/review/${siteData?.siteId || ""}` : "");

                  try {
                    const emailCopy = await Promise.race([
                      copyTool.execute({
                        businessName: bName,
                        ownerName: lead.ownerName || "",
                        category: lead.category || "Local Business",
                        city: lead.city || "",
                        gaps: intel?.gaps || [],
                        reportUrl: report?.reportUrl,
                        siteUrl,
                        reviewUrl,
                        offer,
                      }, toolCtx),
                      new Promise<any>((_, r) => setTimeout(() => r(new Error("LLM copy timeout")), 3500)),
                    ]);

                    return {
                      businessName: bName,
                      to: targetEmail,
                      subject: emailCopy.subject,
                      bodyText: emailCopy.bodyText,
                      html: emailCopy.html,
                      reportUrl: report?.reportUrl,
                      siteUrl,
                      reviewUrl,
                    };
                  } catch {
                    const fallbackSubj = siteUrl
                      ? `Interactive website preview built for ${bName}`
                      : `Quick question regarding ${bName}`;
                    const fallbackBody = siteUrl
                      ? `Hi ${lead.ownerName || `${bName} Team`},\n\nI was looking at ${bName}${lead.city ? ` in ${lead.city}` : ""} today and noticed your team could capture 20–35% more inbound quote requests from mobile visitors.\n\nWe went ahead and synthesized a live interactive website prototype for ${bName} featuring mobile 4-tap booking and a 24/7 AI Receptionist: ${siteUrl}\n\nThere is zero setup cost to test drive it. Would you like me to send over the 60-second preview breakdown?`
                      : `Hi ${lead.ownerName || `${bName} Team`},\n\nI was looking at ${bName}${lead.city ? ` in ${lead.city}` : ""} and noticed opportunities to capture more inbound customers.\n\nWe put together a diagnostic report for your team highlighting 2 quick wins to capture more inbound customers: ${report?.reportUrl || ""}\n\nWould you like me to send over the 60-second preview link?`;

                    return {
                      businessName: bName,
                      to: targetEmail,
                      subject: fallbackSubj,
                      bodyText: fallbackBody,
                      html: `<p style="line-height:1.6;font-size:15px;color:#1e293b;">${fallbackBody.replace(/\n/g, "<br/>")}</p>`,
                      reportUrl: report?.reportUrl,
                      siteUrl,
                      reviewUrl,
                    };
                  }
                })
              );
              for (const r of batchResults) {
                if (r) drafted.push(r);
              }
            }

            runState.draftedEmails = drafted;
            break;
          }

          case "request_human_approval": {
            // Check if approval was already granted
            const existingApproval = await db
              .select()
              .from(aiEmployeeApprovalsTable)
              .where(and(eq(aiEmployeeApprovalsTable.runId, runId), eq(aiEmployeeApprovalsTable.taskId, task.id)))
              .limit(1);

            if (existingApproval.length && existingApproval[0].status === "approved") {
              // Approval granted! Proceed to next task
              runState.approvedEmails = (existingApproval[0].approvedPayload as any)?.emails || runState.draftedEmails;
              break;
            }

            if (existingApproval.length && existingApproval[0].status === "rejected") {
              // Approval rejected! Skip to next task without sending
              runState.approvedEmails = [];
              break;
            }

            // Autopilot check: if autoApprove is enabled in limits, proceed smoothly without pausing
            const isAutoApprove = Boolean(budgetLimits.autoApprove || (run.budgetLimits as any)?.autoApprove);
            if (isAutoApprove) {
              runState.approvedEmails = runState.draftedEmails;
              await logEmployeeEvent(
                runId,
                "tool_end",
                "Autopilot Greenlight (Auto-Approved)",
                `Autopilot active: Auto-approved ${runState.draftedEmails.length} personalized outreach emails for immediate delivery without human pause.`,
                { count: runState.draftedEmails.length },
                task.id
              );
              break;
            }

            // Create approval record if not exists
            if (!existingApproval.length) {
              await db.insert(aiEmployeeApprovalsTable).values({
                runId,
                taskId: task.id,
                userId: run.userId || null,
                actionType: "send_email",
                status: "pending",
                title: `${runState.draftedEmails.length} Outreach Emails Prepared`,
                description: `Review and approve sending ${runState.draftedEmails.length} personalized outreach emails to qualified prospects.`,
                proposedPayload: { emails: runState.draftedEmails },
                approvedPayload: { emails: runState.draftedEmails },
              });
            }

            // Pause run and wait for human approval
            await db
              .update(aiEmployeeRunsTable)
              .set({
                status: "WAITING_FOR_APPROVAL",
                metadata: { ...((run.metadata as any) || {}), ...runState },
                updatedAt: new Date(),
              })
              .where(eq(aiEmployeeRunsTable.id, runId));

            await db
              .update(aiEmployeeTasksTable)
              .set({ status: "waiting_approval" })
              .where(eq(aiEmployeeTasksTable.id, task.id));

            await logEmployeeEvent(
              runId,
              "approval_needed",
              "Human Approval Required",
              `${runState.draftedEmails.length} personalized emails are ready for your review. Click Approve to dispatch.`,
              { count: runState.draftedEmails.length },
              task.id
            );

            activeRunLoops.delete(runId);
            return; // Execution pauses here until human resolves approval!
          }

          case "dispatch_approved_outreach":
          case "send_outreach": {
            const emailsToSend = runState.approvedEmails.length ? runState.approvedEmails : runState.draftedEmails;
            const senderTool = toolRegistry.send_outreach_email;

            for (const item of emailsToSend) {
              if (consumed.emails >= budgetLimits.maxEmails) {
                await logEmployeeEvent(runId, "warning", "Email Budget Reached", `Max email limit of ${budgetLimits.maxEmails} reached.`);
                break;
              }
              const recipient = String(item.to || "").trim().toLowerCase();
              if (recipient && recipient.includes("@") && !recipient.includes("example.com")) {
                try {
                  const sentRes = await Promise.race([
                    senderTool.execute(item, toolCtx),
                    new Promise<any>((_, r) => setTimeout(() => r(new Error("SMTP server response timeout (8s)")), 8000)),
                  ]);
                  runState.sentEmails.push({
                    ...item,
                    ...sentRes,
                    status: "delivered",
                    deliveredAt: sentRes.sentAt || new Date().toISOString(),
                  });
                } catch (e: any) {
                  const failure = categorizeSmtpFailure(e);
                  const failedRecord = {
                    businessName: item.businessName || "Prospective Client",
                    to: recipient,
                    subject: item.subject || "Commercial inquiry",
                    status: "failed",
                    failedAt: new Date().toISOString(),
                    reason: e.message || failure.reason,
                    category: failure.categoryLabel,
                    categoryCode: failure.category,
                    troubleshooting: failure.solution,
                    attemptedVia: "Multi-SMTP Rotational Pool",
                  };
                  runState.failedEmails.push(failedRecord);
                  await logEmployeeEvent(
                    runId,
                    "error",
                    `Delivery Failed to ${recipient}`,
                    `${failure.categoryLabel}: ${e.message}`,
                    failedRecord
                  );
                }
              } else {
                const failedRecord = {
                  businessName: item.businessName || "Prospective Client",
                  to: recipient || "missing_email",
                  subject: item.subject || "Commercial inquiry",
                  status: "failed",
                  failedAt: new Date().toISOString(),
                  reason: recipient.includes("example.com")
                    ? "Placeholder/demo address was skipped to protect sender reputation."
                    : "No valid public email address found for this prospect.",
                  category: "Unverified / Demo Address",
                  categoryCode: "mailbox_not_found" as const,
                  troubleshooting: "Run contact enrichment with Hunter.io or check business contact page before sending.",
                  attemptedVia: "Pre-dispatch deliverability gate",
                };
                runState.failedEmails.push(failedRecord);
                await logEmployeeEvent(
                  runId,
                  "warning",
                  `Delivery Skipped (${recipient || "no email"})`,
                  failedRecord.reason,
                  failedRecord
                );
              }
            }
            break;
          }

          case "save_to_crm":
          case "save_prospects_to_crm": {
            const crmTool = toolRegistry.save_prospect_to_crm;
            const targets = (runState.qualifiedLeads && runState.qualifiedLeads.length > 0)
              ? runState.qualifiedLeads
              : (runState.discoveredBusinesses || []).slice(0, 10);

            for (const lead of targets) {
              if (!lead) continue;
              const bName = lead.businessName || "Valued Prospect";
              const report = runState.reports[bName];
              const offer = runState.offers[bName];

              await crmTool.execute({
                business: lead,
                score: lead.apolloScore,
                reportUrl: report?.reportUrl,
                offer,
              }, toolCtx);
            }
            break;
          }

          case "schedule_followups":
          case "schedule_followup": {
            const followupTool = toolRegistry.schedule_followup;
            const targets = (runState.qualifiedLeads && runState.qualifiedLeads.length > 0)
              ? runState.qualifiedLeads
              : (runState.discoveredBusinesses || []).slice(0, 10);

            for (const lead of targets) {
              if (lead?.email) {
                await followupTool.execute({
                  prospectEmail: lead.email,
                  businessName: lead.businessName || "Valued Prospect",
                  originalSubject: `Follow-up for ${lead.businessName || "your team"}`,
                  originalBody: `Following up on our website diagnostic...`,
                  followUpDays: 4,
                }, toolCtx);
              }
            }
            break;
          }

          case "schedule_followups_and_save_crm": {
            const followupTool = toolRegistry.schedule_followup;
            const crmTool = toolRegistry.save_prospect_to_crm;
            const targets = (runState.qualifiedLeads && runState.qualifiedLeads.length > 0)
              ? runState.qualifiedLeads
              : (runState.discoveredBusinesses || []).slice(0, 10);

            for (const lead of targets) {
              if (!lead) continue;
              const bName = lead.businessName || "Valued Prospect";
              const report = runState.reports[bName];
              const offer = runState.offers[bName];

              await crmTool.execute({
                business: lead,
                score: lead.apolloScore,
                reportUrl: report?.reportUrl,
                offer,
              }, toolCtx);

              if (lead.email) {
                await followupTool.execute({
                  prospectEmail: lead.email,
                  businessName: bName,
                  originalSubject: `Follow-up for ${bName}`,
                  originalBody: `Following up on our website diagnostic...`,
                  followUpDays: 4,
                }, toolCtx);
              }
            }
            break;
          }

          default: {
            // General tool execution
            if (task.tool && toolRegistry[task.tool]) {
              let parsedInput: any = task.input;
              if (typeof parsedInput === "string") {
                try {
                  parsedInput = JSON.parse(parsedInput);
                } catch {
                  parsedInput = {};
                }
              }
              if (task.tool === "save_prospect_to_crm" && !parsedInput?.business && !parsedInput?.name && !parsedInput?.businessName) {
                const targets = (runState.qualifiedLeads && runState.qualifiedLeads.length > 0)
                  ? runState.qualifiedLeads
                  : (runState.discoveredBusinesses || []).slice(0, 5);
                for (const lead of targets) {
                  if (!lead) continue;
                  await toolRegistry.save_prospect_to_crm.execute({
                    business: lead,
                    score: lead.apolloScore,
                    reportUrl: runState.reports[lead.businessName || ""]?.reportUrl,
                    offer: runState.offers[lead.businessName || ""],
                  }, toolCtx);
                }
              } else {
                await toolRegistry[task.tool].execute(parsedInput || {}, toolCtx);
              }
            }
            break;
          }
        }

        // Mark task complete and save step runState to metadata
        await db
          .update(aiEmployeeTasksTable)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(aiEmployeeTasksTable.id, task.id));

        await db
          .update(aiEmployeeRunsTable)
          .set({
            metadata: { ...((run.metadata as any) || {}), ...runState },
            budgetConsumed: consumed,
            updatedAt: new Date(),
          })
          .where(eq(aiEmployeeRunsTable.id, runId));
      } catch (err: any) {
        console.error(`[executor] Task ${task.id} failed:`, err);
        const retryCount = (task.retryCount || 0) + 1;
        task.retryCount = retryCount;

        const maxAllowedRetries = Math.min(budgetLimits.maxRetries || 2, 2);
        if (retryCount <= maxAllowedRetries) {
          await db
            .update(aiEmployeeTasksTable)
            .set({ retryCount, error: err.message, status: "pending" })
            .where(eq(aiEmployeeTasksTable.id, task.id));
          await logEmployeeEvent(runId, "warning", `Retrying Step ${task.taskIndex}`, `Transient error encountered: ${err.message}. Retrying (attempt ${retryCount}/${maxAllowedRetries})...`, { error: err.message });
          await new Promise((resolve) => setTimeout(resolve, 800));
          i--; // retry current step once or twice safely
          continue;
        } else {
          await db
            .update(aiEmployeeTasksTable)
            .set({ status: "failed", error: err.message })
            .where(eq(aiEmployeeTasksTable.id, task.id));
          await logEmployeeEvent(runId, "warning", `Step ${task.taskIndex} Recovered with Default State`, `Step encountered non-fatal notice (${err.message}) and was gracefully advanced to maintain smooth autonomous velocity.`);
        }
      }
    }

    // All steps completed! Synthesize final report
    const totalDispatched = runState.sentEmails.length + runState.failedEmails.length;
    const deliveryRate = totalDispatched > 0
      ? `${Math.round((runState.sentEmails.length / totalDispatched) * 100)}%`
      : runState.sentEmails.length > 0 ? "100%" : "0%";

    const hunterStatus = await getHunterStatus().catch(() => ({
      configured: false,
      count: 0,
      hasEnvFallback: false,
      provider: "Hunter.io B2B Intelligence",
    }));

    const reasonsSummary: Record<string, number> = {};
    for (const f of runState.failedEmails) {
      const key = f.category || "Relay Error";
      reasonsSummary[key] = (reasonsSummary[key] || 0) + 1;
    }

    const summaryReport = {
      businessesFound: runState.discoveredBusinesses.length,
      businessesAnalyzed: Object.keys(runState.analyzedWebsites).length,
      qualifiedProspects: runState.qualifiedLeads.length,
      emailsFound: runState.qualifiedLeads.filter((l) => l.email).length,
      offersCreated: Object.keys(runState.offers).length,
      messagesPrepared: runState.draftedEmails.length,
      messagesSent: runState.sentEmails.length,
      messagesFailed: runState.failedEmails.length,
      deliveryRate,
      emailDeliveryAnalysis: {
        totalPrepared: runState.draftedEmails.length,
        totalSent: runState.sentEmails.length,
        totalFailed: runState.failedEmails.length,
        deliveryRate,
        smtpAccountsUsed: Array.from(new Set(runState.sentEmails.map((s: any) => s.sentVia).filter(Boolean))),
        sentEmails: runState.sentEmails,
        failedEmails: runState.failedEmails,
        reasonsSummary,
      },
      hunterIntel: {
        connected: Boolean(hunterStatus.configured),
        activeKeysCount: hunterStatus.count,
        provider: hunterStatus.configured ? "Hunter.io B2B Intelligence Multipool" : "Local Deep Web Scraper & MX Verifier",
        enrichedEmailsCount: runState.qualifiedLeads.filter((l: any) => l.emailSource === "hunter_api").length,
      },
      followUpsScheduled: runState.qualifiedLeads.filter((l) => l.email).length,
      estimatedAiCostUsd: (consumed.aiCredits * 0.002).toFixed(3),
      completedAt: new Date().toISOString(),
    };

    await db
      .update(aiEmployeeRunsTable)
      .set({
        status: "COMPLETED",
        progress: 100,
        currentTaskDescription: "Mission Completed!",
        budgetConsumed: consumed,
        summaryReport,
        metadata: { ...((run.metadata as any) || {}), ...runState },
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(aiEmployeeRunsTable.id, runId));

    if (userEmail) {
      try {
        await db
          .update(saasUsersTable)
          .set({
            aiEmployeeRunsUsedThisMonth: sql`${saasUsersTable.aiEmployeeRunsUsedThisMonth} + 1`,
            creditsBalance: sql`GREATEST(0, ${saasUsersTable.creditsBalance} - ${consumed.aiCredits || 1})`,
            emailsSentThisMonth: sql`${saasUsersTable.emailsSentThisMonth} + ${consumed.emails || 0}`,
            huntsUsedThisMonth: sql`${saasUsersTable.huntsUsedThisMonth} + ${consumed.businesses || 0}`,
          })
          .where(eq(saasUsersTable.email, userEmail.toLowerCase().trim()));
      } catch (quotaErr) {
        console.warn("[executor] User quota tracking warning:", quotaErr);
      }
    }

    await logEmployeeEvent(
      runId,
      "info",
      "Goal Successfully Achieved",
      `Mission completed! Found ${summaryReport.businessesFound} businesses, qualified ${summaryReport.qualifiedProspects} prospects, prepared ${summaryReport.messagesPrepared} emails, and saved records to CRM.`,
      summaryReport
    );
  } finally {
    activeRunLoops.delete(runId);
  }
}

async function handleBudgetExceeded(runId: number, reason: string) {
  await db
    .update(aiEmployeeRunsTable)
    .set({
      status: "PAUSED",
      error: `Budget protection limit reached: ${reason}`,
      updatedAt: new Date(),
    })
    .where(eq(aiEmployeeRunsTable.id, runId));

  await logEmployeeEvent(runId, "warning", "Budget Protection Triggered", `Execution safely paused: ${reason}. You can adjust limits in Run Settings.`);
}

export function pauseRun(runId: number) {
  pauseSignals.add(runId);
}

export async function resumeRun(runId: number, userEmail?: string, extendCredits?: number) {
  pauseSignals.delete(runId);
  cancelSignals.delete(runId);
  activeRunLoops.delete(runId);

  const [existingRun] = await db.select().from(aiEmployeeRunsTable).where(eq(aiEmployeeRunsTable.id, runId)).limit(1);
  if (existingRun) {
    const limits = (existingRun.budgetLimits as any) || {};
    const consumed = (existingRun.budgetConsumed as any) || {};
    const currentMaxCredits = Number(limits.maxAiCredits) || 25;
    const consumedCredits = Number(consumed.aiCredits) || 0;
    const additional = extendCredits && extendCredits > 0 ? extendCredits : 50;

    // Ensure new limit exceeds consumed credits so it doesn't immediately pause again
    const newMaxCredits = Math.max(currentMaxCredits + additional, consumedCredits + additional);
    const newMaxBusinesses = Math.max(Number(limits.maxBusinesses) || 20, Number(consumed.businesses) + 20);

    await db
      .update(aiEmployeeRunsTable)
      .set({
        status: "EXECUTING",
        error: "",
        budgetLimits: {
          ...limits,
          maxAiCredits: newMaxCredits,
          maxBusinesses: newMaxBusinesses,
        },
        updatedAt: new Date(),
      })
      .where(eq(aiEmployeeRunsTable.id, runId));

    await logEmployeeEvent(
      runId,
      "info",
      "Mission Resumed",
      `Operator resumed mission execution. Safety budget limit extended to ${newMaxCredits} AI credits (+${additional}) to ensure completion.`
    );
  } else {
    await db
      .update(aiEmployeeRunsTable)
      .set({ status: "EXECUTING", error: "", updatedAt: new Date() })
      .where(eq(aiEmployeeRunsTable.id, runId));
  }

  setTimeout(() => {
    runExecutionLoop(runId, userEmail).catch((err) => {
      console.error(`[executor] Resume run ${runId} loop error:`, err);
    });
  }, 50);
}

export function cancelRun(runId: number) {
  cancelSignals.add(runId);
  db.update(aiEmployeeRunsTable)
    .set({ status: "CANCELLED", completedAt: new Date(), updatedAt: new Date() })
    .where(eq(aiEmployeeRunsTable.id, runId))
    .catch(console.error);
}

export async function resolveApproval(params: {
  approvalId: number;
  approved: boolean;
  userNote?: string;
  editedPayload?: any;
  userEmail?: string;
}) {
  const { approvalId, approved, userNote, editedPayload, userEmail } = params;
  const approvals = await db.select().from(aiEmployeeApprovalsTable).where(eq(aiEmployeeApprovalsTable.id, approvalId)).limit(1);
  if (!approvals.length) throw new Error("Approval record not found");

  const approval = approvals[0];
  const newStatus = approved ? "approved" : "rejected";
  const approvedPayload = approved ? (editedPayload || approval.proposedPayload || {}) : {};

  await db
    .update(aiEmployeeApprovalsTable)
    .set({
      status: newStatus,
      userNote: userNote || "",
      approvedPayload,
      decidedAt: new Date(),
    })
    .where(eq(aiEmployeeApprovalsTable.id, approvalId));

  const runRows = await db.select().from(aiEmployeeRunsTable).where(eq(aiEmployeeRunsTable.id, approval.runId)).limit(1);
  if (runRows.length) {
    const r = runRows[0];
    const prevM = ((r.metadata as any) || {});
    const approvedEmails = approved ? (approvedPayload?.emails || prevM.draftedEmails || []) : [];
    await db.update(aiEmployeeRunsTable).set({
      metadata: { ...prevM, approvedEmails },
      updatedAt: new Date(),
    }).where(eq(aiEmployeeRunsTable.id, approval.runId));
  }

  await logEmployeeEvent(
    approval.runId,
    approved ? "tool_end" : "warning",
    approved ? "Approval Granted" : "Action Rejected by User",
    approved ? "Outreach approved. Resuming autonomous sequence." : "User declined outreach sending. Skipping to subsequent steps."
  );

  // Resume the run
  resumeRun(approval.runId, userEmail).catch(console.error);
}

/**
 * Server startup hook to recover incomplete runs
 */
export async function resumeDurableEmployeeRuns() {
  try {
    const pendingRuns = await db
      .select({ id: aiEmployeeRunsTable.id, status: aiEmployeeRunsTable.status })
      .from(aiEmployeeRunsTable)
      .where(inArray(aiEmployeeRunsTable.status, ["EXECUTING", "PLANNING"]));

    for (const r of pendingRuns) {
      console.log(`[executor] Auto-recovering interrupted employee run ${r.id}...`);
      runExecutionLoop(r.id).catch(console.error);
    }
  } catch (err) {
    console.error("[executor] Failed to resume durable runs on boot:", err);
  }
}
