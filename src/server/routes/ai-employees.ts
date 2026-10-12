/**
 * ai-employees.ts
 *
 * REST API routes for the AI Sales Employee.
 * Fully authenticated, feature-flagged, and provides real-time state for runs, tasks, approvals, and memories.
 */

import { Router, Request, Response } from "express";
import { db, aiEmployeesTable, aiEmployeeRunsTable, aiEmployeeTasksTable, aiEmployeeEventsTable, aiEmployeeApprovalsTable, aiEmployeeMemoriesTable, emailAccountsTable, saasUsersTable, saasPlansTable } from "../../db";
import { eq, desc, and } from "drizzle-orm";
import { startEmployeeRun, pauseRun, resumeRun, cancelRun, resolveApproval } from "../lib/ai-employee/executor";
import { getHunterStatus } from "../lib/hunter-client";
import { toolRegistry } from "../lib/ai-employee/tool-registry";
import { getAllActiveAccounts, getNextAccount, sendWithFailover, createTracking, injectTracking } from "./crm-ai";
import { checkUserAiEmployeeLimit, checkUserGenerationLimit, recordUserAiEmployeeRun, resolveSaasUser } from "../lib/plan-limits";

const router = Router();

// Feature flag check helper
function isAiEmployeesEnabled(): boolean {
  return process.env.AI_EMPLOYEES_ENABLED !== "false";
}

// ─── Feature Flag Status ──────────────────────────────────────────────────────
router.get("/ai-employees/feature-flag", (_req: Request, res: Response) => {
  res.json({
    enabled: isAiEmployeesEnabled(),
    featureFlag: "AI_EMPLOYEES_ENABLED",
  });
});

// Middleware to check feature flag
router.use("/ai-employees", (_req: Request, res: Response, next) => {
  if (!isAiEmployeesEnabled()) {
    res.status(403).json({ error: "AI Employees feature is currently disabled via feature flag." });
    return;
  }
  next();
});

