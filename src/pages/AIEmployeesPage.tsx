import React from "react";
import { useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import AIEmployeePanel from "@/components/AIEmployeePanel";

export default function AIEmployeesPage() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-[#FAF9F5] text-[#0B0F17]">
      {/* Top Navigation Bar */}
      <header className="border-b border-[#E4E2DD] bg-white sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setLocation("/crm")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#0B0F17] bg-[#F2F0EA] hover:bg-[#E4E2DD] rounded-lg transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to CRM</span>
            </button>
            <div className="h-4 w-px bg-slate-300" />
            <div className="flex items-center gap-2">
              <span className="text-2xl">🕵️</span>
              <div>
                <h1 className="font-bold text-base sm:text-lg leading-tight flex items-center gap-2">
                  <span>AI Employees</span>
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full border border-purple-200">
                    Autonomous Fleet
                  </span>
                </h1>
                <p className="text-xs text-[#525866]">Autonomous B2B prospect discovery, research, and personalized sales execution</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setLocation("/dashboard")}
              className="px-3 py-1.5 text-xs font-semibold text-[#0B0F17] bg-[#F2F0EA] hover:bg-[#E4E2DD] rounded-lg transition-colors cursor-pointer"
            >
              User Dashboard
            </button>
            <button
              onClick={() => setLocation("/crm")}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-[#0B0F17] hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            >
              Manual Hunter Mode
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <AIEmployeePanel onNavigateTab={(t) => setLocation(`/crm?tab=${t}`)} />
      </main>
    </div>
  );
}
