/**
 * planner.ts
 *
 * AI Planner for the AI Sales Employee.
 * Converts natural-language user goals into structured, ordered task execution plans.
 */

import { getGeminiAI } from "../../routes/api-keys";

export interface PlannedTask {
  taskIndex: number;
  taskType: string;
  description: string;
  tool: string;
  requiresApproval: boolean;
  input: Record<string, any>;
}

export interface StructuredPlan {
  interpretedGoal: string;
  targetCategory: string;
  targetCity: string;
  targetCountry: string;
  targetLeadCount: number;
  maxEmailsToSend: number;
  tasks: PlannedTask[];
  suggestedLimits: {
    maxBusinesses: number;
    maxEmails: number;
    maxAiCredits: number;
    maxRuntimeMinutes: number;
    maxRetries: number;
  };
}

export async function createExecutionPlan(
  userGoal: string,
  userMemory?: Record<string, any>
): Promise<StructuredPlan> {
  const lowerGoal = userGoal.toLowerCase();

  // Detect if user goal explicitly or implicitly requests website generation or review links
  const wantsWebsite =
    lowerGoal.includes("website") ||
    lowerGoal.includes("site") ||
    lowerGoal.includes("preview") ||
    lowerGoal.includes("prototype") ||
    lowerGoal.includes("build web") ||
    lowerGoal.includes("generate web") ||
    lowerGoal.includes("free site") ||
    lowerGoal.includes("redesign") ||
    lowerGoal.includes("funnel") ||
    lowerGoal.includes("landing");

  const wantsReview =
    lowerGoal.includes("review") ||
    lowerGoal.includes("shield") ||
    lowerGoal.includes("reputation") ||
    lowerGoal.includes("rating") ||
    lowerGoal.includes("5-star") ||
    lowerGoal.includes("5 star");

  // 1. Instant semantic parser (<1ms execution)
  // Check for explicit numeric business count requests (e.g. "give me 10 businesses", "10 exact businesses", "find 5 companies")
  let targetLeadCount = 10;
  const countRegexes = [
    /(?:give\s+me|find|generate|hunt|discover|search|audit|get|locate|provide|scrape|fetch)\s+(\d+)\b/i,
    /(\d+)\s*(?:exact\s+)?(?:businesses|companies|leads|prospects|contractors|clinics|agencies|roofers|plumbers|services|shops|stores|firms|places|clients|roofing)/i,
    /\b(\d+)\s*(?:in|for|near|around)\s+[a-zA-Z]/i,
    /\b(\d+)\b/,
  ];
  for (const rx of countRegexes) {
    const m = userGoal.match(rx);
    if (m && m[1]) {
      const parsed = parseInt(m[1], 10);
      if (!isNaN(parsed) && parsed > 0 && parsed <= 500) {
        targetLeadCount = parsed;
        break;
      }
    }
  }

  const KNOWN_CATEGORIES = [
    "Roofing", "Plumbing", "HVAC", "Electrician", "Dental", "Dentist", "Restaurant", 
    "Real Estate", "Lawyer", "Attorney", "Contractor", "Construction", "Landscaping", 
    "Cleaning", "Accounting", "Marketing", "Gym", "Fitness", "Automotive", "Medical",
    "Home Services", "Medspa", "Solar", "Painting"
  ];
  let targetCategory = "";
  for (const kc of KNOWN_CATEGORIES) {
    if (new RegExp(`\\b${kc}\\b`, "i").test(userGoal)) {
      targetCategory = kc;
      break;
    }
  }
  if (!targetCategory) {
    const catMatch = userGoal.match(/(?:find|discover|search|audit)\s+(?:\d+\s+)?([a-zA-Z\s]{3,25}?)(?:\s+(?:companies|contractors|businesses|services|clinics|in\b)|$)/i);
    targetCategory = catMatch ? catMatch[1].trim() : "Roofing";
  }

  const cityMatch = userGoal.match(/\bin\s+([a-zA-Z\s]{2,25}?)(?:\s+(?:with|that|having|who|where|near|area|usa|texas|tx|ca|fl|\.|\,|$))/i) ||
                    userGoal.match(/\b(?:around|near)\s+([a-zA-Z\s]{2,25}?)(?:\s+(?:with|that|having|\.|\,|$))/i);
  let targetCity = cityMatch ? cityMatch[1].trim() : "Austin";
  if (/^(poor|bad|slow|missing|no|with|that)\b/i.test(targetCity)) {
    targetCity = "Austin";
  }

  // Construct canonical pipeline tasks
  const tasks: PlannedTask[] = [
    {
      taskIndex: 1,
      taskType: "find_businesses",
      description: `Find ${targetLeadCount} ${targetCategory} businesses in ${targetCity}`,
      tool: "find_businesses",
      requiresApproval: false,
      input: { category: targetCategory, city: targetCity, limit: targetLeadCount },
    },
    {
      taskIndex: 2,
      taskType: "analyze_websites",
      description: "Analyze business websites and detect conversion gaps",
      tool: "analyze_website",
      requiresApproval: false,
      input: {},
    },
    {
      taskIndex: 3,
      taskType: "enrich_and_verify_contacts",
      description: "Find direct owner emails and verify deliverability",
      tool: "find_business_email",
      requiresApproval: false,
      input: {},
    },
    {
      taskIndex: 4,
      taskType: "score_and_filter_prospects",
      description: "Calculate Apollo intent score and filter top opportunities",
      tool: "score_lead",
      requiresApproval: false,
      input: {},
    },
    {
      taskIndex: 5,
      taskType: "create_diagnostic_reports",
      description: "Generate interactive website audit reports",
      tool: "create_audit_report",
      requiresApproval: false,
      input: {},
    },
    {
      taskIndex: 6,
      taskType: "generate_personalized_offers",
      description: "Synthesize tailored commercial offers and pricing",
      tool: "generate_personalized_offer",
      requiresApproval: false,
      input: {},
    },
  ];

  // If user requested website generation, review links, or free website outreach, include generate_mock_websites task
  if (wantsWebsite || wantsReview) {
    tasks.push({
      taskIndex: tasks.length + 1,
      taskType: "generate_mock_websites",
      description: "Build conversion-ready preview websites (/site) and 5-Star Review Shields (/review) for qualified prospects",
      tool: "generate_mock_website",
      requiresApproval: false,
      input: { category: targetCategory, city: targetCity },
    });
  }

  tasks.push(
    {
      taskIndex: tasks.length + 1,
      taskType: "prepare_outreach_copies",
      description: wantsWebsite
        ? "Draft personalized cold emails embedding live website preview links and waived $1,500 build fee"
        : wantsReview
        ? "Draft personalized cold emails embedding 5-Star Review Shield links and reputation defense"
        : "Draft personalized cold email sequences for qualified leads",
      tool: "generate_cold_email",
      requiresApproval: false,
      input: {},
    },
    {
      taskIndex: tasks.length + 1,
      taskType: "request_human_approval",
      description: "Review generated emails and solicit human approval before sending",
      tool: "send_outreach_email",
      requiresApproval: true,
      input: {},
    },
    {
      taskIndex: tasks.length + 1,
      taskType: "dispatch_approved_outreach",
      description: "Send approved emails through configured email accounts",
      tool: "send_outreach_email",
      requiresApproval: true,
      input: {},
    },
    {
      taskIndex: tasks.length + 1,
      taskType: "schedule_followups_and_save_crm",
      description: "Enroll in 4-day follow-up queue and sync into CRM",
      tool: "schedule_followup",
      requiresApproval: false,
      input: {},
    }
  );

  // Renumber taskIndex strictly 1..N
  tasks.forEach((t, i) => {
    t.taskIndex = i + 1;
  });

  const interpretedGoal = wantsWebsite
    ? `Find ${targetLeadCount} ${targetCategory} companies in ${targetCity}, run diagnostics, synthesize free live conversion websites with 5-Star Review Shields, and prepare cold email outreach embedding the live preview links.`
    : wantsReview
    ? `Find ${targetLeadCount} ${targetCategory} companies in ${targetCity}, diagnose reputation gaps, activate 5-Star Review Shields, and prepare outreach emails embedding the review link.`
    : `Find ${targetLeadCount} ${targetCategory} companies in ${targetCity}, perform diagnostics, prepare offers, and draft outreach.`;

  const basePlan: StructuredPlan = {
    interpretedGoal,
    targetCategory,
    targetCity,
    targetCountry: "USA",
    targetLeadCount,
    maxEmailsToSend: Math.min(Math.round(targetLeadCount * 0.5), 20),
    tasks,
    suggestedLimits: {
      maxBusinesses: targetLeadCount,
      maxEmails: Math.min(targetLeadCount, 20),
      maxAiCredits: Math.max(targetLeadCount * 3, 20),
      maxRuntimeMinutes: 30,
      maxRetries: 2,
    },
  };

  // 2. Fast AI refinement attempt with deep marketing pipeline training (capped at 1.5s max to guarantee zero hanging)
  try {
    const ai = await getGeminiAI().catch(() => null);
    if (ai) {
      const prompt = `You are the Operations Director of an autonomous AI sales fleet.
Our app capabilities include:
- Finding local businesses across multi-directory scrapers (find_businesses)
- Deep website diagnostics and technology scans (analyze_websites)
- Verified decision-maker email discovery (enrich_and_verify_contacts)
- Apollo intent scoring (score_and_filter_prospects)
- Generating interactive audit reports at /report/:id (create_diagnostic_reports)
- Formulating commercial proposals (generate_personalized_offers)
- Building live 4-tap conversion websites at /site/:id with 24/7 AI Receptionist and 5-Star Google Review Shields at /review/:id (generate_mock_websites)
- Drafting cold outreach with embedded preview links and waived $1,500 build fee ($0 setup cost) (prepare_outreach_copies)
- Human approval gates & SMTP dispatch
- 4-Day follow-up queue & CRM sync

Deconstruct this sales goal into structured parameters: "${userGoal}".
Return JSON with keys:
- interpretedGoal (string)
- targetCategory (string)
- targetCity (string)
- targetCountry (string)
- targetLeadCount (number)
- wantsWebsiteGeneration (boolean)
- wantsReviewShield (boolean)`;

      const aiPromise = ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { responseMimeType: "application/json" },
      });
      const response = await Promise.race([
        aiPromise,
        new Promise<any>((_, reject) => setTimeout(() => reject(new Error("Fast timeout")), 1500)),
      ]);
      const parsed = JSON.parse(response.text || "{}");
      if (parsed.targetLeadCount && Number(parsed.targetLeadCount) > 0) {
        basePlan.targetLeadCount = Number(parsed.targetLeadCount);
      } else {
        basePlan.targetLeadCount = targetLeadCount;
      }
      basePlan.suggestedLimits.maxBusinesses = basePlan.targetLeadCount;
      const findTask = basePlan.tasks.find((t) => t.taskType === "find_businesses");
      if (findTask) {
        findTask.input.limit = basePlan.targetLeadCount;
        findTask.description = `Find ${basePlan.targetLeadCount} ${basePlan.targetCategory} businesses in ${basePlan.targetCity}`;
      }
      if (parsed.interpretedGoal) basePlan.interpretedGoal = parsed.interpretedGoal;

      // If AI detected website generation was desired and wasn't already added
      const aiWantsWebsite = Boolean(parsed.wantsWebsiteGeneration);
      const hasWebsiteTask = basePlan.tasks.some((t) => t.taskType === "generate_mock_websites");
      if (aiWantsWebsite && !hasWebsiteTask) {
        const insertIdx = basePlan.tasks.findIndex((t) => t.taskType === "prepare_outreach_copies");
        const newWebsiteTask: PlannedTask = {
          taskIndex: 7,
          taskType: "generate_mock_websites",
          description: "Build conversion-ready preview websites (/site) and 5-Star Review Shields (/review) for qualified prospects",
          tool: "generate_mock_website",
          requiresApproval: false,
          input: { category: basePlan.targetCategory, city: basePlan.targetCity },
        };
        if (insertIdx !== -1) {
          basePlan.tasks.splice(insertIdx, 0, newWebsiteTask);
        } else {
          basePlan.tasks.push(newWebsiteTask);
        }
        basePlan.tasks.forEach((t, i) => {
          t.taskIndex = i + 1;
        });
      }

      basePlan.tasks[0].input = {
        category: basePlan.targetCategory,
        city: basePlan.targetCity,
        limit: basePlan.targetLeadCount,
      };
      basePlan.tasks[0].description = `Find ${basePlan.targetLeadCount} ${basePlan.targetCategory} businesses in ${basePlan.targetCity}`;
    }
  } catch {
    // Immediate return of basePlan guarantees smooth, zero-wait start
  }

  return basePlan;
}
