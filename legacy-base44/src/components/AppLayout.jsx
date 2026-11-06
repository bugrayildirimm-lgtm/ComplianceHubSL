import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Globe2, Radar, BookOpen, ShieldCheck, ListChecks,
  Activity, Search, FileBarChart2, Settings, Bell,
} from "lucide-react";
import { cn } from "@/lib/utils";
import useActor from "@/lib/useActor";
import AccessNotAdmitted from "@/components/AccessNotAdmitted";

const BRAND_MARK = "https://base44.app/api/apps/6aea053a32da25b998ffa48c/files/mp/public/6aea053a32da25b998ffa48c/50ac52e46_stakelogic-mark.svg";

const NAV = [
  { group: "Overview", items: [{ to: "/", label: "Dashboard", icon: LayoutDashboard }] },
  {
    group: "Register",
    items: [
      { to: "/jurisdictions", label: "Jurisdictions", icon: Globe2 },
      { to: "/licences", label: "Licences, Certificates & Studios", icon: ShieldCheck },
    ],
  },
  {
    group: "Monitoring",
    items: [
      { to: "/radar", label: "Regulatory Radar", icon: Radar },
      { to: "/sources", label: "Sources & Coverage", icon: Activity },
      { to: "/discovery", label: "Discovery & Import Review", icon: Search },
    ],
  },
  {
    group: "Obligations",
    items: [
      { to: "/requirements", label: "Requirements Library", icon: BookOpen },
      { to: "/baseline", label: "Requirements Baseline", icon: BookOpen },
      { to: "/actions", label: "Actions & Deadlines", icon: ListChecks },
      { to: "/approvals", label: "Approvals", icon: ShieldCheck },
    ],
  },
  {
    group: "Reporting",
    items: [
      { to: "/reports", label: "Reports", icon: FileBarChart2 },
      { to: "/administration", label: "Administration", icon: Settings },
    ],
  },
];

function MaltaClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="num text-xs text-muted-foreground">
      {new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Malta",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(now)}{" "}
      <span className="text-slate-400">Europe/Malta</span>
    </span>
  );
}

export default function AppLayout() {
  const { pathname } = useLocation();
  const actor = useActor();
  if (!actor.loading && !actor.admitted) return <AccessNotAdmitted email={actor.email} />;
  const initials = (actor.name || "SC")
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-[hsl(var(--sidebar-background))] lg:flex">
        <div className="flex items-center gap-3 px-5 py-5">
          <img src={BRAND_MARK} alt="Stakelogic" className="h-9 w-auto" />
          <div className="text-[13px] font-semibold text-white">Compliance Hub</div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-6">
          {NAV.map((section) => (
            <div key={section.group} className="mb-5">
              <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">
                {section.group}
              </div>
              <div className="space-y-0.5">
                {section.items.map(({ to, label, icon: Icon }) => {
                  const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
                  return (
                    <NavLink
                      key={to}
                      to={to}
                      className={cn(
                        "flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-[13px] transition-colors",
                        active
                          ? "bg-[hsl(var(--sidebar-accent))] font-medium text-white"
                          : "text-white/65 hover:bg-white/[0.06] hover:text-white"
                      )}
                    >
                      <Icon className={cn("h-4 w-4 shrink-0", active ? "text-brand" : "text-white/40")} />
                      <span className="truncate">{label}</span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 px-5 py-3 text-[11px] leading-relaxed text-white/40">
          Evidence chain retained · UTC stored
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-border bg-white/90 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3 lg:hidden">
            <img src={BRAND_MARK} alt="Stakelogic" className="h-6 w-auto" />
            <span className="text-[13px] font-semibold">Compliance Hub</span>
          </div>
          <div className="hidden text-[13px] text-muted-foreground lg:block">
            Official sources only · unreviewed items are never treated as compliance positions
          </div>
          <div className="flex items-center gap-4">
            <MaltaClock />
            <button
              type="button"
              className="relative rounded-sm p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" />
            </button>
            <div className="hidden items-center gap-2 border-l border-border pl-4 sm:flex">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white">
                {initials}
              </div>
              <div className="leading-tight">
                <div className="max-w-[160px] truncate text-[12px] font-medium">{actor.name || "Not signed in"}</div>
                <div className="text-[10px] text-muted-foreground">
                  {actor.loading ? "Checking access…" : actor.role || "No access role"}
                  {actor.canApprove ? " · approver" : ""}
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}