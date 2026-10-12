/**
 * hunter-client.ts
 *
 * Real Hunter.io B2B Intelligence & Verification Client.
 * Integrates with Hunter API Key Multipool (readPool("hunter")) and process.env.HUNTER_API_KEY.
 * Provides resilient fallback to local deep web scraping and DNS MX verification when keys are not configured.
 */

import { rotateKey, readPool } from "./api-key-pools";
import { verifyEmailAddress } from "./email-verifier";
import { discoverCommercialFreeEmailForBusiness } from "./business-scrapers";

export interface HunterDiscoveredEmail {
  email: string;
  firstName?: string;
  lastName?: string;
  position?: string;
  confidence: number;
  type?: string;
  source: "hunter_api" | "website_crawl" | "directory";
  verificationStatus?: "deliverable" | "risky" | "undeliverable";
}

export interface HunterVerificationResult {
  isValid: boolean;
  status: "deliverable" | "risky" | "undeliverable";
  score: number;
  reason: string;
  provider?: string;
  verifiedBy: "hunter_api" | "dns_mx_verifier";
  details?: {
    mxRecords?: boolean;
    smtpCheck?: boolean;
    smtpServer?: string;
    acceptAll?: boolean;
    disposable?: boolean;
  };
}

export interface HunterStatus {
  configured: boolean;
  count: number;
  hasEnvFallback: boolean;
  provider: string;
  activeKeyMasked?: string;
}

/**
 * Extracts a clean domain from a website URL or string.
 */
export function extractCleanDomain(input: string): string {
  if (!input) return "";
  let clean = input.trim().toLowerCase();
  clean = clean.replace(/^https?:\/\//i, "");
  clean = clean.replace(/^www\./i, "");
  clean = clean.split("/")[0].split("?")[0].split(":")[0];
  return clean;
}

/**
 * Checks the status of Hunter.io API configuration in the system.
 */
export async function getHunterStatus(): Promise<HunterStatus> {
  try {
    const pool = await readPool("hunter");
    const validKeys = pool.filter((k) => Boolean(k.key));
    const hasEnv = pool.some((k) => k.id === "__env__");
    const activeKey = await rotateKey("hunter");

    let masked = "";
    if (activeKey) {
      masked = activeKey.length > 8
        ? `${activeKey.slice(0, 4)}••••${activeKey.slice(-4)}`
        : "••••••••";
    }

    return {
      configured: Boolean(activeKey),
      count: validKeys.length,
      hasEnvFallback: hasEnv,
      provider: "Hunter.io B2B Intelligence",
      activeKeyMasked: masked,
    };
  } catch {
    return {
      configured: Boolean(process.env.HUNTER_API_KEY),
      count: process.env.HUNTER_API_KEY ? 1 : 0,
      hasEnvFallback: Boolean(process.env.HUNTER_API_KEY),
      provider: "Hunter.io B2B Intelligence",
    };
  }
}

/**
 * Queries Hunter.io Domain Search API:
 * https://api.hunter.io/v2/domain-search?domain=...&api_key=...
 */
export async function hunterDomainSearch(domain: string): Promise<HunterDiscoveredEmail[]> {
  const cleanDomain = extractCleanDomain(domain);
  if (!cleanDomain || cleanDomain.includes("localhost") || cleanDomain.includes("127.0.0.1")) {
    return [];
  }

  const apiKey = await rotateKey("hunter");
  if (!apiKey) return [];

  const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(cleanDomain)}&api_key=${encodeURIComponent(apiKey)}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "VanguardHunter/2.0" },
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.warn(`[hunter-client] Domain search returned ${resp.status}:`, errText.slice(0, 200));
      return [];
    }

    const json = await resp.json();
    const emails = json?.data?.emails || [];

    return emails
      .filter((e: any) => e.value && typeof e.value === "string" && e.value.includes("@"))
      .map((e: any) => ({
        email: e.value.toLowerCase().trim(),
        firstName: e.first_name || "",
        lastName: e.last_name || "",
        position: e.position || "",
        confidence: Number(e.confidence) || 80,
        type: e.type || "personal",
        source: "hunter_api" as const,
        verificationStatus: e.verification?.status === "valid" ? "deliverable" : "risky",
      }));
  } catch (err: any) {
    console.warn(`[hunter-client] Domain search failed for ${cleanDomain}:`, err.message);
    return [];
  }
}

/**
 * Queries Hunter.io Email Finder API:
 * https://api.hunter.io/v2/email-finder?domain=...&company=...&first_name=...
 */
