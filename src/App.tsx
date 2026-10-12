import React, { Suspense, lazy, Component, ReactNode, ComponentType } from "react";
import { Switch, Route } from "wouter";
import LandingPage from "@/pages/LandingPage";
import AuthPage from "@/pages/AuthPage";
import CRM from "@/pages/CRM";

function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  retries = 3,
  interval = 400
) {
  return lazy(() =>
    new Promise<{ default: T }>((resolve, reject) => {
      function attempt(remaining: number) {
        factory()
          .then(resolve)
          .catch((error) => {
            if (remaining <= 0) {
              const msg = error?.message || "";
              if (/Failed to fetch dynamically imported module|Importing a module script failed/i.test(msg)) {
                const reloadKey = "app_chunk_reload_attempt";
                const lastAttempt = Number(sessionStorage.getItem(reloadKey) || "0");
                if (Date.now() - lastAttempt > 10000) {
                  sessionStorage.setItem(reloadKey, String(Date.now()));
                  window.location.reload();
                  return;
                }
              }
              reject(error);
            } else {
              setTimeout(() => attempt(remaining - 1), interval);
            }
          });
      }
      attempt(retries);
    })
  );
}

class RouteErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-slate-200 p-6 text-center">
          <div className="w-12 h-12 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-4 text-purple-400">
            <svg className="w-6 h-6 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold mb-2">Connecting to AI Business Hunter…</h2>
          <p className="text-xs text-slate-400 max-w-sm mb-6">
            Optimizing workspace connection. Click below to refresh your session immediately.
          </p>
          <button
            onClick={() => {
              sessionStorage.removeItem("app_chunk_reload_attempt");
              window.location.reload();
            }}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-semibold shadow-md transition-all cursor-pointer"
          >
            Reload Workspace
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const GeneratedWebsitePage = lazyWithRetry(() => import("@/pages/GeneratedWebsitePage"));
const ReviewShieldPage = lazyWithRetry(() => import("@/pages/ReviewShieldPage"));
const UserDashboard = lazyWithRetry(() => import("@/pages/UserDashboard"));
const AdminPanel = lazyWithRetry(() => import("@/pages/AdminPanel"));
const Report = lazyWithRetry(() => import("@/pages/Report"));
const AffiliateHunter = lazyWithRetry(() => import("@/pages/AffiliateHunter"));
const AIEmployeesPage = lazyWithRetry(() => import("@/pages/AIEmployeesPage"));

import UpgradeModal from "@/components/UpgradeModal";

export default function App() {
  return (
    <RouteErrorBoundary>
      <UpgradeModal />
      <Suspense
        fallback={
          <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-slate-200 text-sm font-medium gap-3">
            <div className="w-8 h-8 rounded-full border-2 border-purple-500/20 border-t-purple-500 animate-spin" />
            <span className="text-xs text-slate-400">Loading workspace…</span>
          </div>
        }
      >
        <Switch>
          <Route path="/site/:siteId" component={GeneratedWebsitePage} />
          <Route path="/review/:siteId" component={ReviewShieldPage} />
          <Route path="/" component={LandingPage} />
          <Route path="/landing" component={LandingPage} />
          <Route path="/auth" component={AuthPage} />
          <Route path="/login" component={AuthPage} />
          <Route path="/register" component={AuthPage} />
          <Route path="/verify-email" component={AuthPage} />
          <Route path="/dashboard" component={UserDashboard} />
          <Route path="/admin" component={AdminPanel} />
          <Route path="/owner" component={AdminPanel} />
          <Route path="/crm" component={CRM} />
          <Route path="/employees" component={AIEmployeesPage} />
          <Route path="/ai-employees" component={AIEmployeesPage} />
          <Route path="/affiliate" component={AffiliateHunter} />
          <Route path="/report/:reportId" component={Report} />
          <Route component={LandingPage} />
        </Switch>
      </Suspense>
    </RouteErrorBoundary>
  );
}
