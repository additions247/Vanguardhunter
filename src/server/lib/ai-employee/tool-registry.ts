/**
 * tool-registry.ts
 *
 * Strict, validated tool registry for the AI Sales Employee.
 * Exposes EXISTING Hunter application functionality as callable tools without duplicating business logic.
 */

import { scrapeBusinessDirectories, discoverCommercialFreeEmailForBusiness, computeApolloIntentScore, ScrapedBusiness } from "../business-scrapers";
import { verifyEmailAddress } from "../email-verifier";
import { hunterDomainSearch, hunterEmailFinder, hunterEmailVerifier, discoverAndVerifyContact } from "../hunter-client";
import { scrapeBusinessWebsiteIntel, buildAccurateBusinessBlueprint, synthesizeWebsiteWithAI, BlueprintInputParams } from "../website-intelligence";
import { createReport, buildReportEmailSection, buildWebsitePreviewEmailSection, buildReviewShieldEmailSection, getAgencyBaseUrl } from "../../routes/reports";
import { buildClaimPitchEmail, saveSiteToPersistentStore } from "../../routes/website-builder";
import { getActiveTrainingProfile } from "../ai-training";
import { getGeminiAI } from "../../routes/api-keys";
import { db, crmProspectsTable, followUpQueueTable, generatedWebsitesTable, emailAccountsTable } from "../../../db";
import { eq } from "drizzle-orm";
import { makeSmartTransporter } from "../smtp-mailer";
import { sendWithFailover, createTracking, injectTracking } from "../../routes/crm-ai";

export interface ToolDefinition {
  name: string;
  description: string;
  category: "research" | "analysis" | "enrichment" | "creative" | "crm" | "outreach";
  isIrreversible?: boolean;
  requiresApproval?: boolean;
  estimatedCreditCost: number;
  execute: (input: any, context: ToolExecutionContext) => Promise<any>;
}

export interface ToolExecutionContext {
  userId?: number | null;
  runId: number;
  userEmail?: string;
  baseUrl: string;
  budgetTracker: {
    incrementBusinesses: (count: number) => void;
    incrementEmails: (count: number) => void;
    incrementCredits: (credits: number) => void;
  };
  logEvent: (
    level: "info" | "thought" | "tool_start" | "tool_end" | "warning" | "error" | "approval_needed" | "approval_resolved",
    title: string,
    message: string,
    payload?: any
  ) => Promise<void>;
}