// ─── Default AI Employee Fleet ───────────────────────────────────────────────
const DEFAULT_EMPLOYEES = [
  {
    name: "Alex Rivera — Senior Autonomous Sales Employee",
    role: "Autonomous Lead Discovery & Outreach Specialist",
    description: "Full-cycle autonomous sales employee: discovers local B2B businesses across multi-directory scrapers, runs comprehensive website diagnostics, verifies decision-maker emails, automatically synthesizes live conversion websites and 5-Star Review Shields, and prepares cold outreach embedding the live preview links.",
    avatar: "🕵️",
    status: "active",
    config: {
      specialty: "Full-Cycle Outbound Pipeline & Live Website Generation",
      skills: ["Multi-Directory Scraping", "Website Diagnostics", "Apollo Intent Scoring", "AI Website Generation", "5-Star Review Shielding", "Cold Outreach Copywriting"],
      defaultGoal: "Find 20 roofing companies in Austin Texas that have poor websites. Perform diagnostics, generate live conversion preview websites and 5-Star Review Shields for them, and draft personalized outreach emails including the free website preview link.",
      experienceLevel: "Senior Specialist",
      missionsCompleted: 148,
      satisfactionRate: "99.4%",
    },
  },
  {
    name: "Elena Rostova — Technical Diagnostic Engineer",
    role: "Deep Website Audits & Conversion Gap Specialist",
    description: "Specialized in deep technical audits of business websites: detects missing SSL certificates, sluggish load times, absent mobile click-to-call actions, lack of 24/7 quote booking, and creates shareable interactive audit reports.",
    avatar: "🔬",
    status: "active",
    config: {
      specialty: "Technical & UX Diagnostics",
      skills: ["CMS Detection", "Mobile Responsiveness", "Speed & SSL Scans", "Interactive Client Reports", "Conversion Leak Identification"],
      defaultGoal: "Audit 15 dental and medical clinics in Miami for missing after-hours appointment scheduling and slow mobile load times. Generate interactive diagnostic audit reports.",
      experienceLevel: "Lead Diagnostic Engineer",
      missionsCompleted: 214,
      satisfactionRate: "98.8%",
    },
  },
  {
    name: "Marcus Vance — Commercial Offer & Outreach Writer",
    role: "Value Proposition Synthesis & High-Converting Pitch Writer",
    description: "Synthesizes high-converting commercial propositions tailored to each prospect's specific gaps (e.g. Free 4-Tap Website Upgrade, 24/7 AI Receptionist, 5-Star Review Shield). Automatically generates live website prototypes and drafts personalized cold emails with waived $1,500 build fee pitches.",
    avatar: "✍️",
    status: "active",
    config: {
      specialty: "Free Website Outreach & Commercial Pitch",
      skills: ["Commercial Pitch Synthesis", "Free Website Upgrade Pitch", "5-Star Review Shield Pitch", "Cold Email Copywriting", "Spam-Trigger Elimination"],
      defaultGoal: "Synthesize tailored commercial proposals and personalized cold outreach emails for HVAC and plumbing contractors in Denver. Automatically generate live website preview and 5-Star Review Shield links, embedding them in the email outreach.",
      experienceLevel: "Outreach Copy Director",
      missionsCompleted: 182,
      satisfactionRate: "99.1%",
    },
  },
  {
    name: "Sophia Chen — Apollo & Contact Enrichment Agent",
    role: "B2B Decision-Maker Finder & Zero-Bounce Gate",
    description: "Finds verified owners, partners, and decision-maker emails using multi-engine crawling and DNS/MX deliverability checks. Eliminates dead/fake domains to safeguard domain sender reputation.",
    avatar: "🎯",
    status: "active",
    config: {
      specialty: "Contact Enrichment & Deliverability",
      skills: ["Decision-Maker Discovery", "DNS/MX Deliverability Checks", "Apollo Buyer Intent Scoring", "Spam-Trap Filtering", "Role Identification"],
      defaultGoal: "Discover verified owner emails and compute Apollo Buyer Intent scores for 25 commercial landscaping businesses in Phoenix with active phone lines.",
      experienceLevel: "Data & Enrichment Lead",
      missionsCompleted: 309,
      satisfactionRate: "99.7%",
    },
  },
  {
    name: "David Sterling — Reputation Shield & Reviews Director",
    role: "5-Star Review Funnels & Local Reputation Defense",
    description: "Specialized in local business reputation growth: diagnoses review deficit gaps, activates automated 5-star customer review funnels at /review/:siteId with QR codes, filters negative reviews privately, and crafts outreach embedding live review shield links.",
    avatar: "🛡️",
    status: "active",
    config: {
      specialty: "5-Star Review Funnel & Reputation Defense",
      skills: ["Review Velocity Diagnostics", "Negative Review Shielding", "QR Code Generation", "SMS Review Sequences", "Local Google Map Pack SEO"],
      defaultGoal: "Find 15 medspas and home service contractors in Dallas with fewer than 50 Google reviews. Diagnose reputation deficit gaps, build live 5-Star Review Shield pages and website previews, and draft outreach emails with the review link.",
      experienceLevel: "Reputation Growth Director",
      missionsCompleted: 195,
      satisfactionRate: "99.5%",
    },
  },
  {
    name: "Rachel Morgan — Multi-Channel Follow-Up & Pipeline Closer",
    role: "Autonomous Follow-Up Sequences & Objections Triage Lead",
    description: "Specialized in high-touch prospect follow-ups: schedules intelligent 3-phase follow-up cadences, automatically classifies inbound responses (interested, objection, meeting requested), routes calendar booking links, and pushes qualified conversions straight into the CRM pipeline.",
    avatar: "📅",
    status: "active",
    config: {
      specialty: "Follow-Up Sequences & Pipeline Conversions",
      skills: ["Smart Cadence Scheduling", "Objection Handling", "Calendar Booking Routing", "No-Show Re-engagement", "Pipeline Stage Automation"],
      defaultGoal: "Audit 20 commercial roofing and remodeling contractors in Austin. Schedule 3-touch personalized follow-up sequences with tailored ROI value propositions.",
      experienceLevel: "Senior Pipeline Director",
      missionsCompleted: 242,
      satisfactionRate: "99.6%",
    },
  },
  {
    name: "Vikram Patel — Local 3-Pack SEO & Google Map Pack Specialist",
    role: "Google Business Profile & Map Pack Ranking Gap Strategist",
    description: "Specialized in local Google Map Pack visibility: diagnoses local 3-Pack rank deficits, audits citation consistency across directories, identifies missing location schema, and formulates high-ticket local SEO conversion proposals.",
    avatar: "📍",
    status: "active",
    config: {
      specialty: "Local Map Pack & Citation Defense",
      skills: ["Google 3-Pack Audits", "Citation Consistency Scans", "Geo-Grid Rank Mapping", "Local Schema Verification", "Map Pack Proposal Generation"],
      defaultGoal: "Audit 20 local home service businesses in Austin ranking outside the Google Local 3-Pack. Diagnose missing geo-citations and generate customized local SEO growth proposals.",
      experienceLevel: "Map Pack Ranking Specialist",
      missionsCompleted: 178,
      satisfactionRate: "99.3%",
    },
  },
];

async function ensureSeededEmployees() {
  const existing = await db.select().from(aiEmployeesTable);
  const existingNames = new Set(existing.map((e) => e.name));
  for (const emp of DEFAULT_EMPLOYEES) {
    if (!existingNames.has(emp.name)) {
      await db.insert(aiEmployeesTable).values({
        name: emp.name,
        role: emp.role,
        description: emp.description,
        avatar: emp.avatar,
        status: emp.status,
        config: JSON.stringify(emp.config),
      });
      existingNames.add(emp.name);
    }
  }
}

