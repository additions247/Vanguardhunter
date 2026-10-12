import React, { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import {
  Bot,
  Play,
  Pause,
  Square,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  Send,
  Eye,
  Check,
  X,
  Users,
  Mail,
  Globe,
  BarChart3,
  Brain,
  Sliders,
  DollarSign,
  FileText,
  Search,
  MessageSquare,
  Building,
  RefreshCw,
  ExternalLink,
  Copy,
  ShieldCheck,
  Flame,
  Filter,
  Phone,
  CheckCheck,
  Server,
} from "lucide-react";
import { saasFetch } from "@/lib/saas-auth";
import { saveUserProspects, loadUserProspects, ExportableLead } from "@/lib/projects";
import { triggerUpgradeModal } from "@/components/UpgradeModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

export interface EmployeeProfile {
  id: number;
  userId: number | null;
  name: string;
  role: string;
  description: string;
  avatar: string;
  status: string;
  config?: any;
}

export interface EmployeeRun {
  id: number;
  userId: number | null;
  employeeId: number;
  goal: string;
  status: "CREATED" | "PLANNING" | "EXECUTING" | "PAUSED" | "WAITING_FOR_APPROVAL" | "WAITING_FOR_INPUT" | "COMPLETED" | "FAILED" | "CANCELLED";
  progress: number;
  currentTaskIndex: number;
  totalTasks: number;
  currentTaskDescription: string;
  budgetLimits: {
    maxBusinesses: number;
    maxEmails: number;
    maxAiCredits: number;
    maxRuntimeMinutes: number;
    maxRetries: number;
  };
  budgetConsumed: {
    businesses: number;
    emails: number;
    aiCredits: number;
    seconds: number;
  };
  summaryReport?: {
    businessesFound?: number;
    businessesAnalyzed?: number;
    qualifiedProspects?: number;
    emailsFound?: number;
    offersCreated?: number;
    messagesPrepared?: number;
    messagesSent?: number;
    followUpsScheduled?: number;
    estimatedAiCostUsd?: string;
    completedAt?: string;
    emailDeliveryAnalysis?: any;
    hunterIntel?: any;
    [key: string]: any;
  };
  metadata?: any;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

export interface EmployeeTask {
  id: number;
  runId: number;
  taskIndex: number;
  taskType: string;
  description: string;
  status: "pending" | "running" | "waiting_approval" | "completed" | "failed" | "skipped" | "cancelled";
  tool: string;
  requiresApproval: boolean;
  input: any;
  output: any;
  error: string;
  startedAt?: string;
  completedAt?: string;
}

export interface EmployeeEvent {
  id: number;
  runId: number;
  taskId?: number;
  level: "info" | "thought" | "tool_start" | "tool_end" | "warning" | "error" | "approval_needed" | "approval_resolved";
  title: string;
  message: string;
  payload: any;
  createdAt: string;
}

export interface EmployeeApproval {
  id: number;
  runId: number;
  taskId: number;
  actionType: string;
  status: "pending" | "approved" | "rejected" | "edited";
  title: string;
  description: string;
  proposedPayload: any;
  approvedPayload: any;
  userNote: string;
  createdAt: string;
}

const DEFAULT_EMPLOYEE_LIST: EmployeeProfile[] = [
  {
    id: 1,
    userId: null,
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
    id: 2,
    userId: null,
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
    id: 3,
    userId: null,
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
    id: 4,
    userId: null,
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
    id: 5,
    userId: null,
    name: "David Sterling — 5-Star Review Shield & Reputation Director",
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
    id: 6,
    userId: null,
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
    id: 7,
    userId: null,
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

const EXAMPLE_GOALS = [
  {
    title: "Roofing Redesign & Full Pipeline (Austin)",
    goal: "Find 15 roofing companies in Austin Texas that have poor websites. Analyze them, find their emails, select the best prospects, create personalized offers and prepare outreach.",
    empId: 1,
  },
  {
    title: "Dental Clinic Conversion Audits (Miami)",
    goal: "Discover 15 dental clinics in Miami with missing booking widgets. Generate custom audit reports, score opportunities, and draft personalized cold emails.",
    empId: 2,
  },
  {
    title: "HVAC 24/7 AI Receptionist (Denver)",
    goal: "Find 15 HVAC and plumbing businesses in Denver. Detect missing after-hours call capture, formulate 24/7 AI Receptionist pitches, and prepare outreach sequence.",
    empId: 3,
  },
  {
    title: "Landscaping Decision-Makers (Phoenix)",
    goal: "Discover verified owner emails and compute Apollo Buyer Intent scores for 20 commercial landscaping businesses in Phoenix with active phone lines.",
    empId: 4,
  },
  {
    title: "5-Star Review Shield Funnel (Dallas)",
    goal: "Find 15 medspas and home service contractors in Dallas with fewer than 50 Google reviews. Diagnose reputation deficit gaps, build interactive 5-star review funnel blueprints, and draft cold email outreach.",
    empId: 5,
  },
  {
    title: "Roofing Multi-Touch Follow-Up Cadence (Austin)",
    goal: "Audit 20 commercial roofing and remodeling contractors in Austin. Schedule 3-touch personalized follow-up sequences with tailored ROI value propositions.",
    empId: 6,
  },
  {
    title: "Local 3-Pack Google Map Audit (Austin)",
    goal: "Audit 20 local home service businesses in Austin ranking outside the Google Local 3-Pack. Diagnose missing geo-citations and generate customized local SEO growth proposals.",
    empId: 7,
  },
];

export default function AIEmployeePanel({
  onNavigateTab,
  initialGoal,
}: {
  onNavigateTab?: (tab: string) => void;
  initialGoal?: string;
}) {
  const [, setLocation] = useLocation();

  const [employees, setEmployees] = useState<EmployeeProfile[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number>(1);
  const [runs, setRuns] = useState<EmployeeRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [currentRun, setCurrentRun] = useState<EmployeeRun | null>(null);
  const [tasks, setTasks] = useState<EmployeeTask[]>([]);
  const [events, setEvents] = useState<EmployeeEvent[]>([]);
  const [approvals, setApprovals] = useState<EmployeeApproval[]>([]);

  const [goalInput, setGoalInput] = useState(initialGoal || "");
  const [isHiring, setIsHiring] = useState(false);
  const [hiringPercent, setHiringPercent] = useState<number>(0);
  const [hiringStage, setHiringStage] = useState<number>(0);
  const [hiringStageText, setHiringStageText] = useState<string>("");
  const [deployingEmpId, setDeployingEmpId] = useState<number | null>(null);

  const [isPausing, setIsPausing] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [prospectFilter, setProspectFilter] = useState<"all" | "hot" | "verified">("all");
  const [exportingLeadId, setExportingLeadId] = useState<string | null>(null);
  const [copiedLeadKey, setCopiedLeadKey] = useState<string | null>(null);

  const [appliedGoalNotice, setAppliedGoalNotice] = useState<string>("");
  const [selectedEmpNotice, setSelectedEmpNotice] = useState<string>("");
  const [copyFeedback, setCopyFeedback] = useState<string>("");
  const [savedLeadNames, setSavedLeadNames] = useState<Set<string>>(() => {
    try {
      const existing = loadUserProspects<ExportableLead>();
      return new Set(existing.map((e) => (e.businessName || "").toLowerCase()));
    } catch {
      return new Set();
    }
  });

  const [showLimits, setShowLimits] = useState(false);
  const [limits, setLimits] = useState({
    maxBusinesses: 20,
    maxEmails: 10,
    maxAiCredits: 100,
    maxRuntimeMinutes: 30,
    maxRetries: 3,
    autoApprove: true,
  });

  const [integrationsStatus, setIntegrationsStatus] = useState<{
    hunter: { configured: boolean; keysCount: number; hasEnvFallback: boolean; provider: string; status: string; description: string; activeKeyMasked?: string };
    smtp: { connected: boolean; accountsCount: number; activeAccounts: any[]; activeRelay: string; status: string; description: string };
  } | null>(null);
  const [isLoadingIntegrations, setIsLoadingIntegrations] = useState(false);
  const [retryingEmail, setRetryingEmail] = useState<string | null>(null);
  const [retryFeedback, setRetryFeedback] = useState<string>("");

  const loadIntegrationsStatus = useCallback(async () => {
    setIsLoadingIntegrations(true);
    try {
      const res = await saasFetch<any>("/api/ai-employees/integrations/status");
      if (res && res.smtp && res.hunter) {
        setIntegrationsStatus(res);
      }
    } catch (err) {
      console.warn("Could not load integrations status:", err);
    } finally {
      setIsLoadingIntegrations(false);
    }
  }, []);

  useEffect(() => {
    loadIntegrationsStatus();
  }, [loadIntegrationsStatus]);

  const handleRetryFailedEmail = async (runId: number, targetEmail?: string) => {
    setRetryingEmail(targetEmail || "all");
    setRetryFeedback("");
    try {
      const res = await saasFetch<{ success: boolean; message: string; retriedCount?: number }>(
        `/api/ai-employees/runs/${runId}/retry-failed-emails`,
        {
          method: "POST",
          body: JSON.stringify({ targetEmail }),
        }
      );
      if (res && res.success) {
        setRetryFeedback(res.message || "Email re-sent successfully!");
        if (selectedRunId) loadRunDetails(selectedRunId);
        loadIntegrationsStatus();
      } else {
        setRetryFeedback(res?.message || "Could not re-dispatch email.");
      }
    } catch (err: any) {
      setRetryFeedback(`Retry failed: ${err.message || "Unknown error"}`);
    } finally {
      setRetryingEmail(null);
    }
  };

  const loadEmployees = useCallback(async () => {
    try {
      const data = await saasFetch<EmployeeProfile[]>("/api/ai-employees");
      if (Array.isArray(data) && data.length > 0) {
        setEmployees(data);
      } else {
        setEmployees(DEFAULT_EMPLOYEE_LIST);
      }
    } catch (err) {
      console.warn("Could not load AI employees fleet:", err);
      setEmployees(DEFAULT_EMPLOYEE_LIST);
    }
  }, []);

  useEffect(() => {
    loadEmployees();
  }, [loadEmployees]);

  useEffect(() => {
    if (initialGoal) {
      setGoalInput(initialGoal);
    }
  }, [initialGoal]);

  const [expandedTasks, setExpandedTasks] = useState<Record<number, boolean>>({});
  const [selectedApproval, setSelectedApproval] = useState<EmployeeApproval | null>(null);
  const [activeTab, setActiveTab] = useState<"activity" | "tasks" | "prospects" | "approvals" | "report" | "outreach">("activity");
  const [actionNotice, setActionNotice] = useState<string>("");

  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const loadRuns = useCallback(async () => {
    try {
      const data = await saasFetch<EmployeeRun[]>("/api/ai-employees/runs");
      if (Array.isArray(data) && data.length > 0) {
        setRuns(data);
        if (!selectedRunId) {
          setSelectedRunId(data[0].id);
        }
      }
    } catch (err) {
      console.warn("Could not load employee runs:", err);
    }
  }, [selectedRunId]);

  const loadRunDetails = useCallback(async (runId: number) => {
    try {
      const res = await saasFetch<{
        run: EmployeeRun;
        tasks: EmployeeTask[];
        events: EmployeeEvent[];
        approvals: EmployeeApproval[];
      }>(`/api/ai-employees/runs/${runId}`);

      if (res && res.run) {
        setCurrentRun(res.run);
        setTasks(res.tasks || []);
        setEvents(res.events || []);
        setApprovals(res.approvals || []);

        const pendingApp = (res.approvals || []).find((a) => a.status === "pending");
        if (pendingApp) {
          setSelectedApproval(pendingApp);
        } else {
          setSelectedApproval(null);
        }

        // If run is in a terminal state, stop unnecessary interval polling
        if (["COMPLETED", "FAILED", "CANCELLED"].includes(res.run.status)) {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
        }
      }
    } catch (err) {
      console.warn("Could not load run details:", err);
    }
  }, []);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    if (selectedRunId) {
      loadRunDetails(selectedRunId);

      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }

      // 1.5s interval for snappy, smooth real-time execution feedback
      pollingRef.current = setInterval(() => {
        loadRunDetails(selectedRunId);
      }, 1500);
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [selectedRunId, loadRunDetails]);

  const handleLaunchEmployee = async (overrideGoal?: string, overrideEmpId?: number) => {
    const targetEmpId = overrideEmpId || selectedEmployeeId || 1;
    let targetGoal = (overrideGoal || goalInput).trim();

    const activeList = employees.length > 0 ? employees : DEFAULT_EMPLOYEE_LIST;
    const targetEmp = activeList.find((e) => e.id === targetEmpId) || activeList[0];
    const parsedCfg = typeof targetEmp?.config === "string" ? JSON.parse(targetEmp.config || "{}") : targetEmp?.config || {};

    if (!targetGoal) {
      targetGoal = parsedCfg.defaultGoal || "Find 15 roofing companies in Austin Texas with poor websites. Run diagnostics, find owner emails, calculate intent scores and draft cold emails.";
      setGoalInput(targetGoal);
      setSelectedEmpNotice(`Auto-loaded mission for ${targetEmp.name.split("—")[0].trim()}. Deploying now…`);
    }

    if (overrideEmpId) {
      setSelectedEmployeeId(overrideEmpId);
      setDeployingEmpId(overrideEmpId);
    }

    setIsHiring(true);
    setHiringStage(1);
    setHiringPercent(12);
    setHiringStageText(`Waking up ${targetEmp.name.split("—")[0].trim()} & allocating worker sandbox…`);

    const startTime = Date.now();
    const ticker = setInterval(() => {
      const elapsed = Date.now() - startTime;
      if (elapsed < 400) {
        setHiringPercent(Math.min(35, Math.floor(15 + (elapsed / 400) * 20)));
        setHiringStage(1);
        setHiringStageText(`Allocating credentials & isolated agent thread for ${targetEmp.name.split("—")[0].trim()}…`);
      } else if (elapsed < 1000) {
        setHiringPercent(Math.min(65, Math.floor(35 + ((elapsed - 400) / 600) * 30)));
        setHiringStage(2);
        setHiringStageText("Arming multi-directory scraper & DNS email verification toolbelt…");
      } else if (elapsed < 2000) {
        setHiringPercent(Math.min(88, Math.floor(65 + ((elapsed - 1000) / 1000) * 23)));
        setHiringStage(3);
        setHiringStageText("Synthesizing autonomous execution plan & budget guardrails…");
      } else {
        setHiringPercent(Math.min(96, Math.floor(88 + ((elapsed - 2000) / 2000) * 8)));
        setHiringStage(4);
        setHiringStageText("Compiling Apollo Buyer Intent guardrails & launching executor…");
      }
    }, 120);

    setActionNotice(`Deploying ${targetEmp.name.split("—")[0].trim()} to execute mission...`);
    try {
      const countMatch =
        targetGoal.match(/(?:give\s+me|find|generate|hunt|discover|search|audit|get|locate|provide|scrape|fetch)\s+(\d+)\b/i) ||
        targetGoal.match(/(\d+)\s*(?:exact\s+)?(?:businesses|companies|leads|prospects|contractors|clinics|agencies|roofers|plumbers|services|shops|stores|firms|places|clients|roofing)/i) ||
        targetGoal.match(/\b(\d+)\b/);
      const parsedExactCount = countMatch ? parseInt(countMatch[1], 10) : undefined;
      const effectiveLimits = parsedExactCount && parsedExactCount > 0 && parsedExactCount <= 500
        ? { ...limits, maxBusinesses: parsedExactCount, maxEmails: Math.min(parsedExactCount, limits.maxEmails || 10) }
        : limits;

      const res = await saasFetch<{ success: boolean; runId: number }>("/api/ai-employees/runs", {
        method: "POST",
        body: JSON.stringify({
          employeeId: targetEmpId,
          goal: targetGoal,
          customLimits: effectiveLimits,
        }),
      });

      clearInterval(ticker);
      setHiringPercent(100);
      setHiringStage(5);
      setHiringStageText("✓ Mission launched! Autonomous worker loop active.");

      if (res?.runId) {
        setGoalInput("");
        await loadRuns();
        setSelectedRunId(res.runId);
        setActiveTab("activity");
        setActionNotice(`Mission #${res.runId} launched! ${targetEmp.name.split("—")[0].trim()} is actively executing.`);
        setTimeout(() => setActionNotice(""), 6000);
      }
    } catch (err: any) {
      clearInterval(ticker);
      const errMsg = err.message || "Failed to hire AI employee. Please check connection.";
      setActionNotice(errMsg);
      if (/limit reached|upgrade your plan|upgrade your account|mission limit|quota/i.test(errMsg)) {
        triggerUpgradeModal({ limitType: "ai_employee", message: errMsg });
      }
      setTimeout(() => setActionNotice(""), 5000);
    } finally {
      setTimeout(() => {
        setIsHiring(false);
        setDeployingEmpId(null);
        setHiringStage(0);
        setHiringPercent(0);
      }, 800);
    }
  };

  const handlePause = async () => {
    if (!selectedRunId || isPausing) return;
    setIsPausing(true);
    setActionNotice("Sending pause signal to employee loop...");
    try {
      await saasFetch(`/api/ai-employees/runs/${selectedRunId}/pause`, { method: "POST" });
      await loadRunDetails(selectedRunId);
      setActionNotice("✓ Employee paused. Tasks safely suspended.");
      setTimeout(() => setActionNotice(""), 3000);
    } catch (err: any) {
      setActionNotice("Failed to pause: " + err.message);
    } finally {
      setIsPausing(false);
    }
  };

  const handleResume = async (extendCredits = true) => {
    if (!selectedRunId || isResuming) return;
    setIsResuming(true);
    setActionNotice("Resuming autonomous sequence and extending safety credits…");
    try {
      await saasFetch(`/api/ai-employees/runs/${selectedRunId}/resume`, {
        method: "POST",
        body: JSON.stringify({ extendCredits: extendCredits ? 50 : 0 }),
      });
      await loadRunDetails(selectedRunId);
      setActionNotice("✓ Autonomous execution resumed! Worker thread active.");
      setTimeout(() => setActionNotice(""), 3500);
    } catch (err: any) {
      setActionNotice("Failed to resume: " + err.message);
    } finally {
      setIsResuming(false);
    }
  };

  const handleCancel = async () => {
    if (!selectedRunId || isCancelling) return;
    setIsCancelling(true);
    setActionNotice("Sending stop signal to employee worker thread…");
    try {
      await saasFetch(`/api/ai-employees/runs/${selectedRunId}/cancel`, { method: "POST" });
      await loadRunDetails(selectedRunId);
      await loadRuns();
      setActionNotice("✓ Mission safely cancelled. Tasks terminated.");
      setTimeout(() => setActionNotice(""), 3500);
    } catch (err: any) {
      setActionNotice("Failed to cancel: " + err.message);
    } finally {
      setIsCancelling(false);
    }
  };

  const handleResolveApproval = async (approved: boolean) => {
    if (!selectedApproval) return;
    if (approved) setIsApproving(true);
    else setIsRejecting(true);
    setActionNotice(
      approved
        ? "Authorizing outreach & dispatching email sequence…"
        : "Rejecting outreach batch & proceeding to next task…"
    );
    try {
      await saasFetch(`/api/ai-employees/approvals/${selectedApproval.id}/resolve`, {
        method: "POST",
        body: JSON.stringify({
          approved,
          userNote: approved ? "Approved by user" : "Rejected by user",
        }),
      });
      if (selectedRunId) {
        await loadRunDetails(selectedRunId);
        await loadRuns();
      }
      setActionNotice(
        approved
          ? "✓ Outreach authorized! Autonomous worker is actively sending."
          : "✓ Action rejected. Employee skipped to next phase."
      );
      setTimeout(() => setActionNotice(""), 4000);
    } catch (err: any) {
      setActionNotice("Approval resolution failed: " + err.message);
    } finally {
      setIsApproving(false);
      setIsRejecting(false);
    }
  };

  const handleExportToCrm = async (businesses: any[]) => {
    if (!businesses || !businesses.length || isExporting) return;
    setIsExporting(true);
    setActionNotice(`Exporting ${businesses.length} lead${businesses.length > 1 ? "s" : ""} to CRM Prospects pipeline…`);
    try {
      const exportable: ExportableLead[] = businesses.map((b) => ({
        businessName: b.businessName || "Unnamed Business",
        category: b.category || "Commercial Lead",
        city: b.city || "Austin",
        country: b.country || "USA",
        website: b.website || "",
        phone: b.phone || "",
        email: b.email || "",
        ownerName: b.ownerName || "",
        ownerRole: b.ownerRole || "Decision Maker",
        cmsPlatform: b.cmsPlatform || "",
        opportunityScore: b.apolloScore?.score || b.apolloScore?.intentScore || 80,
        painPoint: b.analysis?.gaps?.[0] || b.apolloScore?.reasons?.[0] || "Needs modern conversion funnel",
        status: "new",
        notes: `Imported from AI Employee Mission #${selectedRunId || ""}`,
      }));

      saveUserProspects(exportable);
      setSavedLeadNames((prev) => {
        const next = new Set(prev);
        exportable.forEach((e) => next.add((e.businessName || "").toLowerCase()));
        return next;
      });

      setActionNotice(`✓ Successfully exported ${businesses.length} lead${businesses.length > 1 ? "s" : ""} to CRM Prospects!`);
      setTimeout(() => setActionNotice(""), 4500);
    } catch (err: any) {
      setActionNotice("Failed to export leads: " + err.message);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportSingleLead = async (biz: any) => {
    if (!biz) return;
    const key = (biz.businessName || "").toLowerCase();
    setExportingLeadId(key);
    try {
      await handleExportToCrm([biz]);
    } finally {
      setExportingLeadId(null);
    }
  };

  const toggleTask = (taskId: number) => {
    setExpandedTasks((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1"><CheckCircle2 className="w-3 h-3" /> Completed</Badge>;
      case "EXECUTING":
        return <Badge className="bg-blue-600 hover:bg-blue-700 text-white animate-pulse gap-1"><Sparkles className="w-3 h-3" /> Executing</Badge>;
      case "PLANNING":
        return <Badge className="bg-purple-600 hover:bg-purple-700 text-white gap-1"><Brain className="w-3 h-3" /> Formulating Plan</Badge>;
      case "WAITING_FOR_APPROVAL":
        return <Badge className="bg-amber-600 hover:bg-amber-700 text-white animate-bounce gap-1"><ShieldAlert className="w-3 h-3" /> Approval Needed</Badge>;
      case "PAUSED":
        return <Badge className="bg-slate-600 text-white gap-1"><Pause className="w-3 h-3" /> Paused</Badge>;
      case "CANCELLED":
        return <Badge variant="outline" className="text-slate-400 gap-1"><X className="w-3 h-3" /> Cancelled</Badge>;
      case "FAILED":
        return <Badge className="bg-red-600 text-white gap-1"><AlertCircle className="w-3 h-3" /> Failed</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Notice Banner */}
      {actionNotice && (
        <div className="p-3 bg-purple-50 border border-purple-200 text-purple-900 rounded-xl text-xs font-semibold flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-600 animate-spin" />
            <span>{actionNotice}</span>
          </span>
          <button onClick={() => setActionNotice("")} className="text-purple-400 hover:text-purple-700">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Hero Card as specifically requested */}
      <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-purple-950 text-white rounded-2xl p-6 sm:p-8 shadow-xl border border-purple-900/40 relative overflow-hidden">
        <div className="absolute right-0 top-0 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-4xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 text-xs font-semibold mb-4">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Autonomous AI Sales Employee · Full Pipeline Orchestrator</span>
          </div>

          <div className="flex items-start gap-4 mb-3">
            <div className="text-4xl sm:text-5xl shrink-0 p-3 bg-white/5 rounded-2xl border border-white/10 shadow-inner">
              {employees.find((e) => e.id === selectedEmployeeId)?.avatar || "🕵️"}
            </div>
            <div>
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Autonomous AI Employee Fleet</h2>
              <p className="text-slate-300 text-sm sm:text-base mt-1 leading-relaxed">
                Deploy dedicated, real AI sales specialists trained to discover prospects, audit digital footprints, verify decision-makers, synthesize tailored commercial offers, and run outreach autonomously.
              </p>
            </div>
          </div>

          {/* Employee Fleet Selector */}
          <div className="mt-5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-purple-300 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> Select Specialized AI Employee:
              </span>
              <span className="text-[11px] text-purple-300/80 font-semibold">
                {(employees.length > 0 ? employees : DEFAULT_EMPLOYEE_LIST).length} Professional Specialists Active
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2.5">
              {(employees.length > 0 ? employees : DEFAULT_EMPLOYEE_LIST).map((emp) => {
                const isSelected = selectedEmployeeId === emp.id;
                const parsedCfg = typeof emp.config === "string" ? JSON.parse(emp.config || "{}") : emp.config || {};
                const isDeployingThis = deployingEmpId === emp.id && isHiring;
                return (
                  <div
                    key={emp.id}
                    onClick={() => {
                      setSelectedEmployeeId(emp.id);
                      setSelectedEmpNotice(emp.name.split("—")[0].trim());
                      setTimeout(() => setSelectedEmpNotice(""), 3000);
                      if (parsedCfg.defaultGoal) {
                        setGoalInput(parsedCfg.defaultGoal);
                      }
                    }}
                    className={`p-3 rounded-xl text-left transition-all cursor-pointer border flex flex-col justify-between relative group ${
                      isSelected
                        ? "bg-purple-900/80 border-purple-400 ring-2 ring-purple-400/70 shadow-xl scale-[1.01]"
                        : "bg-slate-900/70 border-slate-800 hover:border-slate-700 hover:bg-slate-900"
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1 mb-1.5">
                        <span className="text-2xl">{emp.avatar || "🕵️"}</span>
                        {isSelected ? (
                          <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white text-[9px] px-1.5 py-0 h-4 font-bold flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                            <span>Selected</span>
                          </Badge>
                        ) : (
                          <span className="text-[9px] text-slate-400 font-mono">#{emp.id}</span>
                        )}
                      </div>
                      <div className="font-bold text-xs text-white truncate leading-tight">
                        {emp.name.split("—")[0].trim()}
                      </div>
                      <div className="text-[10px] text-purple-300 font-medium truncate mt-0.5">{emp.role.split("&")[0].trim()}</div>
                      <div className="text-[10px] text-slate-300 line-clamp-2 mt-1.5 leading-relaxed">
                        {parsedCfg.specialty || emp.description}
                      </div>
                    </div>

                    <div className="mt-3 pt-2 border-t border-white/10 space-y-2">
                      <div className="flex items-center justify-between text-[9px] text-slate-400">
                        <span>⭐ {parsedCfg.satisfactionRate || "99%"}</span>
                        <span className="font-mono text-purple-300 font-semibold">{parsedCfg.missionsCompleted || 100}+ runs</span>
                      </div>
                      <Button
                        size="sm"
                        type="button"
                        disabled={isHiring}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleLaunchEmployee(parsedCfg.defaultGoal, emp.id);
                        }}
                        className={`w-full h-6 text-[10px] font-bold rounded-lg cursor-pointer transition-all ${
                          isSelected
                            ? "bg-purple-500 hover:bg-purple-400 text-white shadow-xs"
                            : "bg-slate-800 hover:bg-purple-600 text-slate-200 hover:text-white"
                        }`}
                      >
                        {isDeployingThis ? (
                          <span className="flex items-center gap-1">
                            <RefreshCw className="w-3 h-3 animate-spin" /> Deploying…
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <Play className="w-2.5 h-2.5 fill-current" /> Deploy
                          </span>
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
            {selectedEmpNotice && (
              <div className="text-[11px] font-semibold text-emerald-300 flex items-center gap-1.5 mt-2 animate-in fade-in">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Specialist Activated: {selectedEmpNotice} — Toolbelt loaded. Click &quot;Deploy Specialist&quot; or enter custom mission goal below.</span>
              </div>
            )}
          </div>

          {/* Goal Input Launcher */}
          <div className="mt-6 bg-slate-900/90 backdrop-blur-md p-4 sm:p-5 rounded-xl border border-white/10 shadow-2xl space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold uppercase tracking-wider text-purple-300">
                Give your AI Sales Employee a Natural Language Goal:
              </label>
              {isHiring ? (
                <span className="text-xs font-bold text-purple-300 flex items-center gap-1.5 animate-pulse">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Deploying Specialist Stage {hiringStage}/4 ({hiringPercent}%)</span>
                </span>
              ) : (
                <span className="text-[11px] text-slate-400">Click &quot;Hire / Run Employee&quot; or pick a quick goal</span>
              )}
            </div>

            {/* Progressive Execution Indicator during dispatch */}
            {isHiring && (
              <div className="p-3.5 bg-purple-950/90 rounded-xl border border-purple-500/50 text-xs space-y-2.5 animate-in fade-in">
                <div className="flex items-center justify-between text-purple-200 font-bold text-[11px]">
                  <span className="flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-purple-300" />
                    <span>{hiringStageText}</span>
                  </span>
                  <span className="font-mono text-emerald-300">{hiringPercent}%</span>
                </div>
                <div className="w-full h-2.5 bg-purple-900/80 rounded-full overflow-hidden p-0.5 border border-purple-500/30">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 via-indigo-400 to-emerald-400 rounded-full transition-all duration-300"
                    style={{ width: `${Math.max(10, hiringPercent)}%` }}
                  />
                </div>
                <div className="grid grid-cols-4 gap-1 text-[9px] text-center font-semibold pt-1">
                  <span className={hiringStage >= 1 ? "text-emerald-300" : "text-purple-400/50"}>
                    {hiringStage >= 1 ? "✓ " : "1. "}Persona Ready
                  </span>
                  <span className={hiringStage >= 2 ? "text-emerald-300" : "text-purple-400/50"}>
                    {hiringStage >= 2 ? "✓ " : "2. "}Tools Armed
                  </span>
                  <span className={hiringStage >= 3 ? "text-emerald-300" : "text-purple-400/50"}>
                    {hiringStage >= 3 ? "✓ " : "3. "}Plan Synthesized
                  </span>
                  <span className={hiringStage >= 4 ? "text-emerald-300" : "text-purple-400/50"}>
                    {hiringStage >= 4 ? "✓ " : "4. "}Dispatched
                  </span>
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2">
              <Textarea
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                placeholder="e.g. Find 15 roofing companies in Austin Texas that have poor websites. Analyze them, find their emails, select the best prospects, create personalized offers and prepare outreach..."
                className="bg-slate-950 text-white placeholder:text-slate-500 border-slate-700 text-sm resize-none h-20 sm:h-auto flex-1 focus:ring-purple-500"
              />
              <div className="flex sm:flex-col gap-2 shrink-0 justify-end">
                <Button
                  onClick={() => handleLaunchEmployee()}
                  disabled={isHiring}
                  className={`bg-purple-600 hover:bg-purple-500 text-white font-bold px-6 py-5 rounded-xl shadow-lg cursor-pointer h-full transition-all ${
                    isHiring ? "bg-purple-700 cursor-wait ring-2 ring-purple-400" : ""
                  }`}
                >
                  {isHiring ? (
                    <div className="flex flex-col items-center gap-1">
                      <span className="flex items-center gap-2 text-xs sm:text-sm">
                        <RefreshCw className="w-4 h-4 animate-spin text-purple-200" />
                        <span>Deploying Mission…</span>
                      </span>
                      <span className="text-[10px] text-purple-200 font-mono font-normal">Progress: {hiringPercent}%</span>
                    </div>
                  ) : (
                    <span className="flex items-center gap-2 text-sm sm:text-base">
                      <Play className="w-4 h-4 fill-white" />
                      <span>Hire / Run Employee</span>
                    </span>
                  )}
                </Button>
              </div>
            </div>

            {/* Example Prompts */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[11px] text-slate-400 font-medium">Quick goals:</span>
              {EXAMPLE_GOALS.map((ex, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setGoalInput(ex.goal);
                    setSelectedEmployeeId(ex.empId);
                    setAppliedGoalNotice(ex.title);
                    setTimeout(() => setAppliedGoalNotice(""), 2500);
                  }}
                  className={`text-[11px] px-2.5 py-1 rounded-md transition-all truncate max-w-xs text-left cursor-pointer border ${
                    appliedGoalNotice === ex.title
                      ? "bg-purple-700 text-white border-purple-400 ring-1 ring-purple-300"
                      : "bg-slate-800 hover:bg-slate-700 text-slate-300 border-white/5"
                  }`}
                >
                  {appliedGoalNotice === ex.title ? "✓ Loaded: " : ""}{ex.title}
                </button>
              ))}
            </div>

            {/* Budget & Safety Controls Accordion */}
            <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() => setShowLimits(!showLimits)}
                className="text-slate-400 hover:text-purple-300 flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Budget &amp; Safety Controls ({limits.maxBusinesses} leads cap, {limits.maxEmails} emails cap, {limits.maxAiCredits} credits)</span>
                {showLimits ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => setLimits({ ...limits, autoApprove: !limits.autoApprove })}
                className={`text-[11px] font-medium flex items-center gap-1.5 px-2.5 py-1 rounded-full cursor-pointer transition-colors ${
                  limits.autoApprove
                    ? "bg-purple-900/40 text-purple-300 border border-purple-500/30 hover:bg-purple-900/60"
                    : "bg-slate-800 text-slate-400 border border-slate-700 hover:text-white"
                }`}
              >
                <Sparkles className="w-3 h-3 text-purple-400" />
                <span>{limits.autoApprove ? "⚡ Autopilot Active (Continuous Run)" : "🛡️ Manual Review Pauses"}</span>
              </button>
            </div>

            {showLimits && (
              <div className="mt-3 p-3 bg-slate-950/60 rounded-lg border border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <label className="text-slate-400 block mb-1">Max Businesses</label>
                  <Input
                    type="number"
                    value={limits.maxBusinesses}
                    onChange={(e) => setLimits({ ...limits, maxBusinesses: Number(e.target.value) })}
                    className="bg-slate-900 border-slate-700 text-white h-8 text-xs"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Max Emails</label>
                  <Input
                    type="number"
                    value={limits.maxEmails}
                    onChange={(e) => setLimits({ ...limits, maxEmails: Number(e.target.value) })}
                    className="bg-slate-900 border-slate-700 text-white h-8 text-xs"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Max AI Credits</label>
                  <Input
                    type="number"
                    value={limits.maxAiCredits}
                    onChange={(e) => setLimits({ ...limits, maxAiCredits: Number(e.target.value) })}
                    className="bg-slate-900 border-slate-700 text-white h-8 text-xs"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Max Runtime (mins)</label>
                  <Input
                    type="number"
                    value={limits.maxRuntimeMinutes}
                    onChange={(e) => setLimits({ ...limits, maxRuntimeMinutes: Number(e.target.value) })}
                    className="bg-slate-900 border-slate-700 text-white h-8 text-xs"
                  />
                </div>
                <div className="col-span-2 sm:col-span-4 mt-2 pt-2 border-t border-slate-800 flex items-center justify-between">
                  <div>
                    <span className="text-white font-medium flex items-center gap-1.5 text-xs">
                      ⚡ Autopilot Mode (Zero-Pause Execution)
                    </span>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Auto-approves prepared cold emails so your employee executes the complete pipeline end-to-end without waiting for manual clicks.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLimits({ ...limits, autoApprove: !limits.autoApprove })}
                    className={`px-3 py-1 text-xs rounded-full font-bold cursor-pointer transition-colors ${
                      limits.autoApprove
                        ? "bg-purple-600 text-white hover:bg-purple-700"
                        : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    }`}
                  >
                    {limits.autoApprove ? "Autopilot ON" : "Manual Approval"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Missions Grid: Left Column Runs, Right Column Cockpit */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Column: Historical Runs */}
        <div className="lg:col-span-1 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-[#0B0F17] flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-purple-600" /> Employee Missions
            </h3>
            <Badge variant="outline" className="text-xs">{runs.length}</Badge>
          </div>

          <div className="space-y-2 max-h-[620px] overflow-y-auto pr-1">
            {runs.length === 0 ? (
              <div className="p-6 text-center bg-white rounded-xl border border-[#E4E2DD] text-xs text-slate-500">
                No missions yet. Enter a goal above to hire your AI Sales Employee.
              </div>
            ) : (
              runs.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedRunId(r.id)}
                  className={`w-full text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
                    selectedRunId === r.id
                      ? "bg-purple-50/70 border-purple-300 ring-2 ring-purple-400/40 shadow-sm"
                      : "bg-white border-[#E4E2DD] hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-purple-900">Mission #{r.id}</span>
                    {statusBadge(r.status)}
                  </div>
                  <p className="text-xs text-slate-700 font-medium line-clamp-2 leading-relaxed">
                    {r.goal}
                  </p>
                  <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-500">
                    <span>{new Date(r.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    <span className="font-semibold text-purple-700">{r.progress}% complete</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right Column: Active Cockpit */}
        <div className="lg:col-span-3 space-y-4">
          {currentRun ? (
            <div className="bg-white rounded-2xl border border-[#E4E2DD] shadow-sm p-6">
              {/* Header with Run Status & Controls */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E4E2DD]">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono font-bold text-purple-600 uppercase">Run #{currentRun.id}</span>
                    {statusBadge(currentRun.status)}
                  </div>
                  <h2 className="text-base sm:text-lg font-bold text-[#0B0F17]">{currentRun.goal}</h2>
                  <p className="text-xs text-slate-500 mt-0.5">{currentRun.currentTaskDescription || "Autonomous execution active"}</p>
                </div>

                {/* Interactive Controls */}
                <div className="flex items-center gap-2 shrink-0">
                  {currentRun.status === "EXECUTING" && (
                    <Button
                      onClick={handlePause}
                      disabled={isPausing}
                      variant="outline"
                      size="sm"
                      className="text-amber-700 border-amber-300 hover:bg-amber-50 cursor-pointer font-bold"
                    >
                      {isPausing ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" />
                          <span>Pausing…</span>
                        </>
                      ) : (
                        <>
                          <Pause className="w-3.5 h-3.5 mr-1" />
                          <span>Pause</span>
                        </>
                      )}
                    </Button>
                  )}
                  {(currentRun.status === "PAUSED" || currentRun.status === "WAITING_FOR_APPROVAL") && (
                    <Button
                      onClick={() => handleResume(true)}
                      disabled={isResuming}
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer font-bold shadow-xs"
                    >
                      {isResuming ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" />
                          <span>Resuming…</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 mr-1" />
                          <span>Resume Mission</span>
                        </>
                      )}
                    </Button>
                  )}
                  {currentRun.status !== "COMPLETED" && currentRun.status !== "CANCELLED" && (
                    <Button
                      onClick={handleCancel}
                      disabled={isCancelling}
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:bg-red-50 cursor-pointer font-bold"
                    >
                      {isCancelling ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" />
                          <span>Stopping…</span>
                        </>
                      ) : (
                        <>
                          <Square className="w-3.5 h-3.5 mr-1" />
                          <span>Cancel</span>
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
              <div className="my-4">
                <div className="flex justify-between text-xs font-semibold text-slate-600 mb-1.5">
                  <span>Overall Progress ({currentRun.currentTaskIndex} / {currentRun.totalTasks} tasks)</span>
                  <span className="text-purple-700 font-bold">{currentRun.progress}%</span>
                </div>
                <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden p-0.5 border border-slate-200">
                  <div
                    className={`h-full transition-all duration-500 rounded-full ${
                      currentRun.status === "COMPLETED"
                        ? "bg-emerald-500"
                        : currentRun.status === "WAITING_FOR_APPROVAL"
                        ? "bg-amber-500 animate-pulse"
                        : "bg-purple-600"
                    }`}
                    style={{ width: `${currentRun.progress}%` }}
                  />
                </div>
              </div>

              {/* Prominent Paused Notification Banner with 1-click Resume */}
              {currentRun.status === "PAUSED" && (
                <div className="my-4 p-4 rounded-xl bg-amber-50/90 border border-amber-300 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-amber-950">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-bold text-sm">
                        Mission Execution Paused {currentRun.error ? `— ${currentRun.error}` : ""}
                      </h4>
                      <p className="text-xs text-amber-800 mt-0.5">
                        Execution safely held. Click below to extend safety guardrails and continue processing automatically.
                      </p>
                    </div>
                  </div>
                  <Button
                    onClick={() => handleResume(true)}
                    disabled={isResuming}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-9 px-4 gap-2 cursor-pointer shadow-sm shrink-0"
                  >
                    {isResuming ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Resuming Mission…</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 fill-white" />
                        <span>Resume &amp; Extend (+50 Credits)</span>
                      </>
                    )}
                  </Button>
                </div>
              )}

              {/* Human Approval Required Alert Box */}
              {(Boolean(selectedApproval && selectedApproval.status === "pending") || currentRun.status === "WAITING_FOR_APPROVAL") && (
                <div className="my-4 p-4 rounded-xl bg-amber-50 border border-amber-300 shadow-sm">
                  <div className="flex items-start gap-3">
                    <ShieldAlert className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-sm text-amber-900">
                          {selectedApproval?.title || "Outreach Batch Prepared — Action Ready"}
                        </h4>
                        <Badge className="bg-amber-200 text-amber-800 text-[10px]">Action Paused For Approval</Badge>
                      </div>
                      <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                        {selectedApproval?.description || "Your autonomous employee prepared personalized outreach emails and is ready for your green light to dispatch."}
                      </p>

                      <div className="mt-3 flex items-center gap-2">
                        <Button
                          onClick={() => {
                            if (selectedApproval) {
                              handleResolveApproval(true);
                            } else {
                              handleResume(true);
                            }
                          }}
                          disabled={isApproving || isRejecting}
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
                        >
                          {isApproving ? (
                            <>
                              <RefreshCw className="w-4 h-4 mr-1 animate-spin" />
                              <span>Sending Outreach…</span>
                            </>
                          ) : (
                            <>
                              <Check className="w-4 h-4 mr-1" />
                              <span>Approve &amp; Send Outreach</span>
                            </>
                          )}
                        </Button>
                        <Button
                          onClick={() => handleResolveApproval(false)}
                          disabled={isApproving || isRejecting}
                          variant="outline"
                          size="sm"
                          className="text-red-700 border-red-300 hover:bg-red-50 cursor-pointer"
                        >
                          {isRejecting ? (
                            <>
                              <RefreshCw className="w-4 h-4 mr-1 animate-spin" />
                              <span>Rejecting…</span>
                            </>
                          ) : (
                            <>
                              <X className="w-4 h-4 mr-1" />
                              <span>Reject &amp; Skip</span>
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Real System Integrations & Health Bar */}
              <div className="mt-5 p-3 bg-gradient-to-r from-slate-900 to-slate-800 rounded-xl border border-slate-700/60 text-white shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex flex-wrap items-center gap-4">
                    {/* Hunter.io Status */}
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-slate-400">Hunter.io B2B Intelligence:</span>
                      {integrationsStatus?.hunter ? (
                        <span className="font-semibold text-emerald-300 flex items-center gap-1">
                          {integrationsStatus.hunter.configured ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Live API Connected ({integrationsStatus.hunter.keysCount} key{integrationsStatus.hunter.keysCount > 1 ? "s" : ""})</span>
                            </>
                          ) : (
                            <>
                              <ShieldCheck className="w-3.5 h-3.5 text-blue-300" />
                              <span>Local Scraper &amp; DNS MX Active (Fallback)</span>
                            </>
                          )}
                        </span>
                      ) : (
                        <span className="text-slate-400">Checking…</span>
                      )}
                    </div>

                    <div className="h-3 w-px bg-slate-700 hidden sm:block" />

                    {/* SMTP Pool Status */}
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-blue-400" />
                      <span className="text-slate-400">Rotational Multi-SMTP:</span>
                      {integrationsStatus?.smtp ? (
                        <span className="font-semibold text-blue-300 flex items-center gap-1">
                          <Server className="w-3.5 h-3.5 text-blue-400" />
                          <span>
                            {integrationsStatus.smtp.accountsCount > 0
                              ? `${integrationsStatus.smtp.accountsCount} Relay${integrationsStatus.smtp.accountsCount > 1 ? "s" : ""} Online (${integrationsStatus.smtp.activeRelay.split(" (")[0]})`
                              : "No SMTP configured"}
                          </span>
                        </span>
                      ) : (
                        <span className="text-slate-400">Checking…</span>
                      )}
                    </div>

                    <div className="h-3 w-px bg-slate-700 hidden sm:block" />

                    {/* Tracking Status */}
                    <div className="flex items-center gap-1.5 text-slate-300">
                      <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-[11px] text-slate-300">Open/Click Tracking &amp; Auto Failover: <strong className="text-emerald-400">Active</strong></span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => loadIntegrationsStatus()}
                    disabled={isLoadingIntegrations}
                    className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white transition-colors cursor-pointer ml-auto"
                    title="Refresh Hunter and SMTP connection status"
                  >
                    <RefreshCw className={`w-3 h-3 ${isLoadingIntegrations ? "animate-spin" : ""}`} />
                    <span>Diagnostics</span>
                  </button>
                </div>
              </div>

              {/* Navigation Tabs for Run */}
              <div className="flex flex-wrap items-center gap-2 border-b border-[#E4E2DD] mt-6 mb-4 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setActiveTab("activity")}
                  className={`pb-2.5 px-3 border-b-2 transition-colors cursor-pointer ${
                    activeTab === "activity" ? "border-purple-600 text-purple-700 font-bold" : "border-transparent text-slate-500"
                  }`}
                >
                  Live Activity ({events.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("tasks")}
                  className={`pb-2.5 px-3 border-b-2 transition-colors cursor-pointer ${
                    activeTab === "tasks" ? "border-purple-600 text-purple-700 font-bold" : "border-transparent text-slate-500"
                  }`}
                >
                  Task Pipeline ({tasks.length})
                </button>
                {(Boolean(currentRun.metadata?.discoveredBusinesses?.length) || Boolean(currentRun.summaryReport?.businessesFound)) && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("prospects")}
                    className={`pb-2.5 px-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
                      activeTab === "prospects" ? "border-purple-600 text-purple-700 font-bold" : "border-transparent text-slate-500"
                    }`}
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>Discovered Prospects ({currentRun.metadata?.discoveredBusinesses?.length || currentRun.summaryReport?.businessesFound || 0})</span>
                  </button>
                )}
                {Boolean(currentRun.metadata?.draftedEmails?.length) && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("outreach")}
                    className={`pb-2.5 px-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
                      activeTab === "outreach" ? "border-purple-600 text-purple-700 font-bold" : "border-transparent text-slate-500"
                    }`}
                  >
                    <Mail className="w-3.5 h-3.5" />
                    <span>Prepared Outreach ({currentRun.metadata.draftedEmails.length})</span>
                  </button>
                )}
                {(approvals.length > 0 || currentRun.status === "WAITING_FOR_APPROVAL") && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("approvals")}
                    className={`pb-2.5 px-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
                      activeTab === "approvals" ? "border-amber-600 text-amber-700 font-bold" : "border-transparent text-amber-600 font-semibold"
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                    <span>Approval Gate ({approvals.filter((a) => a.status === "pending").length})</span>
                  </button>
                )}
                {currentRun.summaryReport && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("report")}
                    className={`pb-2.5 px-3 border-b-2 transition-colors cursor-pointer ${
                      activeTab === "report" ? "border-purple-600 text-purple-700 font-bold" : "border-transparent text-slate-500"
                    }`}
                  >
                    Final Report
                  </button>
                )}
              </div>

              {/* TAB 1: Live Activity Stream */}
              {activeTab === "activity" && (
                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                  {events.length === 0 ? (
                    <div className="text-center p-8 text-xs text-slate-400">
                      Waiting for execution logs…
                    </div>
                  ) : (
                    events.map((ev) => (
                      <div
                        key={ev.id}
                        className={`p-3.5 rounded-xl border text-xs flex items-start gap-3 ${
                          ev.level === "thought"
                            ? "bg-purple-50/40 border-purple-200"
                            : ev.level === "tool_start"
                            ? "bg-blue-50/40 border-blue-200"
                            : ev.level === "tool_end"
                            ? "bg-emerald-50/40 border-emerald-200"
                            : ev.level === "approval_needed"
                            ? "bg-amber-50 border-amber-300"
                            : ev.level === "error"
                            ? "bg-red-50 border-red-200"
                            : "bg-white border-[#E4E2DD]"
                        }`}
                      >
                        <div className="mt-0.5">
                          {ev.level === "thought" && <Brain className="w-4 h-4 text-purple-600" />}
                          {ev.level === "tool_start" && <Sparkles className="w-4 h-4 text-blue-600" />}
                          {ev.level === "tool_end" && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                          {ev.level === "approval_needed" && <ShieldAlert className="w-4 h-4 text-amber-600" />}
                          {ev.level === "error" && <AlertCircle className="w-4 h-4 text-red-600" />}
                          {ev.level === "info" && <Clock className="w-4 h-4 text-slate-500" />}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-[#0B0F17]">{ev.title}</span>
                            <span className="text-[10px] text-slate-400">
                              {new Date(ev.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                            </span>
                          </div>
                          <p className="text-slate-600 mt-0.5 leading-relaxed">{ev.message}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* TAB 2: Task Pipeline */}
              {activeTab === "tasks" && (
                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                  {tasks.map((t) => (
                    <div key={t.id} className="border border-[#E4E2DD] rounded-xl overflow-hidden bg-white">
                      <div
                        onClick={() => toggleTask(t.id)}
                        className="p-3.5 flex items-center justify-between cursor-pointer hover:bg-slate-50/80 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-700">
                            {t.taskIndex}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-xs text-[#0B0F17]">{t.description}</span>
                              {t.requiresApproval && (
                                <Badge className="bg-amber-100 text-amber-800 text-[9px] border-amber-200">Approval Required</Badge>
                              )}
                            </div>
                            <span className="text-[11px] text-slate-400 font-mono">Tool: {t.tool}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {t.status === "completed" && <Badge className="bg-emerald-100 text-emerald-800 text-[10px]">✓ Done</Badge>}
                          {t.status === "running" && <Badge className="bg-blue-100 text-blue-800 text-[10px] animate-pulse">Running…</Badge>}
                          {t.status === "waiting_approval" && <Badge className="bg-amber-100 text-amber-800 text-[10px]">Waiting Approval</Badge>}
                          {t.status === "pending" && <Badge variant="outline" className="text-[10px] text-slate-400">Pending</Badge>}
                          {t.status === "failed" && <Badge className="bg-red-100 text-red-800 text-[10px]">Failed</Badge>}
                          {expandedTasks[t.id] ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                        </div>
                      </div>

                      {expandedTasks[t.id] && (
                        <div className="p-3 bg-slate-50 border-t border-[#E4E2DD] text-xs font-mono space-y-2">
                          {t.input && Object.keys(t.input).length > 0 && (
                            <div>
                              <span className="text-[10px] uppercase font-bold text-slate-500">Task Input:</span>
                              <pre className="bg-slate-900 text-slate-200 p-2.5 rounded-lg text-[11px] overflow-x-auto mt-1">
                                {JSON.stringify(t.input, null, 2)}
                              </pre>
                            </div>
                          )}
                          {t.output && Object.keys(t.output).length > 0 && (
                            <div>
                              <span className="text-[10px] uppercase font-bold text-slate-500">Task Output:</span>
                              <pre className="bg-slate-900 text-slate-200 p-2.5 rounded-lg text-[11px] overflow-x-auto mt-1">
                                {JSON.stringify(t.output, null, 2)}
                              </pre>
                            </div>
                          )}
                          {t.error && (
                            <div className="text-red-600 font-sans text-xs">
                              <strong>Error:</strong> {t.error}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* TAB 3: Discovered Prospects */}
              {activeTab === "prospects" && (
                <div className="space-y-4 animate-in fade-in">
                  {(() => {
                    const allProspects: any[] =
                      (Array.isArray(currentRun.metadata?.discoveredBusinesses) && currentRun.metadata.discoveredBusinesses.length > 0)
                        ? currentRun.metadata.discoveredBusinesses
                        : Array.isArray(currentRun.metadata?.qualifiedLeads)
                        ? currentRun.metadata.qualifiedLeads
                        : [];

                    const filteredProspects = allProspects.filter((biz) => {
                      if (prospectFilter === "hot") {
                        const score = Number(biz.apolloScore?.score ?? biz.apolloScore?.intentScore ?? 0);
                        return biz.apolloScore?.tier === "hot" || score >= 80;
                      }
                      if (prospectFilter === "verified") {
                        return Boolean(biz.email && biz.emailVerificationStatus === "deliverable");
                      }
                      return true;
                    });

                    return (
                      <div className="space-y-4">
                        {/* Prospects Control Bar */}
                        <div className="p-4 bg-slate-50/80 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                              <Users className="w-4 h-4 text-purple-600" />
                              <span>{allProspects.length} Discovered Leads</span>
                            </span>

                            {/* Filter Pills */}
                            <div className="flex items-center gap-1 ml-1 sm:ml-3">
                              <button
                                type="button"
                                onClick={() => setProspectFilter("all")}
                                className={`text-[11px] px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                                  prospectFilter === "all"
                                    ? "bg-purple-600 text-white shadow-xs"
                                    : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-100"
                                }`}
                              >
                                All ({allProspects.length})
                              </button>
                              <button
                                type="button"
                                onClick={() => setProspectFilter("hot")}
                                className={`text-[11px] px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer flex items-center gap-1 ${
                                  prospectFilter === "hot"
                                    ? "bg-amber-600 text-white shadow-xs"
                                    : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-100"
                                }`}
                              >
                                <Flame className="w-3 h-3 text-amber-500 fill-amber-500" />
                                <span>High Intent (Score 80+)</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setProspectFilter("verified")}
                                className={`text-[11px] px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer flex items-center gap-1 ${
                                  prospectFilter === "verified"
                                    ? "bg-emerald-600 text-white shadow-xs"
                                    : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-100"
                                }`}
                              >
                                <ShieldCheck className="w-3 h-3 text-emerald-500" />
                                <span>Verified Email</span>
                              </button>
                            </div>
                          </div>

                          {/* Export All Leads Action */}
                          {allProspects.length > 0 && (
                            <Button
                              size="sm"
                              type="button"
                              disabled={isExporting}
                              onClick={() => handleExportToCrm(allProspects)}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold gap-1.5 cursor-pointer shadow-xs shrink-0 h-8"
                            >
                              {isExporting ? (
                                <>
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                  <span>Exporting to CRM…</span>
                                </>
                              ) : (
                                <>
                                  <span>📥</span>
                                  <span>Export All {allProspects.length} Leads to CRM</span>
                                </>
                              )}
                            </Button>
                          )}
                        </div>

                        {/* Prospects Grid */}
                        {filteredProspects.length === 0 ? (
                          <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-300 text-xs text-slate-500">
                            {allProspects.length === 0
                              ? "No prospects discovered yet for this mission. Check Task Pipeline or Activity tab."
                              : "No leads match the selected filter."}
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 max-h-[580px] overflow-y-auto pr-1">
                            {filteredProspects.map((biz: any, bIdx: number) => {
                              const bNameLower = (biz.businessName || "").toLowerCase();
                              const isAlreadySaved = savedLeadNames.has(bNameLower);
                              const isThisExporting = exportingLeadId === bNameLower;
                              const isCopied = copiedLeadKey === bNameLower;
                              const apolloScoreVal = Number(biz.apolloScore?.score ?? biz.apolloScore?.intentScore ?? 0);
                              const isHot = biz.apolloScore?.tier === "hot" || apolloScoreVal >= 80;

                              return (
                                <div
                                  key={bIdx}
                                  className="p-4 bg-white rounded-xl border border-slate-200 text-xs space-y-2.5 shadow-xs hover:border-purple-300 transition-all flex flex-col justify-between"
                                >
                                  <div>
                                    {/* Header Row */}
                                    <div className="flex items-start justify-between gap-2 pb-2 border-b border-slate-100">
                                      <div className="min-w-0">
                                        <h4 className="font-extrabold text-[#0B0F17] text-sm truncate">
                                          {biz.businessName}
                                        </h4>
                                        <div className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                                          <span className="font-medium text-purple-700">{biz.category || "Commercial"}</span>
                                          <span>•</span>
                                          <span>{biz.city || "Austin"}, {biz.country || "USA"}</span>
                                        </div>
                                      </div>

                                      {/* Apollo Intent Score Badge */}
                                      {biz.apolloScore && (
                                        <Badge
                                          className={`text-[10px] px-2 py-0.5 font-bold shrink-0 flex items-center gap-1 border ${
                                            isHot
                                              ? "bg-amber-50 text-amber-900 border-amber-300"
                                              : "bg-blue-50 text-blue-900 border-blue-300"
                                          }`}
                                        >
                                          {isHot ? <Flame className="w-3 h-3 text-amber-500 fill-amber-500" /> : <Sparkles className="w-3 h-3 text-blue-500" />}
                                          <span>{isHot ? "HOT" : "WARM"} · {apolloScoreVal || 80}/100</span>
                                        </Badge>
                                      )}
                                    </div>

                                    {/* Contact Channels */}
                                    <div className="space-y-1.5 pt-2 text-[11px]">
                                      {biz.website && (
                                        <div className="flex items-center gap-1.5 text-blue-600">
                                          <Globe className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                                          <a
                                            href={biz.website.startsWith("http") ? biz.website : `https://${biz.website}`}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="hover:underline truncate"
                                          >
                                            {biz.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                                          </a>
                                          <ExternalLink className="w-3 h-3 shrink-0 text-slate-400" />
                                        </div>
                                      )}

                                      {biz.email ? (
                                        <div className="flex items-center justify-between gap-1 text-slate-700 font-mono text-[11px]">
                                          <span className="flex items-center gap-1.5 truncate">
                                            <Mail className="w-3.5 h-3.5 shrink-0 text-purple-600" />
                                            <span className="truncate">{biz.email}</span>
                                          </span>
                                          {biz.emailVerificationStatus === "deliverable" && (
                                            <span className="text-[9px] font-sans font-bold px-1.5 py-0.2 bg-emerald-100 text-emerald-800 rounded shrink-0 flex items-center gap-0.5">
                                              <ShieldCheck className="w-2.5 h-2.5" /> Deliverable
                                            </span>
                                          )}
                                        </div>
                                      ) : (
                                        <div className="text-slate-400 italic text-[10px] flex items-center gap-1">
                                          <Mail className="w-3 h-3" /> Email pending contact enrichment
                                        </div>
                                      )}

                                      {biz.phone && (
                                        <div className="flex items-center gap-1.5 text-slate-600">
                                          <Phone className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                                          <span>{biz.phone}</span>
                                        </div>
                                      )}

                                      {biz.ownerName && (
                                        <div className="text-[10px] text-slate-500 font-medium">
                                          Decision Maker: <span className="text-slate-700 font-bold">{biz.ownerName}</span> {biz.ownerRole ? `(${biz.ownerRole})` : ""}
                                        </div>
                                      )}
                                    </div>

                                    {/* Tech & Gaps Diagnostics */}
                                    {(biz.cmsPlatform || Array.isArray(biz.apolloScore?.reasons)) && (
                                      <div className="mt-2.5 pt-2 border-t border-slate-100 flex flex-wrap gap-1">
                                        {biz.cmsPlatform && (
                                          <span className="text-[9px] font-mono px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded border border-slate-200">
                                            CMS: {biz.cmsPlatform}
                                          </span>
                                        )}
                                        {Array.isArray(biz.apolloScore?.reasons) &&
                                          biz.apolloScore.reasons.slice(0, 2).map((r: string, rIdx: number) => (
                                            <span
                                              key={rIdx}
                                              className="text-[9px] px-1.5 py-0.5 bg-purple-50 text-purple-800 rounded border border-purple-200 truncate max-w-[200px]"
                                            >
                                              {r}
                                            </span>
                                          ))}
                                      </div>
                                    )}
                                  </div>

                                  {/* Card Actions */}
                                  <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const text = `${biz.businessName}\nWebsite: ${biz.website || "N/A"}\nEmail: ${biz.email || "N/A"}\nPhone: ${biz.phone || "N/A"}\nDecision Maker: ${biz.ownerName || "N/A"}`;
                                        navigator.clipboard.writeText(text);
                                        setCopiedLeadKey(bNameLower);
                                        setActionNotice(`Copied intel for ${biz.businessName}!`);
                                        setTimeout(() => {
                                          setCopiedLeadKey(null);
                                          setActionNotice("");
                                        }, 2500);
                                      }}
                                      className="text-[10px] text-slate-500 hover:text-purple-700 flex items-center gap-1 font-semibold cursor-pointer"
                                    >
                                      {isCopied ? (
                                        <>
                                          <CheckCheck className="w-3 h-3 text-emerald-600" />
                                          <span className="text-emerald-700">Copied!</span>
                                        </>
                                      ) : (
                                        <>
                                          <Copy className="w-3 h-3" />
                                          <span>Copy Intel</span>
                                        </>
                                      )}
                                    </button>

                                    <Button
                                      size="sm"
                                      type="button"
                                      disabled={isThisExporting || isAlreadySaved}
                                      onClick={() => handleExportSingleLead(biz)}
                                      className={`h-7 text-[10px] font-bold px-2.5 rounded-lg transition-all cursor-pointer ${
                                        isAlreadySaved
                                          ? "bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100"
                                          : "bg-purple-600 hover:bg-purple-700 text-white shadow-xs"
                                      }`}
                                    >
                                      {isThisExporting ? (
                                        <span className="flex items-center gap-1">
                                          <RefreshCw className="w-3 h-3 animate-spin" /> Exporting…
                                        </span>
                                      ) : isAlreadySaved ? (
                                        <span className="flex items-center gap-1">
                                          <Check className="w-3 h-3 text-emerald-600" /> In CRM
                                        </span>
                                      ) : (
                                        <span>+ Export to CRM</span>
                                      )}
                                    </Button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* TAB 4: Human-in-the-Loop Approval Gate */}
              {activeTab === "approvals" && (
                <div className="space-y-4 animate-in fade-in">
                  <div className="p-4 bg-amber-50/80 rounded-xl border border-amber-300 flex items-start justify-between gap-3 text-amber-950">
                    <div className="flex items-start gap-3">
                      <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <h4 className="font-extrabold text-sm text-amber-900">
                          Human-in-the-Loop Safety Gate Active
                        </h4>
                        <p className="text-xs text-amber-800 mt-0.5 leading-relaxed">
                          Your AI Sales Employee will never send unauthorized external outreach or publish actions without your review and approval.
                        </p>
                      </div>
                    </div>
                    <Badge className="bg-amber-200 text-amber-900 border-amber-300 text-[10px] shrink-0 font-bold">
                      {approvals.filter((a) => a.status === "pending").length} Action Pending
                    </Badge>
                  </div>

                  {/* Active Pending Approval Card */}
                  {selectedApproval && selectedApproval.status === "pending" ? (
                    <div className="p-5 bg-white rounded-xl border-2 border-amber-400 shadow-md space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-extrabold text-base text-[#0B0F17]">
                              {selectedApproval.title}
                            </h3>
                            <Badge className="bg-amber-500 text-white text-[10px] animate-pulse">
                              Awaiting Your Sign-Off
                            </Badge>
                          </div>
                          <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                            {selectedApproval.description}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            onClick={() => handleResolveApproval(true)}
                            disabled={isApproving || isRejecting}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-9 px-4 gap-1.5 cursor-pointer shadow-sm"
                          >
                            {isApproving ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                <span>Authorizing &amp; Dispatching…</span>
                              </>
                            ) : (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                <span>Approve &amp; Send Outreach</span>
                              </>
                            )}
                          </Button>

                          <Button
                            onClick={() => handleResolveApproval(false)}
                            disabled={isApproving || isRejecting}
                            variant="outline"
                            className="text-red-700 border-red-300 hover:bg-red-50 font-bold text-xs h-9 px-3 gap-1.5 cursor-pointer"
                          >
                            {isRejecting ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                <span>Rejecting…</span>
                              </>
                            ) : (
                              <>
                                <X className="w-3.5 h-3.5" />
                                <span>Reject &amp; Skip</span>
                              </>
                            )}
                          </Button>
                        </div>
                      </div>

                      {/* Prepared Email Previews to be Approved */}
                      {Array.isArray(selectedApproval.proposedPayload?.emails) && (
                        <div className="space-y-3">
                          <span className="text-xs font-bold uppercase tracking-wider text-slate-700 block">
                            Outreach Sequence ({selectedApproval.proposedPayload.emails.length} Emails Prepared):
                          </span>
                          <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                            {selectedApproval.proposedPayload.emails.map((em: any, emIdx: number) => (
                              <div key={emIdx} className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1.5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-bold text-[#0B0F17]">{em.businessName}</span>
                                  <span className="text-[11px] font-mono text-purple-700">{em.to}</span>
                                </div>
                                <div className="font-semibold text-slate-800">
                                  Subject: <span className="font-normal text-slate-700">{em.subject}</span>
                                </div>
                                <div className="p-2.5 bg-white rounded-lg border border-slate-200 text-[11px] text-slate-700 whitespace-pre-wrap leading-relaxed max-h-24 overflow-y-auto font-sans">
                                  {em.bodyText}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="p-8 text-center bg-white rounded-xl border border-slate-200 text-xs text-slate-500">
                      <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-2">
                        <CheckCircle2 className="w-5 h-5" />
                      </div>
                      <h4 className="font-bold text-slate-800 text-sm">All Approvals Clear</h4>
                      <p className="mt-1 text-slate-500 max-w-sm mx-auto">
                        No pending actions require sign-off right now. When your AI Employee synthesizes external outreach, it will prompt you here before sending.
                      </p>
                    </div>
                  )}

                  {/* Historical Approvals Audit Log */}
                  {approvals.length > 0 && (
                    <div className="pt-3 border-t border-slate-200 space-y-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-600 block">
                        Approval Audit Log ({approvals.length}):
                      </span>
                      <div className="space-y-2 max-h-48 overflow-y-auto pr-1 text-xs">
                        {approvals.map((app) => (
                          <div
                            key={app.id}
                            className="p-3 bg-white rounded-lg border border-slate-200 flex items-center justify-between text-xs"
                          >
                            <div>
                              <div className="font-bold text-[#0B0F17] flex items-center gap-1.5">
                                <span>{app.title}</span>
                                <Badge
                                  className={`text-[9px] px-1.5 py-0 ${
                                    app.status === "approved"
                                      ? "bg-emerald-100 text-emerald-800"
                                      : app.status === "rejected"
                                      ? "bg-red-100 text-red-800"
                                      : "bg-amber-100 text-amber-800"
                                  }`}
                                >
                                  {app.status.toUpperCase()}
                                </Badge>
                              </div>
                              <span className="text-[10px] text-slate-400">
                                {new Date(app.createdAt).toLocaleString()}
                              </span>
                            </div>
                            {app.userNote && (
                              <span className="text-[11px] text-slate-500 italic">
                                Note: {app.userNote}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {activeTab === "report" && currentRun.summaryReport && (
                <div className="p-6 bg-slate-50 rounded-xl border border-slate-200 space-y-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-emerald-100 text-emerald-700 rounded-xl">
                      <CheckCircle2 className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-extrabold text-base text-[#0B0F17]">MISSION COMPLETED</h3>
                      <p className="text-xs text-slate-500">Full structured metrics synthesized from your AI Sales Employee run.</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="p-3 bg-white rounded-xl border border-slate-200">
                      <span className="text-slate-400 block mb-0.5">Businesses found:</span>
                      <span className="text-xl font-extrabold text-[#0B0F17]">{currentRun.summaryReport.businessesFound}</span>
                    </div>
                    <div className="p-3 bg-white rounded-xl border border-slate-200">
                      <span className="text-slate-400 block mb-0.5">Businesses analyzed:</span>
                      <span className="text-xl font-extrabold text-[#0B0F17]">{currentRun.summaryReport.businessesAnalyzed}</span>
                    </div>
                    <div className="p-3 bg-white rounded-xl border border-slate-200">
                      <span className="text-slate-400 block mb-0.5">Qualified prospects:</span>
                      <span className="text-xl font-extrabold text-purple-700">{currentRun.summaryReport.qualifiedProspects}</span>
                    </div>
                    <div className="p-3 bg-white rounded-xl border border-slate-200">
                      <span className="text-slate-400 block mb-0.5">Emails found:</span>
                      <span className="text-xl font-extrabold text-blue-700">{currentRun.summaryReport.emailsFound}</span>
                    </div>
                    <div className="p-3 bg-white rounded-xl border border-slate-200">
                      <span className="text-slate-400 block mb-0.5">Offers created:</span>
                      <span className="text-xl font-extrabold text-[#0B0F17]">{currentRun.summaryReport.offersCreated}</span>
                    </div>
                    <div className="p-3 bg-white rounded-xl border border-slate-200">
                      <span className="text-slate-400 block mb-0.5">Messages prepared:</span>
                      <span className="text-xl font-extrabold text-[#0B0F17]">{currentRun.summaryReport.messagesPrepared}</span>
                    </div>
                    <div className="p-3 bg-white rounded-xl border border-slate-200">
                      <span className="text-slate-400 block mb-0.5">Messages sent:</span>
                      <span className="text-xl font-extrabold text-emerald-700">{currentRun.summaryReport.messagesSent}</span>
                    </div>
                    <div className="p-3 bg-white rounded-xl border border-slate-200">
                      <span className="text-slate-400 block mb-0.5">Estimated AI cost:</span>
                      <span className="text-xl font-extrabold text-slate-700">${currentRun.summaryReport.estimatedAiCostUsd}</span>
                    </div>
                  </div>

                  {/* Email Deliverability & Performance Analysis */}
                  {Boolean(currentRun.summaryReport?.emailDeliveryAnalysis || currentRun.summaryReport?.messagesSent !== undefined) && (() => {
                    const analysis = currentRun.summaryReport?.emailDeliveryAnalysis;
                    const sentEmails = analysis?.sentEmails || currentRun.metadata?.sentEmails || [];
                    const failedEmails = analysis?.failedEmails || currentRun.metadata?.failedEmails || [];
                    const deliveryRate = analysis?.deliveryRate ?? (
                      (sentEmails.length + failedEmails.length) > 0
                        ? Math.round((sentEmails.length / (sentEmails.length + failedEmails.length)) * 100)
                        : 100
                    );
                    const smtpsUsed = analysis?.smtpAccountsUsed || [];
                    const hunter = currentRun.summaryReport?.hunterIntel || (integrationsStatus?.hunter ? {
                      connected: integrationsStatus.hunter.configured,
                      activeKeysCount: integrationsStatus.hunter.keysCount,
                      provider: integrationsStatus.hunter.provider,
                      enrichedEmailsCount: currentRun.summaryReport?.emailsFound || 0,
                    } : null);

                    return (
                      <div className="pt-4 border-t border-slate-200 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="p-1.5 bg-blue-100 text-blue-700 rounded-lg">
                              <Mail className="w-4 h-4" />
                            </span>
                            <div>
                              <h4 className="font-extrabold text-sm text-[#0B0F17]">Email Deliverability &amp; Multi-SMTP Relay Analysis</h4>
                              <p className="text-[11px] text-slate-500">Live verification, rotational sender relay logs, and delivery failure diagnostic telemetry.</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge className={`text-xs px-2.5 py-1 font-bold ${
                              deliveryRate >= 80 ? "bg-emerald-100 text-emerald-800 border-emerald-300" :
                              deliveryRate >= 50 ? "bg-amber-100 text-amber-800 border-amber-300" :
                              "bg-red-100 text-red-800 border-red-300"
                            }`}>
                              {deliveryRate}% Delivery Rate
                            </Badge>
                          </div>
                        </div>

                        {retryFeedback && (
                          <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl text-xs text-purple-800 flex items-center justify-between">
                            <span>{retryFeedback}</span>
                            <button type="button" onClick={() => setRetryFeedback("")} className="text-purple-600 hover:text-purple-900 font-bold ml-2">×</button>
                          </div>
                        )}

                        {/* Top deliverability stat cards */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                          <div className="p-3 bg-white rounded-xl border border-slate-200">
                            <span className="text-slate-400 block mb-0.5">Dispatched &amp; Delivered:</span>
                            <span className="text-xl font-extrabold text-emerald-600 flex items-center gap-1">
                              <CheckCheck className="w-5 h-5 text-emerald-500" />
                              <span>{sentEmails.length}</span>
                            </span>
                          </div>
                          <div className="p-3 bg-white rounded-xl border border-slate-200">
                            <span className="text-slate-400 block mb-0.5">Failed / Filtered:</span>
                            <span className="text-xl font-extrabold text-red-600 flex items-center gap-1">
                              <AlertCircle className="w-5 h-5 text-red-500" />
                              <span>{failedEmails.length}</span>
                            </span>
                          </div>
                          <div className="p-3 bg-white rounded-xl border border-slate-200">
                            <span className="text-slate-400 block mb-0.5">Hunter.io Intelligence:</span>
                            <span className="text-xs font-bold text-slate-800 block truncate mt-1">
                              {hunter?.connected ? (
                                <span className="text-emerald-700 flex items-center gap-1">
                                  <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Live API Connected
                                </span>
                              ) : (
                                <span className="text-blue-700 flex items-center gap-1">
                                  <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Local Scraper &amp; MX Active
                                </span>
                              )}
                            </span>
                            <span className="text-[10px] text-slate-400 block mt-0.5">{hunter?.enrichedEmailsCount || currentRun.summaryReport?.emailsFound || 0} emails verified</span>
                          </div>
                          <div className="p-3 bg-white rounded-xl border border-slate-200">
                            <span className="text-slate-400 block mb-0.5">Rotational Relays Used:</span>
                            <span className="text-xs font-bold text-slate-800 block truncate mt-1">
                              {smtpsUsed.length > 0 ? smtpsUsed[0] : (integrationsStatus?.smtp?.activeRelay || "Primary Brevo Relay")}
                            </span>
                            <span className="text-[10px] text-slate-400 block mt-0.5">Auto Failover Enabled</span>
                          </div>
                        </div>

                        {/* Delivered emails list */}
                        {sentEmails.length > 0 && (
                          <div className="space-y-2">
                            <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 flex items-center gap-1.5">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              Successfully Delivered Outreach ({sentEmails.length}):
                            </span>
                            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                              {sentEmails.map((item: any, sIdx: number) => (
                                <div key={sIdx} className="p-3 bg-emerald-50/50 rounded-xl border border-emerald-200 text-xs space-y-1">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="font-bold text-emerald-950 flex items-center gap-1.5">
                                      <span>📧 {item.to}</span>
                                      {item.businessName && <span className="text-slate-500 font-normal">({item.businessName})</span>}
                                    </div>
                                    <Badge className="bg-emerald-100 text-emerald-800 text-[10px] px-2 py-0.5 font-bold">
                                      250 DELIVERED
                                    </Badge>
                                  </div>
                                  <div className="text-[11px] text-slate-600 flex flex-wrap items-center gap-x-4 gap-y-1">
                                    <span><strong>Subject:</strong> {item.subject}</span>
                                    <span><strong>Relay:</strong> {item.sentVia || item.host || "Brevo SMTP"}</span>
                                    {item.trackingId && (
                                      <span className="font-mono text-[10px] text-blue-700 bg-blue-50 px-1.5 py-0.2 rounded border border-blue-200">
                                        Tracking: {String(item.trackingId).slice(0, 14)}…
                                      </span>
                                    )}
                                    {item.deliveredAt && (
                                      <span className="text-slate-400 text-[10px]">
                                        {new Date(item.deliveredAt).toLocaleTimeString()}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Failed or skipped emails list with diagnostics */}
                        {failedEmails.length > 0 && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold uppercase tracking-wider text-red-800 flex items-center gap-1.5">
                                <AlertCircle className="w-3.5 h-3.5 text-red-600" />
                                Delivery Failures &amp; Diagnostic Root Causes ({failedEmails.length}):
                              </span>
                              <Button
                                size="sm"
                                variant="outline"
                                type="button"
                                disabled={Boolean(retryingEmail)}
                                onClick={() => handleRetryFailedEmail(currentRun.id)}
                                className="h-7 text-xs border-red-200 text-red-700 hover:bg-red-50 cursor-pointer"
                              >
                                {retryingEmail === "all" ? (
                                  <>
                                    <RefreshCw className="w-3 h-3 animate-spin mr-1" />
                                    <span>Retrying…</span>
                                  </>
                                ) : (
                                  <>
                                    <RefreshCw className="w-3 h-3 mr-1" />
                                    <span>Retry All Dispatchable</span>
                                  </>
                                )}
                              </Button>
                            </div>
                            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                              {failedEmails.map((item: any, fIdx: number) => (
                                <div key={fIdx} className="p-3 bg-red-50/60 rounded-xl border border-red-200 text-xs space-y-1.5">
                                  <div className="flex items-start justify-between gap-2">
                                    <div>
                                      <span className="font-bold text-red-950 block">❌ {item.to}</span>
                                      {item.businessName && <span className="text-[11px] text-slate-600">{item.businessName}</span>}
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      <Badge className="bg-red-100 text-red-800 text-[10px] px-2 py-0.5 font-bold">
                                        {item.category || "Relay Failure"}
                                      </Badge>
                                      {item.to && !item.to.includes("example.com") && (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          type="button"
                                          disabled={retryingEmail === item.to}
                                          onClick={() => handleRetryFailedEmail(currentRun.id, item.to)}
                                          className="h-6 text-[10px] px-2 text-purple-700 hover:bg-purple-100 cursor-pointer"
                                        >
                                          {retryingEmail === item.to ? "Retrying…" : "Retry Send"}
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                  <div className="text-[11px] text-red-900 bg-white/70 p-2 rounded-lg border border-red-100">
                                    <p><strong>Reason:</strong> {item.reason}</p>
                                    {item.troubleshooting && (
                                      <p className="mt-1 text-slate-600"><strong>Troubleshooting advice:</strong> {item.troubleshooting}</p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Discovered & Qualified Prospects List */}
                  {Array.isArray(currentRun.metadata?.discoveredBusinesses) && currentRun.metadata.discoveredBusinesses.length > 0 && (
                    <div className="pt-4 border-t border-slate-200 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-700 block">
                          Discovered &amp; Scored Prospects ({currentRun.metadata.discoveredBusinesses.length}):
                        </span>
                        <Button
                          size="sm"
                          type="button"
                          disabled={isExporting}
                          onClick={() => handleExportToCrm(currentRun.metadata.discoveredBusinesses)}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold gap-1.5 cursor-pointer shadow-xs"
                        >
                          {isExporting ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              <span>Exporting to CRM…</span>
                            </>
                          ) : (
                            <>
                              <span>📥</span>
                              <span>Export All {currentRun.metadata.discoveredBusinesses.length} Leads to CRM</span>
                            </>
                          )}
                        </Button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-72 overflow-y-auto pr-1">
                        {currentRun.metadata.discoveredBusinesses.slice(0, 10).map((biz: any, bIdx: number) => (
                          <div key={bIdx} className="p-3 bg-white rounded-xl border border-slate-200 text-xs space-y-1.5 shadow-xs">
                            <div className="flex items-start justify-between gap-1">
                              <div>
                                <span className="font-bold text-slate-900 block truncate">{biz.businessName}</span>
                                <span className="text-[11px] text-slate-500">{biz.city || "Austin"}, {biz.country || "USA"}</span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {biz.apolloScore?.tier && (
                                  <Badge className={`text-[10px] px-1.5 py-0.2 ${biz.apolloScore.tier === "hot" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"}`}>
                                    {biz.apolloScore.tier.toUpperCase()} · {biz.apolloScore.score || biz.apolloScore.intentScore || 80}/100
                                  </Badge>
                                )}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  type="button"
                                  onClick={() => handleExportToCrm([biz])}
                                  className="h-6 text-[10px] px-2 text-purple-700 border-purple-200 hover:bg-purple-50 cursor-pointer"
                                  title="Export to CRM Prospects"
                                >
                                  + CRM
                                </Button>
                              </div>
                            </div>
                            <div className="text-[11px] text-slate-600 space-y-0.5">
                              {biz.website && (
                                <a href={biz.website} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline truncate block">
                                  {biz.website.replace(/^https?:\/\//, "")}
                                </a>
                              )}
                              {biz.email && <div className="text-slate-700 font-mono text-[10px]">📧 {biz.email}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Deep links to existing Hunter sections */}
                  <div className="pt-4 border-t border-slate-200">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block mb-3">
                      Inspect Results in Existing Hunter Tools:
                    </span>
                    <div className="flex flex-wrap gap-2.5">
                      <Button
                        type="button"
                        onClick={() => {
                          if (onNavigateTab) onNavigateTab("prospects");
                          else setLocation("/crm");
                        }}
                        className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold gap-1.5 cursor-pointer"
                      >
                        <Users className="w-3.5 h-3.5" /> View Leads in CRM
                      </Button>
                      <Button
                        type="button"
                        onClick={() => {
                          if (onNavigateTab) onNavigateTab("automation");
                          else setLocation("/crm");
                        }}
                        variant="outline"
                        className="text-xs font-bold gap-1.5 cursor-pointer"
                      >
                        <BarChart3 className="w-3.5 h-3.5" /> View Automation &amp; Follow-ups
                      </Button>
                      <Button
                        type="button"
                        onClick={() => {
                          if (onNavigateTab) onNavigateTab("inbox");
                          else setLocation("/crm");
                        }}
                        variant="outline"
                        className="text-xs font-bold gap-1.5 cursor-pointer"
                      >
                        <Mail className="w-3.5 h-3.5" /> View Messages in Inbox
                      </Button>
                      <Button
                        type="button"
                        onClick={() => {
                          if (onNavigateTab) onNavigateTab("website-builder");
                          else setLocation("/crm");
                        }}
                        variant="outline"
                        className="text-xs font-bold gap-1.5 cursor-pointer"
                      >
                        <Globe className="w-3.5 h-3.5" /> View Generated Websites
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: Prepared Outreach Sequence */}
              {activeTab === "outreach" && (
                <div className="space-y-4">
                  {(!currentRun.metadata?.draftedEmails || currentRun.metadata.draftedEmails.length === 0) ? (
                    <div className="text-center p-8 text-xs text-slate-400">
                      No outreach emails drafted yet for this mission.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-700">
                          {currentRun.metadata.draftedEmails.length} Personalized Emails Formulated
                        </span>
                        {selectedApproval && selectedApproval.status === "pending" && (
                          <Button
                            size="sm"
                            disabled={isApproving || isRejecting}
                            onClick={() => handleResolveApproval(true)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs cursor-pointer"
                          >
                            {isApproving ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" />
                                <span>Sending Outreach…</span>
                              </>
                            ) : (
                              <>
                                <Check className="w-3.5 h-3.5 mr-1" />
                                <span>Approve &amp; Send All</span>
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                      {currentRun.metadata.draftedEmails.map((em: any, idx: number) => (
                        <div key={idx} className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2 text-xs">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-200">
                            <div>
                              <span className="font-extrabold text-[#0B0F17] text-sm block">{em.businessName}</span>
                              <span className="text-slate-500 font-mono text-[11px]">To: {em.to}</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                              {em.siteUrl && (
                                <a
                                  href={em.siteUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-300 px-2.5 py-1 rounded-md font-bold text-[11px] flex items-center gap-1 shadow-xs transition-colors"
                                >
                                  <span>Live Website</span>
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                              {em.reviewUrl && (
                                <a
                                  href={em.reviewUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-300 px-2.5 py-1 rounded-md font-bold text-[11px] flex items-center gap-1 shadow-xs transition-colors"
                                >
                                  <span>5★ Review Shield</span>
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                              {em.reportUrl && (
                                <a
                                  href={em.reportUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-purple-600 hover:underline font-semibold text-[11px] flex items-center gap-1"
                                >
                                  <span>View Audit</span>
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  navigator.clipboard.writeText(`Subject: ${em.subject}\n\n${em.bodyText || ""}`);
                                  setActionNotice("Email copy copied to clipboard!");
                                  setTimeout(() => setActionNotice(""), 3000);
                                }}
                                className="h-7 text-[11px] gap-1 cursor-pointer"
                              >
                                <Copy className="w-3 h-3" /> Copy
                              </Button>
                            </div>
                          </div>
                          <div>
                            <span className="font-bold text-slate-800">Subject: </span>
                            <span className="text-slate-700 font-medium">{em.subject}</span>
                          </div>
                          <div className="p-3 bg-white rounded-lg border border-slate-200 whitespace-pre-wrap text-slate-700 font-sans leading-relaxed">
                            {em.bodyText}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="p-12 text-center bg-white rounded-2xl border border-[#E4E2DD]">
              <Bot className="w-12 h-12 text-purple-400 mx-auto mb-3" />
              <h3 className="font-bold text-base text-[#0B0F17]">No Mission Selected</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                Choose a mission from the list on the left, or launch a new mission above using natural language.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