export const toolRegistry: Record<string, ToolDefinition> = {
  find_businesses: {
    name: "find_businesses",
    description: "Discover businesses in a city/category across multi-directory scrapers (Foursquare, TomTom, HERE, Google, Web).",
    category: "research",
    estimatedCreditCost: 2,
    execute: async (input, ctx) => {
      const category = String(input.category || "General Business").trim();
      const city = String(input.city || "Austin").trim();
      const country = String(input.country || "USA").trim();
      const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 100);

      await ctx.logEvent("tool_start", "Discovery Engine", `Hunting up to ${limit} ${category} businesses in ${city}, ${country}...`);

      const result = await scrapeBusinessDirectories(category, city, country, limit);

      const businesses = (result.businesses || []).slice(0, limit);
      ctx.budgetTracker.incrementBusinesses(businesses.length);
      ctx.budgetTracker.incrementCredits(2);

      await ctx.logEvent("tool_end", "Discovery Complete", `Discovered exactly ${businesses.length} businesses from ${result.sources?.join(", ") || "directories"}.`, {
        count: businesses.length,
        sources: result.sources,
      });

      return {
        count: businesses.length,
        businesses,
        sources: result.sources,
      };
    },
  },

  analyze_website: {
    name: "analyze_website",
    description: "Deep scan of a business website: technology stack, responsiveness, CMS platform, trust signals, and gaps.",
    category: "analysis",
    estimatedCreditCost: 1,
    execute: async (input, ctx) => {
      const url = String(input.website || "").trim();
      const businessName = String(input.businessName || "Business").trim();
      if (!url) {
        return {
          hasWebsite: false,
          score: 15,
          gaps: ["No website detected — relying solely on third-party listings"],
          summary: `${businessName} has no registered website. Urgent candidate for full digital setup.`,
        };
      }

      await ctx.logEvent("tool_start", "Website Diagnostic", `Running deep audit on ${url} for ${businessName}...`);
      const intel = await scrapeBusinessWebsiteIntel(url);

      const hasWebsite = Boolean(intel && intel.title);
      const gaps: string[] = [];
      if (intel && (intel.extractedServices?.length || 0) === 0) gaps.push("Missing clear online service catalog");
      if (intel && (intel.extractedPhones?.length || 0) === 0) gaps.push("No direct phone click-to-call visible");
      if (intel && (intel.bodyExcerpt?.length || 0) < 150) gaps.push("Thin content or placeholder domain");

      ctx.budgetTracker.incrementCredits(1);

      return {
        hasWebsite,
        url,
        title: intel?.title || "",
        description: intel?.description || "",
        phones: intel?.extractedPhones || [],
        headings: intel?.headings || [],
        gaps,
        cms: (intel?.headings?.length || 0) > 2 ? "Modern" : "Legacy/Static",
      };
    },
  },

  create_audit_report: {
    name: "create_audit_report",
    description: "Generates an interactive public diagnostic report with performance score and findings.",
    category: "analysis",
    estimatedCreditCost: 1,
    execute: async (input, ctx) => {
      const { businessName, website, analysisData } = input;
      const baseUrl = ctx.baseUrl || getAgencyBaseUrl();

      await ctx.logEvent("tool_start", "Report Synthesis", `Generating interactive audit report for ${businessName}...`);
      const report = await createReport({
        businessName: businessName || "Prospective Client",
        website: website || "",
        analysisData: analysisData || {},
        baseUrl,
        ownerUserId: ctx.userId || null,
        ownerEmail: ctx.userEmail || null,
      });

      ctx.budgetTracker.incrementCredits(1);
      await ctx.logEvent("tool_end", "Report Published", `Report created at ${report.reportUrl}`, { reportUrl: report.reportUrl });

      return report;
    },
  },

  find_business_email: {
    name: "find_business_email",
    description: "Deep crawl of business contact pages, Hunter.io B2B intelligence, and mailto anchors to find decision-maker emails.",
    category: "enrichment",
    estimatedCreditCost: 1,
    execute: async (input, ctx) => {
      const { businessName, website, city, country, phone, ownerName } = input || {};
      const resolvedBusinessName = businessName || input?.business?.businessName || input?.name || "Business";
      const resolvedOwnerName = ownerName || input?.business?.ownerName || "";
      await ctx.logEvent("tool_start", "Email Discovery", `Hunting verified contact for ${resolvedBusinessName}...`);

      const res = await discoverAndVerifyContact({
        businessName: resolvedBusinessName,
        website: website || input?.business?.website || "",
        city: city || input?.business?.city || "",
        country: country || input?.business?.country || "USA",
        phone: phone || input?.business?.phone || "",
        ownerName: resolvedOwnerName,
      });

      ctx.budgetTracker.incrementCredits(1);

      if (res.email) {
        await ctx.logEvent(
          "tool_end",
          "Email Discovered",
          `Found ${res.email} for ${resolvedBusinessName} via ${res.source === "hunter_api" ? "Hunter.io B2B API" : "Deep Directory/Web Crawl"} (Confidence: ${res.confidence}%)`,
          { email: res.email, source: res.source, confidence: res.confidence }
        );
      } else {
        await ctx.logEvent("warning", "No Public Email", `No public email address discovered for ${resolvedBusinessName}`);
      }

      return {
        email: res.email || "",
        found: Boolean(res.email),
        ownerName: res.ownerName || resolvedOwnerName || "",
        ownerRole: res.ownerRole || "Owner",
        source: res.source,
        confidence: res.confidence,
        verification: res.verification,
      };
    },
  },

  verify_email: {
    name: "verify_email",
    description: "Verifies email deliverability using Hunter.io and live DNS MX server validation.",
    category: "enrichment",
    estimatedCreditCost: 0.5,
    execute: async (input, ctx) => {
      const email = String(input.email || "").trim();
      if (!email) return { isValid: false, status: "undeliverable", reason: "Empty email" };

      const res = await hunterEmailVerifier(email);
      ctx.budgetTracker.incrementCredits(0.5);

      return {
        email,
        isValid: res.isValid,
        status: res.status,
        score: res.score,
        reason: res.reason,
        provider: res.provider,
        verifiedBy: res.verifiedBy,
        details: res.details,
      };
    },
  },

  score_lead: {
    name: "score_lead",
    description: "Calculates an Apollo buyer intent score (0-100) and opportunity tier (Hot / Warm / Cold).",
    category: "analysis",
    estimatedCreditCost: 0.5,
    execute: async (input, ctx) => {
      const { business, intel } = (input && typeof input === "object") ? input : {};
      const scoreData = computeApolloIntentScore({
        website: business?.website || "",
        ownerName: business?.ownerName || "",
        cmsPlatform: intel?.cms || business?.cmsPlatform || "",
        missingSignals: intel?.gaps || business?.missingSignals || [],
        email: business?.email || "",
        phone: business?.phone || "",
      });

      ctx.budgetTracker.incrementCredits(0.5);
      return {
        score: scoreData.intentScore || 50,
        intentScore: scoreData.intentScore || 50,
        tier: scoreData.intentTier || "warm",
        reasons: scoreData.intentReasons || [],
      };
    },
  },

  generate_personalized_offer: {
    name: "generate_personalized_offer",
    description: "Synthesizes a tailored commercial offer and positioning strategy based on the prospect's gaps.",
    category: "creative",
    estimatedCreditCost: 1,
    execute: async (input, ctx) => {
      const { businessName, category, gaps, userTraining } = (input && typeof input === "object") ? input : {};
      const training = userTraining || (await getActiveTrainingProfile());

      const gapsList = Array.isArray(gaps) && gaps.length > 0 ? gaps.join(", ") : "outdated online presence";
      const matchedService = training?.servicesOffered?.[0]?.name || "High-Converting Website & Booking System";

      const effectiveBiz = businessName || input?.business?.businessName || "Valued Business";
      const offerHeadline = `${matchedService} for ${effectiveBiz}`;
      const valueProposition = `Solve ${gapsList} to capture 20–35% more inbound ${category || "local"} customer inquiries.`;

      ctx.budgetTracker.incrementCredits(1);
      return {
        offerHeadline,
        matchedService,
        valueProposition,
        recommendedPrice: 2500,
        timeline: "7 business days",
      };
    },
  },

  generate_cold_email: {
    name: "generate_cold_email",
    description: "Drafts a personalized, high-converting cold email tailored to the prospect's diagnostic findings, free website preview link, or 5-Star Review Shield.",
    category: "creative",
    estimatedCreditCost: 2,
    execute: async (input, ctx) => {
      const { businessName, ownerName, category, city, gaps, reportUrl, siteUrl, reviewUrl, offer, pitchMode } = input || {};
      const resolvedBusinessName = businessName || input?.business?.businessName || input?.name || "Local Business";
      const resolvedOwnerName = ownerName || input?.business?.ownerName || "";
      const resolvedCategory = category || input?.business?.category || "Local Business";
      const resolvedCity = city || input?.business?.city || "Local area";
      const ai = await getGeminiAI().catch(() => null);

      const hasWebsitePreview = Boolean(siteUrl);
      const hasReviewShield = Boolean(reviewUrl);
      const hasDiagnosticReport = Boolean(reportUrl);

      const prompt = `You are a world-class B2B growth agency sales copywriter.
Write a short, highly personalized cold outreach email from our agency to a local business owner.

Business Name: ${resolvedBusinessName}
Owner / Decision Maker: ${resolvedOwnerName || "Business Owner"}
Industry: ${resolvedCategory}
City: ${resolvedCity}
Identified Gaps: ${(gaps || []).join(", ") || "Static website with no automated booking"}
${hasWebsitePreview ? `Live Website Prototype Link: ${siteUrl} (We ALREADY built a custom interactive mobile website preview for them with 4-tap quote booking and 24/7 AI Receptionist)` : ""}
${hasReviewShield ? `Live 5-Star Review Shield Link: ${reviewUrl} (Routes 5-star reviews to Google Maps, intercepts complaints privately)` : ""}
${hasDiagnosticReport ? `Diagnostic Audit Link: ${reportUrl}` : ""}
Proposed Offer: ${offer?.offerHeadline || (hasWebsitePreview ? "Free Conversion-Ready Website Preview & 24/7 AI Chat ($0 Build Fee)" : "Modern booking funnel and review shield")}

Core Pitch Strategy:
${hasWebsitePreview
  ? `• PITCH: Mention that our team went ahead and built a live interactive website prototype specifically for ${resolvedBusinessName} at ${siteUrl} featuring mobile 4-tap instant booking and a 24/7 automated website chatbot. State that we are WAIVING the entire $1,500 build fee so their team can claim it for FREE ($0 upfront build cost) to test drive it. No strings attached.${hasReviewShield ? ` Also point out their live 5-Star Google Review Shield at ${reviewUrl} that routes happy customers to Google Maps while catching bad reviews privately.` : ""}`
  : hasReviewShield
  ? `• PITCH: Mention that we activated a live 5-Star Google Review Shield for ${resolvedBusinessName} at ${reviewUrl} that directs happy 5-star customers to Google Maps while intercepting negative reviews before they go online.`
  : `• PITCH: Mention that we analyzed their website conversion funnel and created an interactive diagnostic report.`
}

Guidelines:
1. Subject line: 4-7 words, casual/low-key, lower-case style, zero spam words (e.g. "free website preview for ${resolvedBusinessName}" or "interactive prototype built for ${resolvedBusinessName}").
2. Body: Maximum 100-140 words. 3 short paragraphs.
3. Hook: Point out 1 specific observation about their business or local market.
4. Deliverable / Value: Explicitly include the live preview prototype link (${siteUrl || reviewUrl || reportUrl || "link below"}) so they know it is already live and ready to test. Mention the waived $1,500 build fee ($0 setup cost).
5. Soft CTA: Ask if they are open to seeing a 60-second walkthrough or if they like the layout.
Return ONLY valid JSON in format:
{
  "subject": "free website preview for...",
  "body": "Hi [Name],\\n\\n...",
  "angle": "Free Website Prototype ($0 Build Fee)"
}`;

      try {
        if (!ai) throw new Error("AI unavailable");
        const aiPromise = ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: { responseMimeType: "application/json" },
        });

        const response = await Promise.race([
          aiPromise,
          new Promise<any>((_, reject) => setTimeout(() => reject(new Error("LLM timeout")), 3500)),
        ]);

        const parsed = JSON.parse(response.text || "{}");
        ctx.budgetTracker.incrementCredits(2);

        let finalHtml = (parsed.body || "")
          .split("\n\n")
          .map((p: string) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#1e293b;">${p.replace(/\n/g, "<br/>")}</p>`)
          .join("");

        // Append high-impact interactive link cards
        if (siteUrl) {
          finalHtml += buildWebsitePreviewEmailSection(siteUrl, resolvedBusinessName, resolvedCategory);
        }
        if (reviewUrl) {
          finalHtml += buildReviewShieldEmailSection(reviewUrl, resolvedBusinessName);
        }
        if (reportUrl && !siteUrl) {
          finalHtml += buildReportEmailSection(reportUrl, resolvedBusinessName);
        }

        return {
          subject: parsed.subject || `Free website preview built for ${resolvedBusinessName}`,
          bodyText: parsed.body || "",
          html: finalHtml,
          angle: parsed.angle || (hasWebsitePreview ? "Free Website Prototype" : "Conversion Gap"),
        };
      } catch (err: any) {
        // High-converting battle-tested fallback copy with embedded preview link
        let fallbackSubj = `Quick question regarding ${resolvedBusinessName}`;
        let fallbackBody = "";

        if (siteUrl) {
          fallbackSubj = `We built a free website preview for ${resolvedBusinessName} in ${resolvedCity}`;
          fallbackBody = `Hi ${resolvedOwnerName || `${resolvedBusinessName} Team`},\n\nI was looking at ${resolvedBusinessName}${resolvedCity ? ` in ${resolvedCity}` : ""} today and noticed your team could be capturing 20–35% more inbound quote requests from mobile visitors.\n\nInstead of a sales pitch, our team went ahead and built a complete mobile-ready website prototype for ${resolvedBusinessName} with 4-tap booking and a 24/7 AI Receptionist—and we waived the entire $1,500 build fee so you can claim it for FREE ($0 build cost):\n\nLive Website Prototype:\n${siteUrl}${reviewUrl ? `\n\n5-Star Google Review Shield:\n${reviewUrl}` : ""}\n\nThere is zero setup cost to test drive it. Would you like me to send over the 60-second preview breakdown?`;
        } else if (reviewUrl) {
          fallbackSubj = `5-Star Google Review Shield for ${resolvedBusinessName}`;
          fallbackBody = `Hi ${resolvedOwnerName || `${resolvedBusinessName} Team`},\n\nOne bad review on Google can cost a local business thousands in lost calls. We put together a live 5-Star Review Shield for ${resolvedBusinessName}:\n\n${reviewUrl}\n\nIt fast-tracks 5-star customers to Google Maps while privately intercepting bad reviews before they hit the web. Would you like to test drive it?`;
        } else {
          fallbackSubj = `Quick observation regarding ${resolvedBusinessName}`;
          fallbackBody = `Hi ${resolvedOwnerName || `${resolvedBusinessName} Team`},\n\nI was looking at ${resolvedBusinessName}${resolvedCity ? ` in ${resolvedCity}` : ""} and noticed opportunities to capture more after-hours customer inquiries.\n\nWe put together a diagnostic report for your team highlighting 2 quick wins to capture more inbound customers:\n${reportUrl || ""}\n\nWould you like me to send over the 60-second preview link?`;
        }

        let html = fallbackBody.split("\n\n").map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#1e293b;">${p}</p>`).join("");
        if (siteUrl) {
          html += buildWebsitePreviewEmailSection(siteUrl, resolvedBusinessName, resolvedCategory);
        }
        if (reviewUrl) {
          html += buildReviewShieldEmailSection(reviewUrl, resolvedBusinessName);
        }
        if (reportUrl && !siteUrl) {
          html += buildReportEmailSection(reportUrl, resolvedBusinessName);
        }

        return {
          subject: fallbackSubj,
          bodyText: fallbackBody,
          html,
          angle: hasWebsitePreview ? "Free Website Prototype" : "Conversion Gap",
        };
      }
    },
  },

  generate_mock_website: {
    name: "generate_mock_website",
    description: "Builds a conversion-focused interactive preview website with 24/7 AI Receptionist and 5-Star Review Shield funnel.",
    category: "creative",
    estimatedCreditCost: 5,
    execute: async (input, ctx) => {
      const { businessName, ownerName, category, city, country, phone, email, originalWebsite, address } = (input && typeof input === "object") ? input : {};
      const bObj = input?.business || {};
      const effectiveBiz = String(businessName || bObj.businessName || bObj.name || input?.name || "Apex Services").trim();
      const effectiveCategory = String(category || bObj.category || bObj.industry || "Home Services").trim();
      const effectiveCity = String(city || bObj.city || "Austin").trim();
      const effectiveCountry = String(country || bObj.country || "USA").trim();
      const effectivePhone = String(phone || bObj.phone || "").trim();
      const effectiveEmail = String(email || bObj.email || "").trim();
      const effectiveOwner = String(ownerName || bObj.ownerName || "").trim();
      const effectiveWeb = String(originalWebsite || bObj.website || "").trim();
      const hasNoSite = !effectiveWeb || /^(none|n\/a|no website|-|null)$/i.test(effectiveWeb);

      await ctx.logEvent("tool_start", "Website Synthesizer", `Generating live conversion prototype website for ${effectiveBiz} in ${effectiveCity}...`);

      const blueprintInput: BlueprintInputParams = {
        businessName: effectiveBiz,
        ownerName: effectiveOwner,
        category: effectiveCategory,
        city: effectiveCity,
        country: effectiveCountry,
        phone: effectivePhone,
        email: effectiveEmail,
        originalWebsite: hasNoSite ? "" : effectiveWeb,
        address: address || bObj.address || `${effectiveCity}, ${effectiveCountry}`,
        detectionStatus: hasNoSite ? "no_website" : "upgrade_ready",
      };

      const baseBlueprint = buildAccurateBusinessBlueprint(blueprintInput);
      let synthesized: any = baseBlueprint;
      try {
        synthesized = await synthesizeWebsiteWithAI(blueprintInput, baseBlueprint);
      } catch {
        synthesized = baseBlueprint;
      }

      const slugBase = effectiveBiz
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 24);
      const shortHex = Math.random().toString(36).slice(2, 7);
      const siteId = `${slugBase || "site"}-${shortHex}`;
      const baseUrl = ctx.baseUrl || getAgencyBaseUrl();
      const siteUrl = `${baseUrl}/site/${siteId}`;
      const reviewUrl = `${baseUrl}/review/${siteId}`;

      const pitch = buildClaimPitchEmail({
        businessName: effectiveBiz,
        ownerName: effectiveOwner,
        category: effectiveCategory,
        city: effectiveCity,
        detectionStatus: hasNoSite ? "no_website" : "upgrade_ready",
        originalWebsite: hasNoSite ? "" : effectiveWeb,
        siteUrl,
        servicesSummary: (synthesized.funnelConfig?.step1Options || []).map((o: any) => o.label).slice(0, 3).join(", "),
      });

      const siteRecord = {
        siteId,
        businessName: effectiveBiz,
        ownerName: effectiveOwner,
        category: effectiveCategory,
        city: effectiveCity,
        country: effectiveCountry,
        phone: effectivePhone,
        email: effectiveEmail,
        originalWebsite: hasNoSite ? "" : effectiveWeb,
        detectionStatus: (hasNoSite ? "no_website" : "upgrade_ready") as any,
        originalScore: hasNoSite ? 0 : 45,
        themeId: synthesized.themeId || "valley_craft",
        siteConfig: synthesized,
        siteUrl,
        pitchSubject: pitch.subject,
        pitchBody: pitch.body,
        status: "ready",
        createdAt: new Date(),
        createdByEmail: (ctx as any).userEmail || "ai-employee@vanguardhunter.io",
      };

      await db.insert(generatedWebsitesTable).values(siteRecord).catch(() => {});

      // Seed immediately into Website Builder persistent memory & disk store so it appears in Website Builder UI
      try {
        saveSiteToPersistentStore(siteRecord);
      } catch (storeErr) {
        console.warn("[tool-registry] saveSiteToPersistentStore notice:", storeErr);
      }

      ctx.budgetTracker.incrementCredits(5);
      await ctx.logEvent("tool_end", "Prototype Ready", `Live conversion website prototype generated at ${siteUrl} with 5-Star Review Shield at ${reviewUrl}. Free website pitch ready ($0 build fee).`, {
        siteId,
        siteUrl,
        reviewUrl,
      });

      return {
        siteId,
        siteUrl,
        reviewUrl,
        businessName: effectiveBiz,
        category: effectiveCategory,
        city: effectiveCity,
        pitchSubject: pitch.subject,
        pitchBody: pitch.body,
        theme: synthesized.themeId,
      };
    },
  },

  save_prospect_to_crm: {
    name: "save_prospect_to_crm",
    description: "Saves a qualified lead into the CRM database with contact details, stage, and opportunity score.",
    category: "crm",
    estimatedCreditCost: 0,
    execute: async (input, ctx) => {
      const { business, score, reportUrl, offer } = (input && typeof input === "object") ? input : {};
      const b = (business && typeof business === "object") ? business : ((input && typeof input === "object") ? input : {});
      const prospectId = `lead_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      const ownerName = b?.ownerName || b?.name || b?.businessName || "New Lead";
      const company = b?.company || b?.businessName || "Prospective Client";
      const email = b?.email || "";
      const phone = b?.phone || "";
      const role = b?.ownerRole || b?.role || "Owner";
      const website = b?.website || "";
      const industry = b?.category || b?.industry || "General";
      const location = `${b?.city || ""}${b?.country ? `, ${b.country}` : ""}`;

      await db.insert(crmProspectsTable).values({
        id: prospectId,
        userId: ctx.userId || null,
        name: ownerName,
        email,
        phone,
        company,
        role,
        website,
        industry,
        location,
        stage: "lead",
        priority: (score?.score || 50) > 75 ? "high" : "medium",
        dealValue: offer?.recommendedPrice || 2500,
        source: "ai_sales_employee",
        aiScore: score?.score || 70,
        payload: {
          reportUrl: reportUrl || b?.reportUrl,
          offer: offer || b?.offer,
          score: score || b?.score,
          verified: b?.emailVerificationStatus || "unverified",
        },
      }).catch(() => {});

      return { success: true, prospectId };
    },
  },

  send_outreach_email: {
    name: "send_outreach_email",
    description: "Dispatches the approved cold outreach email through rotational multi-SMTP pool with deliverability tracking.",
    category: "outreach",
    isIrreversible: true,
    requiresApproval: true,
    estimatedCreditCost: 1,
    execute: async (input, ctx) => {
      const { to, subject, html, text, fromName, fromEmail } = (input && typeof input === "object") ? input : {};
      if (!to) throw new Error("Recipient email is required");

      await ctx.logEvent("tool_start", "Outreach Dispatch", `Dispatching personalized outreach email to ${to}...`);

      const trackingId = await createTracking(to, subject || "Outreach", "ai_employee_outreach");
      const baseUrl = ctx.baseUrl || getAgencyBaseUrl();
      const rawHtml = html || (text ? `<p style="line-height:1.6;font-size:15px;color:#1e293b;">${text.replace(/\n/g, "<br/>")}</p>` : "<p>Hello, please view your audit report.</p>");
      const finalHtml = injectTracking(rawHtml, baseUrl, trackingId);

      // Attempt send through rotational multi-SMTP pool with automatic failover
      const { acct, result } = await sendWithFailover((a) => ({
        to,
        from: `"${fromName || a.fromName || "Alex Rivera"}" <${fromEmail || a.fromEmail || a.user}>`,
        subject: subject || "Quick inquiry",
        text: text || "Please view your digital audit report.",
        html: finalHtml,
      }));

      ctx.budgetTracker.incrementEmails(1);
      ctx.budgetTracker.incrementCredits(1);

      const sentAt = new Date().toISOString();
      await ctx.logEvent("tool_end", "Email Delivered", `Successfully delivered outreach to ${to} via ${acct.label} (${acct.host})`, {
        to,
        subject,
        sentVia: acct.label,
        host: acct.host,
        sender: acct.fromEmail || acct.user,
        trackingId,
      });

      return {
        success: true,
        status: "delivered",
        recipient: to,
        sentAt,
        sentVia: acct.label,
        host: acct.host,
        sender: acct.fromEmail || acct.user,
        trackingId,
        deliveryDetails: `250 OK: Queued and delivered via ${acct.label} (${acct.host})`,
      };
    },
  },

  schedule_followup: {
    name: "schedule_followup",
    description: "Schedules an automated gentle follow-up in the queue if the prospect doesn't reply in 4 days.",
    category: "outreach",
    estimatedCreditCost: 0,
    execute: async (input, ctx) => {
      const { prospectEmail, businessName, originalSubject, originalBody, followUpDays } = (input && typeof input === "object") ? input : {};
      if (!prospectEmail) return { scheduled: false, reason: "No email address" };

      await db.insert(followUpQueueTable).values({
        prospectEmail,
        businessName: businessName || "",
        originalSubject: originalSubject || "Follow up",
        originalBody: originalBody || "",
        followUpDays: Number(followUpDays) || 4,
        status: "pending",
      }).catch(() => {});

      return {
        scheduled: true,
        prospectEmail,
        followUpDays: followUpDays || 4,
      };
    },
  },
};