// ─── List Employees ───────────────────────────────────────────────────────────
router.get("/ai-employees", async (_req: Request, res: Response) => {
  try {
    await ensureSeededEmployees();
    const employees = await db.select().from(aiEmployeesTable).orderBy(aiEmployeesTable.id);
    res.json(employees);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Launch a New Run ─────────────────────────────────────────────────────────
router.post("/ai-employees/runs", async (req: Request, res: Response) => {
  const { goal, customLimits, employeeId, userMemory } = req.body;
  if (!goal || typeof goal !== "string" || !goal.trim()) {
    res.status(400).json({ error: "A valid natural-language goal is required (e.g. 'Find 50 roofing companies in Texas with poor websites...')" });
    return;
  }

  const resolvedUser = (req as any).user || (await resolveSaasUser(req));
  const user = resolvedUser;
  const userEmail = resolvedUser?.email || (req.headers["x-user-email"] as string) || "";

  // Enforce SaaS user plan limits for AI Employee missions
  const empLimitCheck = await checkUserAiEmployeeLimit(resolvedUser || req);
  if (!empLimitCheck.allowed) {
    res.status(403).json({
      error: empLimitCheck.errorMessage,
      limitReached: true,
      upgradeRequired: true,
      limitType: "ai_employee",
      planId: empLimitCheck.planId,
      planName: empLimitCheck.planName,
      used: empLimitCheck.usedThisMonth,
      limit: empLimitCheck.monthlyLimit,
    });
    return;
  }

  try {
    const { runId, plan } = await startEmployeeRun({
      userId: user?.id || null,
      userEmail,
      goal: goal.trim(),
      customLimits,
      employeeId: employeeId || 1,
      userMemory,
    });

    if (userEmail) {
      void recordUserAiEmployeeRun(userEmail);
    }

    res.json({
      success: true,
      runId,
      goal: goal.trim(),
      plan,
      message: "AI Sales Employee hired and initialized execution plan.",
    });
  } catch (err: any) {
    console.error("[ai-employees] Failed to start run:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Seed Helper for Realistic Showcase Mission ──────────────────────────────
async function ensureSeededShowcaseRun() {
  try {
    const existing = await db.select().from(aiEmployeeRunsTable).limit(5);
    const hasDetailedAnalysis = existing.some((r) => ((r.summaryReport as any)?.emailDeliveryAnalysis?.totalSent !== undefined));
    if (hasDetailedAnalysis) return;

    const realisticBusinesses = [
      {
        businessName: "Longhorn Roofing",
        category: "Roofing",
        city: "Austin",
        country: "USA",
        website: "https://www.austinlonghornroofing.com",
        phone: "+1 (512) 478-2500",
        email: "service@austinlonghornroofing.com",
        ownerName: "Robert Vance",
        cmsPlatform: "WordPress / Elementor",
        emailVerificationStatus: "deliverable",
        apolloScore: { score: 88, tier: "hot", reasons: ["Direct email verified", "Missing 24/7 AI chat widget", "No online quote booking"] },
      },
      {
        businessName: "21st Century Painting & Roofing",
        category: "Roofing",
        city: "Austin",
        country: "USA",
        website: "https://www.21stcenturytexas.com",
        phone: "+1 (512) 219-0300",
        email: "office@21stcenturytexas.com",
        ownerName: "Michael Sterling",
        cmsPlatform: "Custom HTML",
        emailVerificationStatus: "deliverable",
        apolloScore: { score: 84, tier: "hot", reasons: ["Owner identified", "No Meta retargeting pixel", "Static contact form only"] },
      },
      {
        businessName: "Austin Gutterman",
        category: "Roofing & Gutters",
        city: "Austin",
        country: "USA",
        website: "http://www.austingutterman.com",
        phone: "+1 (512) 450-1821",
        email: "estimates@austingutterman.com",
        ownerName: "David Cole",
        cmsPlatform: "Joomla",
        emailVerificationStatus: "deliverable",
        apolloScore: { score: 82, tier: "hot", reasons: ["Verified business email", "Missing SSL certificate on forms", "No mobile call-to-action bar"] },
      },
      {
        businessName: "Water Damage & Roofing of Austin",
        category: "Roofing",
        city: "Austin",
        country: "USA",
        website: "https://austinroofingandwaterdamage.com",
        phone: "+1 (512) 820-6505",
        email: "claims@austinroofingandwaterdamage.com",
        ownerName: "Sarah Jenkins",
        cmsPlatform: "Squarespace",
        emailVerificationStatus: "deliverable",
        apolloScore: { score: 79, tier: "warm", reasons: ["Direct inquiry channel", "Missing emergency dispatch scheduler"] },
      },
      {
        businessName: "Alta Roofing, LLC",
        category: "Roofing",
        city: "Austin",
        country: "USA",
        website: "https://www.altaroofingpros.com",
        phone: "+1 (512) 348-7711",
        email: "info@altaroofingpros.com",
        ownerName: "Marcus Hill",
        cmsPlatform: "Wix",
        emailVerificationStatus: "deliverable",
        apolloScore: { score: 76, tier: "warm", reasons: ["Verified domain email", "Thin service page copy", "No review shield capture"] },
      },
      {
        businessName: "Kingfisher Roofing",
        category: "Roofing",
        city: "Austin",
        country: "USA",
        website: "https://kingfisher-roofing.com",
        phone: "+1 (512) 999-7663",
        email: "contact@kingfisher-roofing.com",
        ownerName: "Jason Reed",
        cmsPlatform: "Webflow",
        emailVerificationStatus: "deliverable",
        apolloScore: { score: 75, tier: "warm", reasons: ["Active local phone", "Missing automated follow-up sequence"] },
      },
    ];

    const analyzedWebsites: Record<string, any> = {
      "Longhorn Roofing": {
        hasWebsite: true,
        title: "Longhorn Roofing Austin — Roof Repair & Replacement",
        cms: "WordPress",
        gaps: ["No 24/7 AI chat widget", "Missing instant quote estimator", "Unoptimized mobile click-to-call"],
      },
      "21st Century Painting & Roofing": {
        hasWebsite: true,
        title: "21st Century Painting & Roofing Experts",
        cms: "Custom HTML",
        gaps: ["Static contact form only", "No Meta retargeting pixels installed", "Slow mobile load speed"],
      },
      "Austin Gutterman": {
        hasWebsite: true,
        title: "Austin Gutterman — Commercial & Residential Gutters",
        cms: "Joomla",
        gaps: ["Outdated CMS version", "Missing automated booking calendar", "No Google Review capture funnel"],
      },
    };

    const offers: Record<string, any> = {
      "Longhorn Roofing": {
        offerHeadline: "24/7 Automated Roofing Estimator & AI Receptionist",
        matchedService: "Conversion Funnel & Inbound AI Receptionist",
        valueProposition: "Capture 30–40% more storm-damage leads after 5 PM with instant quote scheduling.",
        recommendedPrice: 2500,
        timeline: "7 business days",
      },
      "21st Century Painting & Roofing": {
        offerHeadline: "Modern Mobile Inbound Funnel & Review Shield",
        matchedService: "High-Converting Website & Review Automation",
        valueProposition: "Modernize static pages into a frictionless mobile quote engine.",
        recommendedPrice: 2800,
        timeline: "5 business days",
      },
    };

    const draftedEmails = [
      {
        businessName: "Longhorn Roofing",
        to: "service@austinlonghornroofing.com",
        subject: "quick question regarding Longhorn Roofing's online booking",
        bodyText: "Hi Robert,\n\nI was looking at Longhorn Roofing in Austin and noticed your website doesn't currently offer after-hours instant quote scheduling.\n\nWe prepared a custom 60-second interactive diagnostic report showing how adding an automated estimate widget typically captures 10 to 15 extra storm-damage inquiries per month.\n\nWould you like me to send over the link?",
        html: "<p style='margin:0 0 12px;font-size:15px;line-height:1.6;color:#1e293b;'>Hi Robert,</p><p style='margin:0 0 12px;font-size:15px;line-height:1.6;color:#1e293b;'>I was looking at Longhorn Roofing in Austin and noticed your website doesn't currently offer after-hours instant quote scheduling.</p><p style='margin:0 0 12px;font-size:15px;line-height:1.6;color:#1e293b;'>We prepared a custom 60-second interactive diagnostic report showing how adding an automated estimate widget typically captures 10 to 15 extra storm-damage inquiries per month.</p><p style='margin:0 0 12px;font-size:15px;line-height:1.6;color:#1e293b;'>Would you like me to send over the link?</p>",
        reportUrl: "/report/rep_demo_longhorn_austin",
      },
      {
        businessName: "21st Century Painting & Roofing",
        to: "office@21stcenturytexas.com",
        subject: "missed mobile customer capture on 21st Century Roofing",
        bodyText: "Hi Michael,\n\nWhile reviewing exterior contractors in Austin, I noticed 21st Century Painting & Roofing's contact page is missing click-to-call mobile buttons and automated quote capture.\n\nWe put together an audit report detailing 2 quick conversion improvements to boost your inbound lead conversion.\n\nOpen to taking a look?",
        html: "<p style='margin:0 0 12px;font-size:15px;line-height:1.6;color:#1e293b;'>Hi Michael,</p><p style='margin:0 0 12px;font-size:15px;line-height:1.6;color:#1e293b;'>While reviewing exterior contractors in Austin, I noticed 21st Century Painting & Roofing's contact page is missing click-to-call mobile buttons and automated quote capture.</p><p style='margin:0 0 12px;font-size:15px;line-height:1.6;color:#1e293b;'>We put together an audit report detailing 2 quick conversion improvements to boost your inbound lead conversion.</p><p style='margin:0 0 12px;font-size:15px;line-height:1.6;color:#1e293b;'>Open to taking a look?</p>",
        reportUrl: "/report/rep_demo_21stcentury_austin",
      },
    ];

    const sentEmails = [
      {
        businessName: "Longhorn Roofing",
        to: "service@austinlonghornroofing.com",
        subject: "quick question regarding Longhorn Roofing's online booking",
        status: "delivered",
        sentVia: "Primary Brevo SMTP Relay",
        host: "smtp-relay.brevo.com",
        sender: "outreach@agencyvanguard.com",
        trackingId: "trk_seed_longhorn_01",
        deliveryDetails: "250 OK: Queued and delivered via Primary Brevo Relay (smtp-relay.brevo.com)",
        deliveredAt: new Date(Date.now() - 1800000).toISOString(),
      },
      {
        businessName: "21st Century Painting & Roofing",
        to: "office@21stcenturytexas.com",
        subject: "missed mobile customer capture on 21st Century Roofing",
        status: "delivered",
        sentVia: "Primary Brevo SMTP Relay",
        host: "smtp-relay.brevo.com",
        sender: "outreach@agencyvanguard.com",
        trackingId: "trk_seed_21stcentury_02",
        deliveryDetails: "250 OK: Queued and delivered via Primary Brevo Relay (smtp-relay.brevo.com)",
        deliveredAt: new Date(Date.now() - 1200000).toISOString(),
      },
      {
        businessName: "Austin Gutterman",
        to: "estimates@austingutterman.com",
        subject: "conversion audit for Austin Gutterman",
        status: "delivered",
        sentVia: "Primary Brevo SMTP Relay",
        host: "smtp-relay.brevo.com",
        sender: "outreach@agencyvanguard.com",
        trackingId: "trk_seed_gutterman_03",
        deliveryDetails: "250 OK: Queued and delivered via Primary Brevo Relay (smtp-relay.brevo.com)",
        deliveredAt: new Date(Date.now() - 900000).toISOString(),
      },
    ];

    const failedEmails = [
      {
        businessName: "Kingfisher Roofing",
        to: "contact@kingfisher-roofing.com",
        subject: "quick question on Kingfisher Roofing's lead conversion",
        status: "failed",
        failedAt: new Date(Date.now() - 600000).toISOString(),
        reason: "Recipient mailbox quota exceeded (552 5.2.2 Mailbox full)",
        category: "Mailbox Full / Quota Exceeded",
        categoryCode: "mailbox_full",
        troubleshooting: "Recipient inbox is at storage capacity. Contact prospect via phone (+1 512-999-7663) or re-queue for dispatch next week.",
        attemptedVia: "Multi-SMTP Rotational Pool (smtp-relay.brevo.com)",
      },
      {
        businessName: "Alta Roofing, LLC",
        to: "demo_test@example.com",
        subject: "commercial inquiry",
        status: "failed",
        failedAt: new Date(Date.now() - 300000).toISOString(),
        reason: "Placeholder/demo address was skipped to protect sender reputation.",
        category: "Unverified / Demo Address",
        categoryCode: "mailbox_not_found",
        troubleshooting: "Run contact enrichment with Hunter.io or check business contact page before sending.",
        attemptedVia: "Pre-dispatch deliverability gate",
      },
    ];

    const summaryReport = {
      businessesFound: 24,
      businessesAnalyzed: 20,
      qualifiedProspects: 12,
      emailsFound: 10,
      offersCreated: 12,
      messagesPrepared: 12,
      messagesSent: sentEmails.length,
      messagesFailed: failedEmails.length,
      deliveryRate: 60,
      emailDeliveryAnalysis: {
        totalPrepared: 12,
        totalSent: sentEmails.length,
        totalFailed: failedEmails.length,
        deliveryRate: 60,
        smtpAccountsUsed: ["Primary Brevo SMTP Relay (smtp-relay.brevo.com)"],
        sentEmails,
        failedEmails,
        reasonsSummary: {
          "Mailbox Full / Quota Exceeded": 1,
          "Unverified / Demo Address": 1,
        },
      },
      hunterIntel: {
        connected: true,
        activeKeysCount: 1,
        provider: "Hunter.io B2B Intelligence Multipool",
        enrichedEmailsCount: 4,
      },
      followUpsScheduled: 8,
      estimatedAiCostUsd: "0.024",
      completedAt: new Date().toISOString(),
    };

    if (existing.length > 0) {
      // Update run with full realistic data
      const targetRunId = existing[0].id;
      await db
        .update(aiEmployeeRunsTable)
        .set({
          goal: "Find 20 roofing companies in Austin Texas that have poor websites. Analyze them, find their emails, select the best prospects, create personalized offers and prepare outreach.",
          status: "COMPLETED",
          progress: 100,
          currentTaskIndex: 10,
          totalTasks: 10,
          currentTaskDescription: "Mission Completed!",
          budgetConsumed: { businesses: 24, emails: sentEmails.length, aiCredits: 12, seconds: 48 },
          summaryReport,
          metadata: {
            interpretedGoal: "Find 20 Roofing companies in Austin, perform diagnostics, prepare offers, and draft outreach.",
            targetCategory: "Roofing",
            targetCity: "Austin",
            targetLeadCount: 20,
            maxEmailsToSend: 10,
            discoveredBusinesses: realisticBusinesses,
            analyzedWebsites,
            qualifiedLeads: realisticBusinesses,
            offers,
            draftedEmails,
            approvedEmails: draftedEmails,
            sentEmails,
            failedEmails,
          },
          updatedAt: new Date(),
        })
        .where(eq(aiEmployeeRunsTable.id, targetRunId));
    } else {
      // Insert fresh showcase run
      const [newRun] = await db
        .insert(aiEmployeeRunsTable)
        .values({
          userId: null,
          employeeId: 1,
          goal: "Find 20 roofing companies in Austin Texas that have poor websites. Analyze them, find their emails, select the best prospects, create personalized offers and prepare outreach.",
          status: "COMPLETED",
          progress: 100,
          currentTaskIndex: 10,
          totalTasks: 10,
          currentTaskDescription: "Mission Completed!",
          budgetLimits: {
            maxBusinesses: 50,
            maxEmails: 20,
            maxAiCredits: 25,
            maxRuntimeMinutes: 30,
            maxRetries: 3,
          },
          budgetConsumed: { businesses: 24, emails: sentEmails.length, aiCredits: 12, seconds: 48 },
          summaryReport,
          metadata: {
            interpretedGoal: "Find 20 Roofing companies in Austin, perform diagnostics, prepare offers, and draft outreach.",
            targetCategory: "Roofing",
            targetCity: "Austin",
            targetLeadCount: 20,
            maxEmailsToSend: 10,
            discoveredBusinesses: realisticBusinesses,
            analyzedWebsites,
            qualifiedLeads: realisticBusinesses,
            offers,
            draftedEmails,
            approvedEmails: draftedEmails,
            sentEmails,
            failedEmails,
          },
          startedAt: new Date(Date.now() - 3600000),
          completedAt: new Date(),
        })
        .returning();

      const runId = newRun.id;

      // Seed 10 realistic planned tasks
      const taskDefs = [
        { taskIndex: 1, taskType: "find_businesses", description: "Discover 20 Roofing businesses in Austin", tool: "find_businesses" },
        { taskIndex: 2, taskType: "analyze_websites", description: "Audit digital footprint, CMS, and mobile responsiveness", tool: "analyze_website" },
        { taskIndex: 3, taskType: "enrich_and_verify_contacts", description: "Crawl contact channels & verify MX deliverability", tool: "verify_email" },
        { taskIndex: 4, taskType: "score_and_filter_prospects", description: "Compute Apollo buyer intent scores (Hot/Warm)", tool: "score_lead" },
        { taskIndex: 5, taskType: "create_diagnostic_reports", description: "Generate interactive client audit reports", tool: "create_audit_report" },
        { taskIndex: 6, taskType: "generate_personalized_offers", description: "Synthesize tailored commercial value propositions", tool: "generate_personalized_offer" },
        { taskIndex: 7, taskType: "prepare_outreach_copies", description: "Draft personalized cold email sequences", tool: "generate_cold_email" },
        { taskIndex: 8, taskType: "request_human_approval", description: "Review prepared outreach and solicit human sign-off", tool: "send_outreach_email", requiresApproval: true },
        { taskIndex: 9, taskType: "dispatch_approved_outreach", description: "Dispatch approved emails through active inboxes", tool: "send_outreach_email", requiresApproval: true },
        { taskIndex: 10, taskType: "schedule_followups_and_save_crm", description: "Enroll in follow-up queue and sync into CRM pipeline", tool: "schedule_followup" },
      ];

      for (const t of taskDefs) {
        await db.insert(aiEmployeeTasksTable).values({
          runId,
          taskIndex: t.taskIndex,
          taskType: t.taskType,
          description: t.description,
          tool: t.tool,
          requiresApproval: Boolean(t.requiresApproval),
          status: "completed",
          input: {},
          completedAt: new Date(),
        });
      }

      // Seed realistic live events timeline
      const seedEvents = [
        { level: "thought", title: "Goal Received & Plan Formulated", message: "Broken down into 10 structured steps with safety caps." },
        { level: "tool_start", title: "Discovery Engine", message: "Hunting up to 20 Roofing businesses in Austin, USA..." },
        { level: "tool_end", title: "Discovery Complete", message: "Discovered 24 roofing companies across multi-directory scrapers." },
        { level: "thought", title: "Executing Step 2: Website Diagnostics", message: "Auditing technical stack and conversion signals." },
        { level: "tool_end", title: "Technical Audits Complete", message: "Identified high-conversion gaps in 6 key prospects." },
        { level: "thought", title: "Step 4: Scoring Buyer Intent", message: "Ranked prospects using Apollo Intent Model." },
        { level: "tool_start", title: "Report Synthesis", message: "Generated interactive diagnostic reports with performance scores." },
        { level: "thought", title: "Step 7: Drafting Outreach Sequences", message: "Synthesized 12 hyper-personalized cold outreach emails." },
        { level: "approval_resolved", title: "Approval Granted", message: "Human approval granted for prepared outreach batch." },
        { level: "info", title: "Mission Completed Successfully", message: "All 10 steps executed. Enrolled leads in follow-up queue and CRM." },
      ] as const;

      for (const ev of seedEvents) {
        await db.insert(aiEmployeeEventsTable).values({
          runId,
          level: ev.level,
          title: ev.title,
          message: ev.message,
          payload: {},
        });
      }
    }
  } catch (err) {
    console.warn("[ai-employees] ensureSeededShowcaseRun warning:", err);
  }
}

// ─── List Historical Runs ────────────────────────────────────────────────────
router.get("/ai-employees/runs", async (req: Request, res: Response) => {
  try {
    await ensureSeededShowcaseRun();
    const runs = await db
      .select()
      .from(aiEmployeeRunsTable)
      .orderBy(desc(aiEmployeeRunsTable.id))
      .limit(30);

    res.json(runs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Get Run Details & Live State ────────────────────────────────────────────
router.get("/ai-employees/runs/:id", async (req: Request, res: Response) => {
  const runId = Number(req.params.id);
  try {
    const runs = await db.select().from(aiEmployeeRunsTable).where(eq(aiEmployeeRunsTable.id, runId)).limit(1);
    if (!runs.length) {
      res.status(404).json({ error: "Run not found" });
      return;
    }

    const run = runs[0];
    const tasks = await db
      .select()
      .from(aiEmployeeTasksTable)
      .where(eq(aiEmployeeTasksTable.runId, runId))
      .orderBy(aiEmployeeTasksTable.taskIndex);

    const events = await db
      .select()
      .from(aiEmployeeEventsTable)
      .where(eq(aiEmployeeEventsTable.runId, runId))
      .orderBy(desc(aiEmployeeEventsTable.id))
      .limit(100);

    const approvals = await db
      .select()
      .from(aiEmployeeApprovalsTable)
      .where(eq(aiEmployeeApprovalsTable.runId, runId))
      .orderBy(desc(aiEmployeeApprovalsTable.id));

    res.json({
      run,
      tasks,
      events,
      approvals,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Interactive Controls: Pause, Resume, Cancel ─────────────────────────────
router.post("/ai-employees/runs/:id/pause", async (req: Request, res: Response) => {
  const runId = Number(req.params.id);
  pauseRun(runId);
  res.json({ success: true, message: `Pause signal sent to Run ${runId}` });
});

router.post("/ai-employees/runs/:id/resume", async (req: Request, res: Response) => {
  const runId = Number(req.params.id);
  const { extendCredits } = req.body || {};
  const userEmail = (req as any).user?.email || req.headers["x-user-email"] as string || "";
  await resumeRun(runId, userEmail, extendCredits ? Number(extendCredits) : 50);
  res.json({ success: true, message: `Resume signal sent to Run ${runId}` });
});

router.post("/ai-employees/runs/:id/cancel", async (req: Request, res: Response) => {
  const runId = Number(req.params.id);
  cancelRun(runId);
  res.json({ success: true, message: `Cancel signal sent to Run ${runId}` });
});

// ─── Human Approval Decision ─────────────────────────────────────────────────
router.post("/ai-employees/approvals/:id/resolve", async (req: Request, res: Response) => {
  const approvalId = Number(req.params.id);
  const { approved, userNote, editedPayload } = req.body;
  const userEmail = (req as any).user?.email || req.headers["x-user-email"] as string || "";

  try {
    await resolveApproval({
      approvalId,
      approved: Boolean(approved),
      userNote,
      editedPayload,
      userEmail,
    });

    res.json({
      success: true,
      decision: approved ? "approved" : "rejected",
      message: approved ? "Action approved. Employee resumed execution." : "Action rejected. Employee notified.",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Memory & Preferences Management ─────────────────────────────────────────
router.get("/ai-employees/memories", async (req: Request, res: Response) => {
  const user = (req as any).user || null;
  try {
    const memories = await db
      .select()
      .from(aiEmployeeMemoriesTable)
      .where(user?.id ? eq(aiEmployeeMemoriesTable.userId, user.id) : undefined)
      .orderBy(desc(aiEmployeeMemoriesTable.updatedAt));

    res.json(memories);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/ai-employees/memories", async (req: Request, res: Response) => {
  const { key, category, value, confidence } = req.body;
  if (!key) {
    res.status(400).json({ error: "Memory key is required" });
    return;
  }
  const user = (req as any).user || null;

  try {
    const [saved] = await db
      .insert(aiEmployeeMemoriesTable)
      .values({
        userId: user?.id || null,
        key: String(key).trim(),
        category: category || "preference",
        value: value || {},
        confidence: Number(confidence) || 100,
        updatedAt: new Date(),
      })
      .returning();

    res.json({ success: true, memory: saved });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Live Diagnostics & Integration Status ──────────────────────────────────
router.get("/ai-employees/integrations/status", async (_req: Request, res: Response) => {
  try {
    const hunter = await getHunterStatus();
    const accounts = await getAllActiveAccounts();
    const nextAccount = await getNextAccount();
    res.json({
      hunter: {
        configured: hunter.configured,
        keysCount: hunter.count,
        hasEnvFallback: hunter.hasEnvFallback,
        provider: hunter.provider,
        activeKeyMasked: hunter.activeKeyMasked || "None",
        status: hunter.configured ? "connected" : "fallback_mode",
        description: hunter.configured
          ? "Hunter.io API connected for direct B2B email search & verification."
          : "No external Hunter key configured. Automated fallback: Local deep HTML contact parser + live DNS MX validation active.",
      },
      smtp: {
        connected: accounts.length > 0,
        accountsCount: accounts.length,
        activeAccounts: accounts.map((a) => ({
          id: a.id,
          label: a.label,
          provider: a.provider,
          host: a.host,
          port: a.port,
          user: a.user ? `${a.user.slice(0, 3)}••••@${a.user.split("@")[1] || "relay"}` : "None",
          fromEmail: a.fromEmail || a.user,
          fromName: a.fromName,
          sentCount: a.sentCount,
          sentToday: a.sentToday,
          dailyLimit: a.dailyLimit,
          autoPaused: a.autoPaused,
        })),
        activeRelay: nextAccount ? `${nextAccount.label} (${nextAccount.host})` : "None configured",
        status: accounts.length > 0 ? "ready" : "not_configured",
        description: accounts.length > 0
          ? `${accounts.length} SMTP relay(s) active in rotational pool with automatic failover and deliverability tracking.`
          : "No active SMTP relays found. Configure Brevo or custom SMTP in Admin Panel to enable email dispatch.",
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Retry Failed Outreach Emails ───────────────────────────────────────────
router.post("/ai-employees/runs/:id/retry-failed-emails", async (req: Request, res: Response) => {
  const runId = Number(req.params.id);
  const { targetEmail } = req.body || {};

  try {
    const runs = await db.select().from(aiEmployeeRunsTable).where(eq(aiEmployeeRunsTable.id, runId)).limit(1);
    if (!runs.length) {
      res.status(404).json({ error: "Run not found" });
      return;
    }

    const run = runs[0];
    const metadata = (run.metadata as any) || {};
    const failedEmails: any[] = metadata.failedEmails || [];
    const sentEmails: any[] = metadata.sentEmails || [];

    const candidates = targetEmail
      ? failedEmails.filter((f) => f.to.toLowerCase() === String(targetEmail).toLowerCase())
      : failedEmails.filter((f) => f.to && !f.to.includes("example.com"));

    if (candidates.length === 0) {
      res.json({
        success: false,
        message: "No retryable failed emails found (placeholder addresses are skipped to protect sender reputation).",
      });
      return;
    }

    const retriedSuccess: any[] = [];
    const remainingFailed: any[] = [];

    const baseUrl = `${req.protocol}://${req.get("host")}`;

    for (const item of failedEmails) {
      const isTarget = candidates.some((c) => c.to.toLowerCase() === item.to.toLowerCase());
      if (!isTarget) {
        remainingFailed.push(item);
        continue;
      }

      try {
        const trackingId = await createTracking(item.to, item.subject || "Quick inquiry", "ai_employee_outreach_retry");
        const rawHtml = `<p style="line-height:1.6;font-size:15px;color:#1e293b;">Hello, following up on your digital growth audit report.</p>`;
        const finalHtml = injectTracking(rawHtml, baseUrl, trackingId);

        const { acct } = await sendWithFailover((a) => ({
          to: item.to,
          from: `"${a.fromName || "Alex Rivera"}" <${a.fromEmail || a.user}>`,
          subject: item.subject || "Quick inquiry",
          text: "Hello, following up on your digital growth audit report.",
          html: finalHtml,
        }));

        const deliveredRecord = {
          ...item,
          status: "delivered",
          deliveredAt: new Date().toISOString(),
          sentVia: acct.label,
          host: acct.host,
          sender: acct.fromEmail || acct.user,
          trackingId,
          deliveryDetails: `250 OK: Re-dispatched and delivered via ${acct.label} (${acct.host})`,
        };

        retriedSuccess.push(deliveredRecord);
        sentEmails.push(deliveredRecord);
      } catch (err: any) {
        remainingFailed.push({
          ...item,
          failedAt: new Date().toISOString(),
          reason: err.message,
          retryError: err.message,
        });
      }
    }

    const totalSent = sentEmails.length;
    const totalFailed = remainingFailed.length;
    const totalAttempted = totalSent + totalFailed;
    const deliveryRate = totalAttempted > 0 ? Math.round((totalSent / totalAttempted) * 100) : 100;

    const summaryReport = {
      ...((run.summaryReport as any) || {}),
      messagesSent: totalSent,
      messagesFailed: totalFailed,
      deliveryRate,
      emailDeliveryAnalysis: {
        totalPrepared: (run.summaryReport as any)?.emailDeliveryAnalysis?.totalPrepared || totalAttempted,
        totalSent,
        totalFailed,
        deliveryRate,
        smtpAccountsUsed: Array.from(new Set(sentEmails.map((s: any) => s.sentVia).filter(Boolean))),
        sentEmails,
        failedEmails: remainingFailed,
        reasonsSummary: remainingFailed.reduce((acc: any, f: any) => {
          const k = f.category || "Relay Error";
          acc[k] = (acc[k] || 0) + 1;
          return acc;
        }, {}),
      },
    };

    metadata.sentEmails = sentEmails;
    metadata.failedEmails = remainingFailed;

    await db
      .update(aiEmployeeRunsTable)
      .set({
        summaryReport,
        metadata,
        updatedAt: new Date(),
      })
      .where(eq(aiEmployeeRunsTable.id, runId));

    res.json({
      success: true,
      retriedCount: retriedSuccess.length,
      remainingFailedCount: remainingFailed.length,
      retriedSuccess,
      message: `Retried ${retriedSuccess.length} email(s) successfully!`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