export async function hunterEmailFinder(params: {
  domain?: string;
  company?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
}): Promise<HunterDiscoveredEmail | null> {
  const apiKey = await rotateKey("hunter");
  if (!apiKey) return null;

  const cleanDomain = extractCleanDomain(params.domain || "");
  const query = new URLSearchParams({ api_key: apiKey });

  if (cleanDomain) query.set("domain", cleanDomain);
  if (params.company) query.set("company", params.company);

  if (params.fullName) {
    query.set("full_name", params.fullName);
  } else {
    if (params.firstName) query.set("first_name", params.firstName);
    if (params.lastName) query.set("last_name", params.lastName);
  }

  const url = `https://api.hunter.io/v2/email-finder?${query.toString()}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "VanguardHunter/2.0" },
    });
    clearTimeout(timeout);

    if (!resp.ok) return null;

    const json = await resp.json();
    const data = json?.data;
    if (data?.email) {
      return {
        email: data.email.toLowerCase().trim(),
        firstName: data.first_name || params.firstName || "",
        lastName: data.last_name || params.lastName || "",
        position: data.position || "Decision Maker",
        confidence: Number(data.score) || 85,
        source: "hunter_api",
        verificationStatus: data.verification?.status === "valid" ? "deliverable" : "risky",
      };
    }
  } catch (err: any) {
    console.warn(`[hunter-client] Email finder error:`, err.message);
  }

  return null;
}

/**
 * Verifies email deliverability using Hunter.io Email Verifier API,
 * with automatic fallback to local DNS MX verifier.
 */
export async function hunterEmailVerifier(email: string): Promise<HunterVerificationResult> {
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes("@")) {
    return {
      isValid: false,
      status: "undeliverable",
      score: 0,
      reason: "Malformed or empty email address",
      verifiedBy: "dns_mx_verifier",
    };
  }

  const apiKey = await rotateKey("hunter");

  if (apiKey) {
    const url = `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(cleanEmail)}&api_key=${encodeURIComponent(apiKey)}`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json", "User-Agent": "VanguardHunter/2.0" },
      });
      clearTimeout(timeout);

      if (resp.ok) {
        const json = await resp.json();
        const data = json?.data;
        if (data) {
          const statusResult: "deliverable" | "risky" | "undeliverable" =
            data.result === "deliverable"
              ? "deliverable"
              : data.result === "risky"
              ? "risky"
              : "undeliverable";

          return {
            isValid: statusResult === "deliverable" || (statusResult === "risky" && (data.score || 0) >= 60),
            status: statusResult,
            score: Number(data.score) || (statusResult === "deliverable" ? 95 : 40),
            reason: data.status || `Hunter score: ${data.score}/100`,
            provider: data.smtp_server || cleanEmail.split("@")[1],
            verifiedBy: "hunter_api",
            details: {
              mxRecords: Boolean(data.mx_records),
              smtpCheck: Boolean(data.smtp_check),
              smtpServer: data.smtp_server,
              acceptAll: Boolean(data.accept_all),
              disposable: Boolean(data.disposable),
            },
          };
        }
      }
    } catch (err: any) {
      console.warn(`[hunter-client] Hunter verifier failed, falling back to DNS MX:`, err.message);
    }
  }

  // Graceful fallback: local DNS MX verifier
  const localVer = await verifyEmailAddress(cleanEmail);
  return {
    isValid: localVer.isValid,
    status: localVer.isValid ? (localVer.score > 70 ? "deliverable" : "risky") : "undeliverable",
    score: localVer.score,
    reason: localVer.reason,
    provider: localVer.provider,
    verifiedBy: "dns_mx_verifier",
  };
}

/**
 * High-level contact discovery engine:
 * 1. Checks Hunter API if domain is provided
 * 2. Crawls website contact channels & commercial listings
 * 3. Verifies deliverability with Hunter or DNS MX
 */
export async function discoverAndVerifyContact(params: {
  businessName: string;
  website?: string;
  city?: string;
  country?: string;
  phone?: string;
  ownerName?: string;
}): Promise<{
  email: string;
  ownerName?: string;
  ownerRole?: string;
  source: "hunter_api" | "website_crawl" | "directory" | "commercial_free";
  confidence: number;
  verification: HunterVerificationResult;
}> {
  const { businessName, website, city, country, phone, ownerName } = params;

  // 1. Try Hunter Domain Search if website domain exists
  if (website) {
    const domain = extractCleanDomain(website);
    if (domain) {
      const hunterResults = await hunterDomainSearch(domain);
      if (hunterResults.length > 0) {
        // Prefer personal/decision-maker email
        const best = hunterResults.find((e) => e.type === "personal" && e.position) || hunterResults[0];
        const verification = await hunterEmailVerifier(best.email);
        return {
          email: best.email,
          ownerName: best.firstName && best.lastName ? `${best.firstName} ${best.lastName}` : ownerName,
          ownerRole: best.position || "Decision Maker",
          source: "hunter_api",
          confidence: best.confidence || 85,
          verification,
        };
      }
    }
  }

  // 2. Try Commercial Free Email Search (Bing/DDG/YellowPages)
  const discovered = await discoverCommercialFreeEmailForBusiness(businessName, city || "", country || "", phone || "");
  if (discovered?.email) {
    const verification = await hunterEmailVerifier(discovered.email);
    return {
      email: discovered.email,
      ownerName,
      ownerRole: "Owner",
      source: "commercial_free",
      confidence: 78,
      verification,
    };
  }

  // 3. Fallback: return empty
  return {
    email: "",
    ownerName,
    source: "directory",
    confidence: 0,
    verification: {
      isValid: false,
      status: "undeliverable",
      score: 0,
      reason: "No public email contact discovered across Hunter API and directory crawl",
      verifiedBy: "dns_mx_verifier",
    },
  };
}
