import React, { useState, useEffect } from "react";
import { Sparkles, ArrowRight, X, AlertTriangle, ShieldCheck, Zap, Users, Globe } from "lucide-react";

export interface UpgradeModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  limitType?: "monthly_hunt" | "ai_employee" | "website_builder" | "general";
  planId?: string;
  planName?: string;
  used?: number;
  limit?: number;
  message?: string;
}

export interface UpgradeEventDetail {
  limitType?: "monthly_hunt" | "ai_employee" | "website_builder" | "general";
  planId?: string;
  planName?: string;
  used?: number;
  limit?: number;
  message?: string;
}

export function triggerUpgradeModal(detail?: UpgradeEventDetail) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("open-upgrade-modal", { detail }));
  }
}

export default function UpgradeModal({
  isOpen: propIsOpen,
  onClose: propOnClose,
  limitType: propLimitType,
  planId: propPlanId,
  planName: propPlanName,
  used: propUsed,
  limit: propLimit,
  message: propMessage,
}: UpgradeModalProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [modalData, setModalData] = useState<UpgradeEventDetail>({
    limitType: propLimitType || "monthly_hunt",
    planId: propPlanId || "free",
    planName: propPlanName || "Free Explorer",
    used: propUsed || 50,
    limit: propLimit || 50,
    message: propMessage || "",
  });

  useEffect(() => {
    if (propIsOpen !== undefined) {
      setInternalOpen(propIsOpen);
      setModalData({
        limitType: propLimitType || "monthly_hunt",
        planId: propPlanId || "free",
        planName: propPlanName || "Free Explorer",
        used: propUsed ?? 50,
        limit: propLimit ?? 50,
        message: propMessage || "",
      });
    }
  }, [propIsOpen, propLimitType, propPlanId, propPlanName, propUsed, propLimit, propMessage]);

  useEffect(() => {
    const handleEvent = (event: Event) => {
      const customEvent = event as CustomEvent<UpgradeEventDetail>;
      if (customEvent.detail) {
        setModalData((prev) => ({ ...prev, ...customEvent.detail }));
      }
      setInternalOpen(true);
    };

    window.addEventListener("open-upgrade-modal", handleEvent);
    return () => {
      window.removeEventListener("open-upgrade-modal", handleEvent);
    };
  }, []);

  const handleClose = () => {
    setInternalOpen(false);
    if (propOnClose) propOnClose();
  };

  if (!internalOpen) return null;

  const currentPlan = (modalData.planId || "free").toLowerCase();
  const isFreePlan = currentPlan === "free";

  const handleUpgradeClick = (targetPlan = "starter") => {
    handleClose();
    if (typeof window !== "undefined") {
      window.location.href = `/dashboard?tab=billing&plan=${targetPlan}`;
    }
  };

  const getLimitTitle = () => {
    if (modalData.limitType === "ai_employee") {
      return "Monthly AI Employee Mission Limit Reached";
    }
    if (modalData.limitType === "website_builder") {
      return "Active Website Generation Quota Reached";
    }
    return "Monthly Lead Generation Limit Reached";
  };

  const getLimitDescription = () => {
    if (modalData.message) return modalData.message;
    if (modalData.limitType === "ai_employee") {
      return `You have completed all ${modalData.limit || (isFreePlan ? 1 : 10)} autonomous missions allocated for your ${modalData.planName || "plan"} this month. Upgrade to continue deploying your autonomous AI sales workforce.`;
    }
    if (modalData.limitType === "website_builder") {
      return `You have reached your active website quota on the ${modalData.planName || "plan"}. Upgrade your plan in billing to create and host additional high-converting prototype websites and 5-Star Review Shields.`;
    }
    return `Your ${modalData.planName || (isFreePlan ? "Free Explorer" : "current")} account includes ${modalData.limit || (isFreePlan ? 50 : 1500)} verified business leads per month (${modalData.used || modalData.limit || 50}/${modalData.limit || (isFreePlan ? 50 : 1500)} used this month). Upgrade your plan to instantly generate additional businesses.`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-2xl bg-[#0f172a] text-slate-100 rounded-2xl border border-purple-500/30 shadow-2xl overflow-hidden"
        role="dialog"
        aria-modal="true"
      >
        {/* Top Gradient Banner */}
        <div className="h-2 bg-gradient-to-r from-purple-600 via-indigo-500 to-amber-500" />

        {/* Close Button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          aria-label="Close modal"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-6 sm:p-8">
          {/* Header Badge */}
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              Monthly Quota Reached
            </span>
            <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">
              {modalData.planName || "Free Plan"}
            </span>
          </div>

          <h2 className="text-xl sm:text-2xl font-bold text-white mb-2 leading-tight">
            {getLimitTitle()}
          </h2>
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed mb-6">
            {getLimitDescription()}
          </p>

          {/* Usage Meter Card */}
          <div className="bg-slate-900/90 rounded-xl p-4 border border-slate-800 mb-6">
            <div className="flex items-center justify-between text-xs text-slate-300 mb-2 font-medium">
              <span>Monthly Allocation Used:</span>
              <span className="text-amber-400 font-bold">{modalData.used ?? modalData.limit ?? 50} / {modalData.limit ?? 50} (100%)</span>
            </div>
            <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
              <div className="bg-gradient-to-r from-amber-500 to-red-500 h-full rounded-full w-full" />
            </div>
            <p className="text-[11px] text-slate-400 mt-2 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-purple-400 shrink-0" />
              Upgrade today for immediate lead unlock, increased monthly generation caps, and priority SMTP dispatch.
            </p>
          </div>

          {/* Upgrade Tier Options Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            {/* Starter */}
            <div 
              onClick={() => handleUpgradeClick("starter")}
              className="bg-slate-900/60 hover:bg-slate-900 border border-slate-800 hover:border-purple-500/50 rounded-xl p-3.5 transition-all cursor-pointer group flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-bold text-sm text-white group-hover:text-purple-300 transition-colors">Starter</h3>
                  <span className="text-xs font-semibold text-slate-400">$49/mo</span>
                </div>
                <p className="text-[11px] text-slate-400 mb-2.5">For solo consultants &amp; studios</p>
                <ul className="text-[11px] space-y-1 text-slate-300">
                  <li className="flex items-center gap-1.5">
                    <Zap className="w-3 h-3 text-purple-400 shrink-0" />
                    <strong>1,500</strong> leads / month
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Users className="w-3 h-3 text-purple-400 shrink-0" />
                    <strong>10</strong> AI Missions / mo
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Globe className="w-3 h-3 text-purple-400 shrink-0" />
                    <strong>3</strong> Active Websites
                  </li>
                </ul>
              </div>
              <button 
                type="button"
                className="mt-3 w-full py-1.5 text-[11px] font-semibold bg-slate-800 group-hover:bg-purple-600 text-white rounded-lg transition-colors flex items-center justify-center gap-1"
              >
                <span>Select Starter</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>

            {/* Growth Pro (Recommended) */}
            <div 
              onClick={() => handleUpgradeClick("growth")}
              className="bg-purple-950/30 hover:bg-purple-950/50 border-2 border-purple-500/60 rounded-xl p-3.5 transition-all cursor-pointer group flex flex-col justify-between relative shadow-lg shadow-purple-950/40"
            >
              <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-gradient-to-r from-purple-500 to-indigo-500 text-[10px] uppercase tracking-wider font-extrabold text-white rounded-full shadow">
                Most Popular
              </span>
              <div>
                <div className="flex items-center justify-between mb-1 mt-0.5">
                  <h3 className="font-bold text-sm text-purple-200 group-hover:text-white transition-colors">Growth Pro</h3>
                  <span className="text-xs font-semibold text-purple-300">$149/mo</span>
                </div>
                <p className="text-[11px] text-purple-300/70 mb-2.5">For scaling agencies</p>
                <ul className="text-[11px] space-y-1 text-slate-200">
                  <li className="flex items-center gap-1.5">
                    <Zap className="w-3 h-3 text-purple-300 shrink-0" />
                    <strong>7,500</strong> leads / month
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Users className="w-3 h-3 text-purple-300 shrink-0" />
                    <strong>50</strong> AI Missions / mo
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Globe className="w-3 h-3 text-purple-300 shrink-0" />
                    <strong>15</strong> Active Websites
                  </li>
                </ul>
              </div>
              <button 
                type="button"
                className="mt-3 w-full py-1.5 text-[11px] font-bold bg-purple-600 group-hover:bg-purple-500 text-white rounded-lg transition-colors flex items-center justify-center gap-1 shadow"
              >
                <span>Upgrade to Growth</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>

            {/* Agency Scale */}
            <div 
              onClick={() => handleUpgradeClick("scale")}
              className="bg-slate-900/60 hover:bg-slate-900 border border-slate-800 hover:border-indigo-500/50 rounded-xl p-3.5 transition-all cursor-pointer group flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-bold text-sm text-white group-hover:text-indigo-300 transition-colors">Agency Scale</h3>
                  <span className="text-xs font-semibold text-slate-400">$349/mo</span>
                </div>
                <p className="text-[11px] text-slate-400 mb-2.5">High-velocity DFY sales</p>
                <ul className="text-[11px] space-y-1 text-slate-300">
                  <li className="flex items-center gap-1.5">
                    <Zap className="w-3 h-3 text-indigo-400 shrink-0" />
                    <strong>25,000</strong> leads / month
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Users className="w-3 h-3 text-indigo-400 shrink-0" />
                    <strong>250</strong> AI Missions / mo
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Globe className="w-3 h-3 text-indigo-400 shrink-0" />
                    <strong>100</strong> Active Websites
                  </li>
                </ul>
              </div>
              <button 
                type="button"
                className="mt-3 w-full py-1.5 text-[11px] font-semibold bg-slate-800 group-hover:bg-indigo-600 text-white rounded-lg transition-colors flex items-center justify-center gap-1"
              >
                <span>Select Scale</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Action Footer */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-slate-800">
            <span className="text-xs text-slate-400">
              Need custom volume? <button onClick={() => handleUpgradeClick("enterprise")} className="text-purple-400 hover:underline font-semibold cursor-pointer">Enterprise VIP (100k+ leads)</button>
            </span>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Maybe Later
              </button>
              <button
                type="button"
                onClick={() => handleUpgradeClick("growth")}
                className="flex-1 sm:flex-initial px-5 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-purple-600/30 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Go to Billing / Upgrade</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
